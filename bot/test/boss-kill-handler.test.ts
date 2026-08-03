import { describe, it, expect, vi, afterEach } from "vitest";
import {
  BossKillHandler,
  MissingBossError,
} from "../src/handlers/boss-kill-handler";
import type { DispatchContext } from "../src/context";
import type { Publisher } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";
import {
  PlayerNameResolver,
  PlayerNotFoundError,
  PlayerLookupHttpError,
} from "../src/players";

// Tests de BossKillHandler (T11 · Boss Chronicle).
//
// El handler consume boss.kill (emitido por ProgressListener.onBossDeath),
// resuelve hasta los 5 primeros participants (UUIDs → nombres), y
// publica un embed con narrativa + sección "Participaron:" opcional.
// Es puro: sin estado, sin dedup.

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

// UUIDs de conveniencia para los tests.
const U = {
  miguel: "00000000-0000-4000-8000-000000000001",
  carlos: "00000000-0000-4000-8000-000000000002",
  ana: "00000000-0000-4000-8000-000000000003",
  pedro: "00000000-0000-4000-8000-000000000004",
  luis: "00000000-0000-4000-8000-000000000005",
  sofia: "00000000-0000-4000-8000-000000000006",
  juan: "00000000-0000-4000-8000-000000000007",
  laura: "00000000-0000-4000-8000-000000000008",
} as const;

const DEFAULT_NAMES: Record<string, string> = {
  [U.miguel]: "Miguel",
  [U.carlos]: "Carlos",
  [U.ana]: "Ana",
  [U.pedro]: "Pedro",
  [U.luis]: "Luis",
  [U.sofia]: "Sofia",
  [U.juan]: "Juan",
  [U.laura]: "Laura",
};

function bossKillEvent(
  overrides: {
    playerUuid?: string | null;
    eventUuid?: string;
    id?: string;
    data?: Record<string, unknown>;
  } = {},
): EventRecord {
  return {
    id: overrides.id ?? "42",
    event_uuid: overrides.eventUuid ?? "00000000-0000-4000-8000-000000000abc",
    type: "boss.kill",
    v: 1,
    ts: "2026-07-30T00:00:00.000Z",
    received_at: "2026-07-30T00:00:00.010Z",
    player_uuid: overrides.playerUuid === undefined ? U.miguel : overrides.playerUuid,
    world: "world_the_end",
    x: 0,
    y: 64,
    z: 0,
    data:
      overrides.data ?? { boss: "ender_dragon", participants: [U.miguel] },
  };
}

function stubRandomToFirstVariant(): void {
  vi.spyOn(Math, "random").mockReturnValue(0);
}

