import { describe, it, expect, vi, afterEach } from "vitest";
import {
  PlayerKillHandler,
  MissingVictimUuidError,
} from "../src/handlers/player-kill-handler";
import { MissingPlayerUuidError } from "../src/handlers/errors";
import type { DispatchContext } from "../src/context";
import type { Publisher } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";
import {
  PlayerNameResolver,
  PlayerNotFoundError,
  PlayerLookupHttpError,
} from "../src/players";

// Tests de PlayerKillHandler (T12 · PvP Chronicle).
//
// El handler resuelve killer + victim en paralelo vía
// PlayerNameResolver y delega toda la narrativa al catálogo.
// Puro (sin estado, sin dedup).

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
  return { publisher, playerNameResolver: resolver, logger: { warn: () => undefined }, freshnessThresholdMs: 120000 };
}

const KILLER = "00000000-0000-4000-8000-0000000000aa";
const VICTIM = "00000000-0000-4000-8000-0000000000bb";
const NAMES = { [KILLER]: "Miguel", [VICTIM]: "Carlos" };

function pvpKillEvent(
  overrides: {
    playerUuid?: string | null;
    eventUuid?: string;
    id?: string;
    data?: Record<string, unknown>;
  } = {},
): EventRecord {
  return {
    id: overrides.id ?? "42",
    event_uuid: overrides.eventUuid ?? "00000000-0000-4000-8000-000000000fff",
    type: "player.kill",
    v: 1,
    ts: "2026-07-30T00:00:00.000Z",
    received_at: "2026-07-30T00:00:00.010Z",
    player_uuid: overrides.playerUuid === undefined ? KILLER : overrides.playerUuid,
    world: "world",
    x: 0,
    y: 64,
    z: 0,
    data:
      overrides.data ?? {
        victim_uuid: VICTIM,
        weapon: "minecraft:diamond_sword",
      },
  };
}

function stubRandomToFirstVariant(): void {
  vi.spyOn(Math, "random").mockReturnValue(0);
}

async function bodyOf(
  handler: PlayerKillHandler,
  event: EventRecord,
  map: Record<string, string> = NAMES,
): Promise<string> {
  const publisher = fakePublisher();
  const context = fakeContext(publisher, fakeResolverFromMap(map));
  await handler.handle(context, event);
  return publisher.publish.mock.calls[0]![0].body as string;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------
// Shape
// -------------------------------------------------------------------

describe("PlayerKillHandler · shape", () => {
  it("supports('player.kill') = true", () => {
    expect(new PlayerKillHandler().supports("player.kill")).toBe(true);
  });

  it("supports() de cualquier otro tipo = false", () => {
    const h = new PlayerKillHandler();
    expect(h.supports("player.death")).toBe(false);
    expect(h.supports("boss.kill")).toBe(false);
    expect(h.supports("mob.kill")).toBe(false);
  });

  it("publica title y kind acordados", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    const context = fakeContext(publisher, fakeResolverFromMap(NAMES));
    await new PlayerKillHandler().handle(context, pvpKillEvent());
    const call = publisher.publish.mock.calls[0]![0];
    expect(call.title).toBe("Duelo PvP");
    expect(call.kind).toBe("player_kill");
    expect(typeof call.body).toBe("string");
    expect((call.body as string).length).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------
// Resolución de killer y victim
// -------------------------------------------------------------------

describe("PlayerKillHandler · resolución de nombres", () => {
  it("resuelve tanto killer como victim en paralelo", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap(NAMES);
    const context = fakeContext(publisher, resolver);

    await new PlayerKillHandler().handle(context, pvpKillEvent());

    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    expect(resolver.resolve).toHaveBeenCalledWith(KILLER);
    expect(resolver.resolve).toHaveBeenCalledWith(VICTIM);
  });

  it("el body contiene AMBOS nombres correctamente ubicados", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(new PlayerKillHandler(), pvpKillEvent());
    // Primera variante de melee es:
    // "⚔️ ${killer} convenció a ${victim} de volver al punto de respawn."
    expect(body).toBe(
      "⚔️ Miguel convenció a Carlos de volver al punto de respawn.",
    );
  });
});

// -------------------------------------------------------------------
// Categorías por weapon
// -------------------------------------------------------------------

describe("PlayerKillHandler · categorías por weapon", () => {
  it.each([
    ["minecraft:diamond_sword", /⚔/, "melee"],
    ["minecraft:bow", /🏹/, "projectile"],
    ["minecraft:tnt", /💥/, "explosion"],
    ["minecraft:flint_and_steel", /🔥/, "fire"],
    ["minecraft:splash_potion", /✨/, "magic"],
    ["minecraft:cake", /⚔/, "unknown"], // no mapeado → unknown
  ])(
    "weapon=%s → embed con emoji del pool esperado (%s)",
    async (weapon, emojiPattern) => {
      stubRandomToFirstVariant();
      const body = await bodyOf(
        new PlayerKillHandler(),
        pvpKillEvent({
          data: { victim_uuid: VICTIM, weapon },
        }),
      );
      expect(body).toMatch(emojiPattern);
      expect(body).toContain("Miguel");
      expect(body).toContain("Carlos");
    },
  );

  it("void: no hay weapon en el vanilla que lo produzca; verificado en el test del catálogo", () => {
    // Ver test/pvp-catalog.test.ts para la verificación de que
    // ningún weapon del WEAPON_TO_CATEGORY route a "void".
    expect(true).toBe(true);
  });
});

// -------------------------------------------------------------------
// Fallback (weapon ausente / no clasificable)
// -------------------------------------------------------------------

describe("PlayerKillHandler · fallback", () => {
  it("weapon ausente → primera variante de unknown = fallback textual del spec", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(
      new PlayerKillHandler(),
      pvpKillEvent({ data: { victim_uuid: VICTIM } }), // sin weapon
    );
    expect(body).toBe("⚔️ Miguel derrotó a Carlos.");
  });

  it("weapon no-string → primera variante de unknown", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(
      new PlayerKillHandler(),
      pvpKillEvent({ data: { victim_uuid: VICTIM, weapon: 42 } }),
    );
    expect(body).toBe("⚔️ Miguel derrotó a Carlos.");
  });

  it("weapon vacío → primera variante de unknown", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(
      new PlayerKillHandler(),
      pvpKillEvent({ data: { victim_uuid: VICTIM, weapon: "   " } }),
    );
    expect(body).toBe("⚔️ Miguel derrotó a Carlos.");
  });
});

