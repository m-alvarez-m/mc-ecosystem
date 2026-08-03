import { describe, it, expect, vi, afterEach } from "vitest";
import { VillagerTradeHandler } from "../src/handlers/villager-trade-handler";
import type { DispatchContext } from "../src/context";
import type { Publisher } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";
import { PlayerNameResolver } from "../src/players";

// Tests de VillagerTradeHandler (T14 · Villager Chronicle).
//
// Handler puro: sin estado, sin dedup, sin llamadas al resolver
// (narrativa impersonal). Sólo publica cuando el intercambio
// pertenece al catálogo (dos niveles); todo lo demás se ignora
// silenciosamente.

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

/** Resolver que grita si se le llama: verifica que el handler NO resuelve. */
function noCallResolver(): PlayerNameResolver {
  const resolve = vi.fn(async () => {
    throw new Error("resolver no debe ser llamado por VillagerTradeHandler");
  });
  return { resolve } as unknown as PlayerNameResolver;
}

function fakeContext(
  publisher: Publisher,
  resolver: PlayerNameResolver = noCallResolver(),
): DispatchContext {
  return { publisher, playerNameResolver: resolver, logger: { warn: () => undefined }, freshnessThresholdMs: 120000 };
}

const BUYER = "71804e99-f2aa-32dc-bfcb-0ea5cfdda708";

function tradeEvent(
  overrides: {
    playerUuid?: string | null;
    eventUuid?: string;
    id?: string;
    data?: Record<string, unknown>;
  } = {},
): EventRecord {
  return {
    id: overrides.id ?? "42",
    event_uuid: overrides.eventUuid ?? "00000000-0000-4000-8000-00000000t001",
    type: "villager.trade",
    v: 1,
    ts: "2026-07-30T00:00:00.000Z",
    received_at: "2026-07-30T00:00:00.010Z",
    player_uuid: overrides.playerUuid === undefined ? BUYER : overrides.playerUuid,
    world: "world",
    x: 0,
    y: 64,
    z: 0,
    data:
      overrides.data ??
      {
        profession: "librarian",
        input: "minecraft:emerald",
        output: "minecraft:enchanted_book",
        count: 1,
      },
  };
}