async function bodyOf(
  handler: BossKillHandler,
  event: EventRecord,
  map: Record<string, string> = DEFAULT_NAMES,
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

describe("BossKillHandler · shape", () => {
  it("supports('boss.kill') = true", () => {
    expect(new BossKillHandler().supports("boss.kill")).toBe(true);
  });

  it("supports() de cualquier otro tipo = false", () => {
    const h = new BossKillHandler();
    expect(h.supports("milestone.first")).toBe(false);
    expect(h.supports("player.death")).toBe(false);
    expect(h.supports("boss")).toBe(false);
  });

  it("publica title y kind acordados", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    const context = fakeContext(publisher, fakeResolverFromMap(DEFAULT_NAMES));
    await new BossKillHandler().handle(context, bossKillEvent());
    const call = publisher.publish.mock.calls[0]![0];
    expect(call.title).toBe("Batalla del servidor");
    expect(call.kind).toBe("boss_kill");
    expect(typeof call.body).toBe("string");
    expect((call.body as string).length).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------
// Bosses canónicos
// -------------------------------------------------------------------

describe("BossKillHandler · bosses canónicos", () => {
  it("wither: produce narración del pool wither", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(
      new BossKillHandler(),
      bossKillEvent({ data: { boss: "wither", participants: [] } }),
    );
    expect(body).toMatch(/☠/);
    expect(body).toContain("Wither");
  });

  it("ender_dragon: produce narración del pool ender_dragon", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(
      new BossKillHandler(),
      bossKillEvent({ data: { boss: "ender_dragon", participants: [] } }),
    );
    expect(body).toMatch(/🐉/);
    expect(body).toContain("Dragón");
  });
});

// -------------------------------------------------------------------
// Fallback
// -------------------------------------------------------------------

describe("BossKillHandler · fallback boss desconocido", () => {
  it("boss no reconocido: publica con fallback ⚔️", async () => {
    const body = await bodyOf(
      new BossKillHandler(),
      bossKillEvent({ data: { boss: "warden", participants: [] } }),
    );
    expect(body).toBe("⚔️ Un gran enemigo fue derrotado: warden.");
  });
});

// -------------------------------------------------------------------
// Selección aleatoria
// -------------------------------------------------------------------

describe("BossKillHandler · selección aleatoria", () => {
  it("Math.random varía → body varía dentro del pool", async () => {
    const seen = new Set<string>();
    for (const r of [0, 0.5, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      seen.add(
        await bodyOf(
          new BossKillHandler(),
          bossKillEvent({ data: { boss: "wither", participants: [] } }),
        ),
      );
      vi.restoreAllMocks();
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

// -------------------------------------------------------------------
// Participants
// -------------------------------------------------------------------

describe("BossKillHandler · participants", () => {
  it("participants vacío: publica sólo la narración (sin sección)", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(
      new BossKillHandler(),
      bossKillEvent({ data: { boss: "wither", participants: [] } }),
    );
    expect(body).not.toContain("Participaron");
    expect(body).toBe("☠️ El Wither finalmente cayó.");
  });

  it("participants campo ausente: se comporta como vacío", async () => {
    stubRandomToFirstVariant();
    // data sin participants — el handler debe tolerarlo.
    const body = await bodyOf(
      new BossKillHandler(),
      bossKillEvent({ data: { boss: "wither" } }),
    );
    expect(body).not.toContain("Participaron");
    expect(body).toBe("☠️ El Wither finalmente cayó.");
  });

  it("1 participante: resuelve nombre y muestra sección con una línea", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(
      new BossKillHandler(),
      bossKillEvent({
        data: { boss: "wither", participants: [U.miguel] },
      }),
    );
    expect(body).toBe(
      "☠️ El Wither finalmente cayó.\n\nParticiparon:\n• Miguel",
    );
  });

  it("3 participantes: los 3 aparecen, sin cola 'y N más.'", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(
      new BossKillHandler(),
      bossKillEvent({
        data: {
          boss: "wither",
          participants: [U.miguel, U.carlos, U.ana],
        },
      }),
    );
    expect(body).toBe(
      "☠️ El Wither finalmente cayó.\n\nParticiparon:\n• Miguel\n• Carlos\n• Ana",
    );
    expect(body).not.toContain("más.");
  });

  it("exactamente 5 participantes: los 5 aparecen, sin cola", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap(DEFAULT_NAMES);
    const context = fakeContext(publisher, resolver);
    await new BossKillHandler().handle(
      context,
      bossKillEvent({
        data: {
          boss: "wither",
          participants: [U.miguel, U.carlos, U.ana, U.pedro, U.luis],
        },
      }),
    );
    const body = publisher.publish.mock.calls[0]![0].body as string;
    for (const name of ["Miguel", "Carlos", "Ana", "Pedro", "Luis"]) {
      expect(body).toContain(`• ${name}`);
    }
    expect(body).not.toContain("más.");
    // El resolver se llamó exactamente 5 veces (una por participante).
    expect(resolver.resolve).toHaveBeenCalledTimes(5);
  });

  it("más de 5 participantes: sólo los 5 primeros + '... y N más.'", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap(DEFAULT_NAMES);
    const context = fakeContext(publisher, resolver);

    // 8 participantes → 5 mostrados + "... y 3 más."
    await new BossKillHandler().handle(
      context,
      bossKillEvent({
        data: {
          boss: "wither",
          participants: [
            U.miguel,
            U.carlos,
            U.ana,
            U.pedro,
            U.luis,
            U.sofia,
            U.juan,
            U.laura,
          ],
        },
      }),
    );
    const body = publisher.publish.mock.calls[0]![0].body as string;

    expect(body).toBe(
      [
        "☠️ El Wither finalmente cayó.",
        "",
        "Participaron:",
        "• Miguel",
        "• Carlos",
        "• Ana",
        "• Pedro",
        "• Luis",
        "... y 3 más.",
      ].join("\n"),
    );

    // No debe llamar al resolver para los que exceden el tope: 5, no 8.
    expect(resolver.resolve).toHaveBeenCalledTimes(5);
    expect(body).not.toContain("Sofia");
    expect(body).not.toContain("Juan");
    expect(body).not.toContain("Laura");
  });

  it("participants con 6 participantes: cola '... y 1 más.'", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(
      new BossKillHandler(),
      bossKillEvent({
        data: {
          boss: "ender_dragon",
          participants: [
            U.miguel,
            U.carlos,
            U.ana,
            U.pedro,
            U.luis,
            U.sofia,
          ],
        },
      }),
    );
    expect(body).toContain("... y 1 más.");
  });

  it("entradas no-string en participants se filtran (tolerancia defensiva)", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(
      new BossKillHandler(),
      bossKillEvent({
        data: {
          boss: "wither",
          // Mezcla: string válido, número, null, string vacío, otro string válido.
          participants: [U.miguel, 42, null, "  ", U.carlos],
        },
      }),
    );
    expect(body).toContain("• Miguel");
    expect(body).toContain("• Carlos");
    expect(body).not.toContain("más.");
  });

  it("participants no-array (bug del productor) se trata como vacío", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(
      new BossKillHandler(),
      bossKillEvent({
        data: { boss: "wither", participants: "quien-sabe" },
      }),
    );
    expect(body).not.toContain("Participaron");
    expect(body).toBe("☠️ El Wither finalmente cayó.");
  });
});