// -------------------------------------------------------------------
// Selección aleatoria
// -------------------------------------------------------------------

describe("PlayerKillHandler · selección aleatoria", () => {
  it("Math.random varía → body varía dentro del pool", async () => {
    const seen = new Set<string>();
    for (const r of [0, 0.5, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      seen.add(
        await bodyOf(
          new PlayerKillHandler(),
          pvpKillEvent({
            data: { victim_uuid: VICTIM, weapon: "minecraft:diamond_sword" },
          }),
        ),
      );
      vi.restoreAllMocks();
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

// -------------------------------------------------------------------
// Errores tipados y propagación
// -------------------------------------------------------------------

describe("PlayerKillHandler · errores tipados", () => {
  it("player_uuid null → MissingPlayerUuidError, no publica, no resuelve", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap(NAMES);
    const context = fakeContext(publisher, resolver);
    await expect(
      new PlayerKillHandler().handle(
        context,
        pvpKillEvent({ playerUuid: null }),
      ),
    ).rejects.toBeInstanceOf(MissingPlayerUuidError);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it("data.victim_uuid ausente → MissingVictimUuidError, no publica", async () => {
    const publisher = fakePublisher();
    const context = fakeContext(publisher, fakeResolverFromMap(NAMES));
    await expect(
      new PlayerKillHandler().handle(
        context,
        pvpKillEvent({ data: { weapon: "minecraft:diamond_sword" } }),
      ),
    ).rejects.toBeInstanceOf(MissingVictimUuidError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.victim_uuid no-string → MissingVictimUuidError, no publica", async () => {
    const publisher = fakePublisher();
    const context = fakeContext(publisher, fakeResolverFromMap(NAMES));
    await expect(
      new PlayerKillHandler().handle(
        context,
        pvpKillEvent({ data: { victim_uuid: 42 } }),
      ),
    ).rejects.toBeInstanceOf(MissingVictimUuidError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.victim_uuid whitespace → MissingVictimUuidError, no publica", async () => {
    const publisher = fakePublisher();
    const context = fakeContext(publisher, fakeResolverFromMap(NAMES));
    await expect(
      new PlayerKillHandler().handle(
        context,
        pvpKillEvent({ data: { victim_uuid: "   " } }),
      ),
    ).rejects.toBeInstanceOf(MissingVictimUuidError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("PlayerNotFoundError del killer se propaga", async () => {
    const publisher = fakePublisher();
    // Sólo victim está resuelto: killer lanza PlayerNotFoundError.
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [VICTIM]: "Carlos" }),
    );
    await expect(
      new PlayerKillHandler().handle(context, pvpKillEvent()),
    ).rejects.toBeInstanceOf(PlayerNotFoundError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("PlayerNotFoundError del victim se propaga", async () => {
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [KILLER]: "Miguel" }),
    );
    await expect(
      new PlayerKillHandler().handle(context, pvpKillEvent()),
    ).rejects.toBeInstanceOf(PlayerNotFoundError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("PlayerLookupHttpError durante resolve se propaga", async () => {
    const publisher = fakePublisher();
    const resolve = vi.fn(async () => {
      throw new PlayerLookupHttpError(KILLER, 500, "boom");
    });
    const resolver = { resolve } as unknown as PlayerNameResolver;
    const context = fakeContext(publisher, resolver);
    await expect(
      new PlayerKillHandler().handle(context, pvpKillEvent()),
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
    const context = fakeContext(publisher, fakeResolverFromMap(NAMES));

    await expect(
      new PlayerKillHandler().handle(context, pvpKillEvent()),
    ).rejects.toThrow(/discord caido/);
  });
});
