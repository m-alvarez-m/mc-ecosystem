import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ServerMilestoneHandler,
  MissingMilestoneWhatError,
} from "../src/handlers/server-milestone-handler";
import type { DispatchContext } from "../src/context";
import type { Publisher } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";
import {
  PlayerNameResolver,
  PlayerNotFoundError,
  PlayerLookupHttpError,
} from "../src/players";

// Tests de ServerMilestoneHandler (T10 · Server Chronicle).
//
// El handler es puro (sin estado): confía en el plugin para
// unicidad histórica (SQLite garantiza que milestone.first se emite
// EXACTAMENTE UNA VEZ por what en toda la vida del servidor). Los
// tests verifican:
//   - shape (supports, title/kind);
//   - los 6 what canónicos producen embeds del pool esperado;
//   - fallback para what desconocido, con y sin player_uuid;
//   - errores tipados por payload incoherente (data.what
//     ausente/vacío/no-string);
//   - resolver NO se llama cuando player_uuid es null;
//   - propagación de errores de resolver y publisher.

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

function fakeResolverFromMap(
  map: Record<string, string>,
): PlayerNameResolver & { resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn(async (uuid: string) => {
    if (uuid in map) return map[uuid]!;
    throw new PlayerNotFoundError(uuid);
  });
  return { resolve } as unknown as PlayerNameResolver & {
    resolve: ReturnType<typeof vi.fn>;
  };
}

function fakeContext(
  publisher: Publisher,
  resolver: PlayerNameResolver,
): DispatchContext {
  return { publisher, playerNameResolver: resolver, logger: { warn: () => undefined }, freshnessThresholdMs: 120000,
      lifecycleState: { get: () => "unknown" as const, set: () => undefined }, lifecycleState: { get: () => "unknown", set: () => undefined } };
}

const MIGUEL = "71804e99-f2aa-32dc-bfcb-0ea5cfdda708";

function milestoneEvent(
  overrides: {
    playerUuid?: string | null;
    eventUuid?: string;
    id?: string;
    data?: Record<string, unknown>;
  } = {},
): EventRecord {
  return {
    id: overrides.id ?? "42",
    event_uuid: overrides.eventUuid ?? "00000000-0000-4000-8000-000000000001",
    type: "milestone.first",
    v: 1,
    ts: "2026-07-30T00:00:00.000Z",
    received_at: "2026-07-30T00:00:00.010Z",
    player_uuid: overrides.playerUuid === undefined ? MIGUEL : overrides.playerUuid,
    world: "world",
    x: 0,
    y: 64,
    z: 0,
    data: overrides.data ?? { what: "diamond" },
  };
}

function stubRandomToFirstVariant(): void {
  vi.spyOn(Math, "random").mockReturnValue(0);
}

async function bodyOf(
  handler: ServerMilestoneHandler,
  event: EventRecord,
  map: Record<string, string> = { [MIGUEL]: "Miguel" },
): Promise<string> {
  const publisher = fakePublisher();
  const context = fakeContext(publisher, fakeResolverFromMap(map));
  await handler.handle(context, event);
  const call = publisher.publish.mock.calls[0]!;
  return call[0].body as string;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------
// Shape
// -------------------------------------------------------------------

describe("ServerMilestoneHandler · shape", () => {
  it("supports('milestone.first') = true", () => {
    expect(new ServerMilestoneHandler().supports("milestone.first")).toBe(true);
  });

  it("supports() de cualquier otro tipo = false", () => {
    const h = new ServerMilestoneHandler();
    expect(h.supports("dimension.enter")).toBe(false);
    expect(h.supports("advancement.done")).toBe(false);
    expect(h.supports("milestone")).toBe(false);
  });

  it("publica title y kind acordados", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [MIGUEL]: "Miguel" }),
    );
    await new ServerMilestoneHandler().handle(context, milestoneEvent());
    const call = publisher.publish.mock.calls[0]![0];
    expect(call.title).toBe("Hito del servidor");
    expect(call.kind).toBe("server_milestone");
    expect(typeof call.body).toBe("string");
    expect((call.body as string).length).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------
// Los 6 what canónicos
// -------------------------------------------------------------------

describe("ServerMilestoneHandler · hitos canónicos", () => {
  it.each([
    ["diamond", /💎/],
    ["nether", /🔥/],
    ["end", /👁/],
    ["elytra", /🪽/],
    ["wither", /☠/],
    ["ender_dragon", /🐉/],
  ])("what=%s produce narración del pool esperado (emoji)", async (what, emojiPattern) => {
    stubRandomToFirstVariant();
    const body = await bodyOf(
      new ServerMilestoneHandler(),
      milestoneEvent({ data: { what } }),
    );
    expect(body).toMatch(emojiPattern);
  });

  it("hitos canónicos NO contienen el nombre del jugador (narrativa impersonal)", async () => {
    for (const what of [
      "diamond",
      "nether",
      "end",
      "elytra",
      "wither",
      "ender_dragon",
    ]) {
      stubRandomToFirstVariant();
      const body = await bodyOf(
        new ServerMilestoneHandler(),
        milestoneEvent({ data: { what } }),
      );
      expect(body, `what=${what}`).not.toContain("Miguel");
      vi.restoreAllMocks();
    }
  });
});

// -------------------------------------------------------------------
// Sin dedup: emitir el MISMO what dos veces → publica DOS veces
// (el bot confía en el plugin; unicidad no es responsabilidad del handler)
// -------------------------------------------------------------------

describe("ServerMilestoneHandler · sin dedup local", () => {
  it("dos eventos con el mismo what publican dos veces (el plugin garantiza unicidad; el bot no re-deduplica)", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [MIGUEL]: "Miguel" }),
    );
    const handler = new ServerMilestoneHandler();

    await handler.handle(context, milestoneEvent({ eventUuid: "e1" }));
    await handler.handle(context, milestoneEvent({ eventUuid: "e2" }));

    expect(publisher.publish).toHaveBeenCalledTimes(2);
  });
});