// -------------------------------------------------------------------
// player_uuid null (boss muerto sin killer)
// -------------------------------------------------------------------

describe("BossKillHandler · killer opcional", () => {
  it("player_uuid null: no llama al resolver por el killer (sólo por participants)", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap(DEFAULT_NAMES);
    const context = fakeContext(publisher, resolver);

    await new BossKillHandler().handle(
      context,
      bossKillEvent({
        playerUuid: null,
        data: { boss: "ender_dragon", participants: [U.miguel] },
      }),
    );

    // Sólo 1 llamada al resolver: por el participante, no por killer.
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    expect(resolver.resolve).toHaveBeenCalledWith(U.miguel);
  });
});

// -------------------------------------------------------------------
// Errores tipados y propagación
// -------------------------------------------------------------------

describe("BossKillHandler · errores", () => {
  it("data.boss ausente → MissingBossError, no publica", async () => {
    const publisher = fakePublisher();
    const context = fakeContext(publisher, fakeResolverFromMap(DEFAULT_NAMES));
    await expect(
      new BossKillHandler().handle(context, bossKillEvent({ data: {} })),
    ).rejects.toBeInstanceOf(MissingBossError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.boss no-string → MissingBossError, no publica", async () => {
    const publisher = fakePublisher();
    const context = fakeContext(publisher, fakeResolverFromMap(DEFAULT_NAMES));
    await expect(
      new BossKillHandler().handle(
        context,
        bossKillEvent({ data: { boss: 42 } }),
      ),
    ).rejects.toBeInstanceOf(MissingBossError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.boss whitespace → MissingBossError, no publica", async () => {
    const publisher = fakePublisher();
    const context = fakeContext(publisher, fakeResolverFromMap(DEFAULT_NAMES));
    await expect(
      new BossKillHandler().handle(
        context,
        bossKillEvent({ data: { boss: "   " } }),
      ),
    ).rejects.toBeInstanceOf(MissingBossError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("PlayerNotFoundError durante resolve de participants se propaga", async () => {
    const publisher = fakePublisher();
    const context = fakeContext(publisher, fakeResolverFromMap({})); // vacío
    await expect(
      new BossKillHandler().handle(
        context,
        bossKillEvent({
          data: { boss: "wither", participants: [U.miguel] },
        }),
      ),
    ).rejects.toBeInstanceOf(PlayerNotFoundError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("PlayerLookupHttpError durante resolve de participants se propaga", async () => {
    const publisher = fakePublisher();
    const resolve = vi.fn(async () => {
      throw new PlayerLookupHttpError(U.miguel, 500, "boom");
    });
    const resolver = { resolve } as unknown as PlayerNameResolver;
    const context = fakeContext(publisher, resolver);

    await expect(
      new BossKillHandler().handle(
        context,
        bossKillEvent({
          data: { boss: "wither", participants: [U.miguel] },
        }),
      ),
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
    const context = fakeContext(publisher, fakeResolverFromMap(DEFAULT_NAMES));

    await expect(
      new BossKillHandler().handle(context, bossKillEvent()),
    ).rejects.toThrow(/discord caido/);
  });
});