function stubRandomToFirstVariant(): void {
  vi.spyOn(Math, "random").mockReturnValue(0);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------
// Shape
// -------------------------------------------------------------------

describe("VillagerTradeHandler · shape", () => {
  it("supports('villager.trade') = true", () => {
    expect(new VillagerTradeHandler().supports("villager.trade")).toBe(true);
  });

  it("supports() de cualquier otro tipo = false", () => {
    const h = new VillagerTradeHandler();
    expect(h.supports("item.craft")).toBe(false);
    expect(h.supports("trade")).toBe(false);
    expect(h.supports("villager.death")).toBe(false);
  });

  it("publica title y kind acordados", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new VillagerTradeHandler().handle(fakeContext(publisher), tradeEvent());
    const call = publisher.publish.mock.calls[0]![0];
    expect(call.title).toBe("Comercio del servidor");
    expect(call.kind).toBe("villager_trade");
    expect(typeof call.body).toBe("string");
    expect((call.body as string).length).toBeGreaterThan(0);
  });

  it("NO llama al PlayerNameResolver (narrativa impersonal)", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    // El fakeContext por defecto usa un resolver que lanza si es llamado.
    await new VillagerTradeHandler().handle(fakeContext(publisher), tradeEvent());
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------------------
// Trades del catálogo → publica
// -------------------------------------------------------------------

describe("VillagerTradeHandler · trades del catálogo publican", () => {
  it.each([
    // Nivel 1a: (profession + output) específicos
    ["librarian", "minecraft:enchanted_book", /📚/],
    ["cleric", "minecraft:ender_pearl", /👁/],
    ["cleric", "minecraft:glowstone", /💡/],
    ["cleric", "minecraft:experience_bottle", /🍾/],
    ["farmer", "minecraft:golden_carrot", /🥕/],
    // Nivel 1b: diamond_gear shortcut
    ["toolsmith", "minecraft:diamond_pickaxe", /💎/],
    ["armorer", "minecraft:diamond_chestplate", /💎/],
    ["weaponsmith", "minecraft:diamond_sword", /💎/],
    // Nivel 2: profession-only
    ["librarian", "minecraft:book", /📖/],
    ["cleric", "minecraft:rotten_flesh", /⚗/],
    ["cartographer", "minecraft:paper", /🧭/],
    ["mason", "minecraft:polished_granite", /🧱/],
    ["armorer", "minecraft:iron_chestplate", /⚒/],
    ["weaponsmith", "minecraft:iron_sword", /⚔/],
  ])(
    "profession=%s + output=%s → publica embed con emoji del pool",
    async (profession, output, emojiPattern) => {
      stubRandomToFirstVariant();
      const publisher = fakePublisher();
      await new VillagerTradeHandler().handle(
        fakeContext(publisher),
        tradeEvent({ data: { profession, output, count: 1 } }),
      );
      expect(publisher.publish).toHaveBeenCalledTimes(1);
      const body = publisher.publish.mock.calls[0]![0].body as string;
      expect(body).toMatch(emojiPattern);
    },
  );
});

// -------------------------------------------------------------------
// Trades fuera del catálogo → NO publica (silencioso, no error)
// -------------------------------------------------------------------

describe("VillagerTradeHandler · trades fuera del catálogo se ignoran silenciosamente", () => {
  it.each([
    ["farmer", "minecraft:wheat"], // farmer sólo tiene golden_carrot
    ["farmer", "minecraft:bread"],
    ["butcher", "minecraft:cooked_beef"],
    ["fisherman", "minecraft:cod"],
    ["fletcher", "minecraft:arrow"],
    ["leatherworker", "minecraft:leather_boots"],
    ["shepherd", "minecraft:white_wool"],
    ["nitwit", "minecraft:emerald"],
    ["wandering_trader", "minecraft:sea_pickle"],
    ["profesion_desconocida", "minecraft:emerald"],
  ])(
    "profession=%s + output=%s → NO publica, NO lanza",
    async (profession, output) => {
      const publisher = fakePublisher();
      await expect(
        new VillagerTradeHandler().handle(
          fakeContext(publisher),
          tradeEvent({ data: { profession, output, count: 1 } }),
        ),
      ).resolves.toBeUndefined();
      expect(publisher.publish).not.toHaveBeenCalled();
    },
  );

  it("data.profession ausente → NO publica, NO lanza", async () => {
    const publisher = fakePublisher();
    await expect(
      new VillagerTradeHandler().handle(
        fakeContext(publisher),
        tradeEvent({ data: { output: "minecraft:enchanted_book", count: 1 } }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.profession no-string → NO publica, NO lanza", async () => {
    const publisher = fakePublisher();
    await expect(
      new VillagerTradeHandler().handle(
        fakeContext(publisher),
        tradeEvent({
          data: { profession: 42, output: "minecraft:enchanted_book" },
        }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.profession y data.output ambos vacíos → NO publica, NO lanza", async () => {
    const publisher = fakePublisher();
    await expect(
      new VillagerTradeHandler().handle(
        fakeContext(publisher),
        tradeEvent({ data: { profession: "  ", output: "  " } }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------
// Prioridad de clasificación: nivel 1 gana a nivel 2
// -------------------------------------------------------------------

describe("VillagerTradeHandler · prioridad nivel 1 > nivel 2", () => {
  it("librarian + enchanted_book usa pool enchanted_book (no librarian genérico)", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new VillagerTradeHandler().handle(
      fakeContext(publisher),
      tradeEvent({
        data: {
          profession: "librarian",
          output: "minecraft:enchanted_book",
        },
      }),
    );
    const body = publisher.publish.mock.calls[0]![0].body as string;
    // Primera variante del pool enchanted_book:
    expect(body).toBe(
      "📚 Los bibliotecarios ya comparten conocimiento prohibido.",
    );
  });

  it("librarian + otro output cae a pool librarian genérico", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new VillagerTradeHandler().handle(
      fakeContext(publisher),
      tradeEvent({
        data: { profession: "librarian", output: "minecraft:paper" },
      }),
    );
    const body = publisher.publish.mock.calls[0]![0].body as string;
    // Primera variante del pool librarian genérico:
    expect(body).toBe("📖 La biblioteca del servidor sigue creciendo.");
  });
});

// -------------------------------------------------------------------
// player_uuid: el handler NO lo valida (no lo usa)
// -------------------------------------------------------------------

describe("VillagerTradeHandler · tolerancia con player_uuid", () => {
  it("player_uuid null + trade del catálogo → publica igual (no se usa nombre)", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new VillagerTradeHandler().handle(
      fakeContext(publisher),
      tradeEvent({ playerUuid: null }),
    );
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------------------
// Selección aleatoria (delega al catálogo)
// -------------------------------------------------------------------

describe("VillagerTradeHandler · selección aleatoria", () => {
  it("Math.random varía → body varía dentro del pool", async () => {
    const seen = new Set<string>();
    for (const r of [0, 0.5, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      const publisher = fakePublisher();
      await new VillagerTradeHandler().handle(
        fakeContext(publisher),
        tradeEvent(),
      );
      seen.add(publisher.publish.mock.calls[0]![0].body as string);
      vi.restoreAllMocks();
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

// -------------------------------------------------------------------
// Errores del publisher se propagan (retry via dispatcher)
// -------------------------------------------------------------------

describe("VillagerTradeHandler · errores del publisher", () => {
  it("publisher lanza → el handler propaga el error", async () => {
    stubRandomToFirstVariant();
    const publisher: Publisher & { publish: ReturnType<typeof vi.fn> } = {
      publish: vi.fn(async () => {
        throw new Error("discord caido");
      }),
    };
    await expect(
      new VillagerTradeHandler().handle(fakeContext(publisher), tradeEvent()),
    ).rejects.toThrow(/discord caido/);
  });

  it("publisher NO se llama para trades fuera del catálogo (aunque lanzaría)", async () => {
    const publisher: Publisher & { publish: ReturnType<typeof vi.fn> } = {
      publish: vi.fn(async () => {
        throw new Error("no debe llamarse");
      }),
    };
    await expect(
      new VillagerTradeHandler().handle(
        fakeContext(publisher),
        tradeEvent({
          data: { profession: "farmer", output: "minecraft:wheat", count: 1 },
        }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