// -------------------------------------------------------------------
// Selección aleatoria (delegada al catálogo)
// -------------------------------------------------------------------

describe("ServerMilestoneHandler · selección aleatoria", () => {
  it("Math.random varía → body varía dentro del pool", async () => {
    const seen = new Set<string>();
    for (const r of [0, 0.5, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      seen.add(
        await bodyOf(
          new ServerMilestoneHandler(),
          milestoneEvent({ data: { what: "nether" } }),
        ),
      );
      vi.restoreAllMocks();
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

// -------------------------------------------------------------------
// Fallback para what desconocido
// -------------------------------------------------------------------

describe("ServerMilestoneHandler · fallback what desconocido", () => {
  it("what desconocido + player_uuid presente: interpola el nombre", async () => {
    const body = await bodyOf(
      new ServerMilestoneHandler(),
      milestoneEvent({ data: { what: "netherite" } }),
    );
    expect(body).toBe(
      "🏆 Miguel alcanzó un nuevo hito histórico: netherite.",
    );
  });

  it("what desconocido + player_uuid null: fallback impersonal", async () => {
    // Con player_uuid null, el resolver NO debe llamarse (evitamos IO
    // innecesaria y el fallback no necesita nombre).
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({}); // vacío — si se llama, lanzaría
    const context = fakeContext(publisher, resolver);

    await new ServerMilestoneHandler().handle(
      context,
      milestoneEvent({
        playerUuid: null,
        data: { what: "solar_eclipse" },
      }),
    );

    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const body = publisher.publish.mock.calls[0]![0].body as string;
    expect(body).toBe(
      "🏆 Nuevo hito histórico del servidor: solar_eclipse.",
    );
  });
});

// -------------------------------------------------------------------
// Resolver: se llama sólo si hay player_uuid
// -------------------------------------------------------------------

describe("ServerMilestoneHandler · resolver policy", () => {
  it("player_uuid null + what canónico: NO llama al resolver", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({}); // vacío
    const context = fakeContext(publisher, resolver);

    // Wither muerto sin killer: player_uuid null, what canónico.
    await new ServerMilestoneHandler().handle(
      context,
      milestoneEvent({ playerUuid: null, data: { what: "wither" } }),
    );

    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    // El body debe ser una variante impersonal del pool 'wither'.
    const body = publisher.publish.mock.calls[0]![0].body as string;
    expect(body).toMatch(/☠/);
  });

  it("player_uuid presente: SÍ llama al resolver (aunque el what sea canónico)", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [MIGUEL]: "Miguel" });
    const context = fakeContext(publisher, resolver);

    await new ServerMilestoneHandler().handle(context, milestoneEvent());

    expect(resolver.resolve).toHaveBeenCalledWith(MIGUEL);
  });
});

// -------------------------------------------------------------------
// Errores tipados — no publicar payloads incoherentes
// -------------------------------------------------------------------

describe("ServerMilestoneHandler · errores tipados", () => {
  it("data.what ausente → MissingMilestoneWhatError, no publica", async () => {
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [MIGUEL]: "Miguel" }),
    );
    await expect(
      new ServerMilestoneHandler().handle(context, milestoneEvent({ data: {} })),
    ).rejects.toBeInstanceOf(MissingMilestoneWhatError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.what no-string → MissingMilestoneWhatError, no publica", async () => {
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [MIGUEL]: "Miguel" }),
    );
    await expect(
      new ServerMilestoneHandler().handle(
        context,
        milestoneEvent({ data: { what: 42 } }),
      ),
    ).rejects.toBeInstanceOf(MissingMilestoneWhatError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.what string vacío / whitespace → MissingMilestoneWhatError, no publica", async () => {
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [MIGUEL]: "Miguel" }),
    );
    await expect(
      new ServerMilestoneHandler().handle(
        context,
        milestoneEvent({ data: { what: "   " } }),
      ),
    ).rejects.toBeInstanceOf(MissingMilestoneWhatError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("PlayerNotFoundError del resolver se propaga", async () => {
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({}), // sin Miguel
    );
    await expect(
      new ServerMilestoneHandler().handle(context, milestoneEvent()),
    ).rejects.toBeInstanceOf(PlayerNotFoundError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("PlayerLookupHttpError del resolver se propaga", async () => {
    const publisher = fakePublisher();
    const resolve = vi.fn(async () => {
      throw new PlayerLookupHttpError(MIGUEL, 500, "boom");
    });
    const resolver = { resolve } as unknown as PlayerNameResolver;
    const context = fakeContext(publisher, resolver);

    await expect(
      new ServerMilestoneHandler().handle(context, milestoneEvent()),
    ).rejects.toBeInstanceOf(PlayerLookupHttpError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("errores del publisher se propagan (dispatcher los tratará)", async () => {
    stubRandomToFirstVariant();
    const publisher: Publisher & { publish: ReturnType<typeof vi.fn> } = {
      publish: vi.fn(async () => {
        throw new Error("discord caido");
      }),
    };
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [MIGUEL]: "Miguel" }),
    );

    await expect(
      new ServerMilestoneHandler().handle(context, milestoneEvent()),
    ).rejects.toThrow(/discord caido/);
  });
});
