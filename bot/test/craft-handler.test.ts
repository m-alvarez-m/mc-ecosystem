import { describe, it, expect, vi, afterEach } from "vitest";
import { CraftHandler } from "../src/handlers/craft-handler";
import type { DispatchContext } from "../src/context";
import type { Publisher } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";
import { PlayerNameResolver } from "../src/players";

// Tests de CraftHandler (T13 · Craft Chronicle).
//
// El handler es puro: sin estado, sin dedup, sin llamadas al
// resolver (narrativa impersonal). Sólo publica cuando el item
// pertenece al catálogo; cualquier otro item se ignora
// silenciosamente sin lanzar.

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

/** Resolver que grita si se le llama: verifica que el handler NO resuelve. */
function noCallResolver(): PlayerNameResolver {
  const resolve = vi.fn(async () => {
    throw new Error("resolver no debe ser llamado por CraftHandler");
  });
  return { resolve } as unknown as PlayerNameResolver;
}

function fakeContext(
  publisher: Publisher,
  resolver: PlayerNameResolver = noCallResolver(),
): DispatchContext {
  return { publisher, playerNameResolver: resolver, logger: { warn: () => undefined }, freshnessThresholdMs: 120000,
      lifecycleState: { get: () => "unknown" as const, set: () => undefined }, lifecycleState: { get: () => "unknown", set: () => undefined } };
}

const CRAFTER = "71804e99-f2aa-32dc-bfcb-0ea5cfdda708";

function craftEvent(
  overrides: {
    playerUuid?: string | null;
    eventUuid?: string;
    id?: string;
    data?: Record<string, unknown>;
  } = {},
): EventRecord {
  return {
    id: overrides.id ?? "42",
    event_uuid: overrides.eventUuid ?? "00000000-0000-4000-8000-00000000c001",
    type: "item.craft",
    v: 1,
    ts: "2026-07-30T00:00:00.000Z",
    received_at: "2026-07-30T00:00:00.010Z",
    player_uuid: overrides.playerUuid === undefined ? CRAFTER : overrides.playerUuid,
    world: "world",
    x: 0,
    y: 64,
    z: 0,
    data: overrides.data ?? { item: "minecraft:beacon", count: 1 },
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

describe("CraftHandler · shape", () => {
  it("supports('item.craft') = true", () => {
    expect(new CraftHandler().supports("item.craft")).toBe(true);
  });

  it("supports() de cualquier otro tipo = false", () => {
    const h = new CraftHandler();
    expect(h.supports("item.enchant")).toBe(false);
    expect(h.supports("player.death")).toBe(false);
    expect(h.supports("craft")).toBe(false);
  });

  it("publica title y kind acordados", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new CraftHandler().handle(fakeContext(publisher), craftEvent());
    const call = publisher.publish.mock.calls[0]![0];
    expect(call.title).toBe("Hito de crafteo");
    expect(call.kind).toBe("craft_milestone");
    expect(typeof call.body).toBe("string");
    expect((call.body as string).length).toBeGreaterThan(0);
  });

  it("NO llama al PlayerNameResolver (narrativa impersonal)", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    // Si el handler llamara al resolver, éste lanzaría y el test fallaría.
    await new CraftHandler().handle(fakeContext(publisher), craftEvent());
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------------------
// Items del catálogo → publica
// -------------------------------------------------------------------

describe("CraftHandler · items del catálogo publican", () => {
  it.each([
    ["minecraft:beacon", /✨/],
    ["minecraft:enchanting_table", /📖/],
    ["minecraft:ender_chest", /📦/],
    ["minecraft:shulker_box", /🎒/],
    ["minecraft:white_shulker_box", /🎒/], // vía sufijo
    ["minecraft:red_shulker_box", /🎒/],
    ["minecraft:smithing_table", /🛠/],
    ["minecraft:anvil", /🔨/],
    ["minecraft:lodestone", /🧭/],
    ["minecraft:netherite_ingot", /⚒/],
  ])("item=%s → publica embed con emoji del pool", async (item, emojiPattern) => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new CraftHandler().handle(
      fakeContext(publisher),
      craftEvent({ data: { item, count: 1 } }),
    );
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const body = publisher.publish.mock.calls[0]![0].body as string;
    expect(body).toMatch(emojiPattern);
  });
});

// -------------------------------------------------------------------
// Items fuera del catálogo → NO publica (silencioso, no error)
// -------------------------------------------------------------------

describe("CraftHandler · items fuera del catálogo se ignoran silenciosamente", () => {
  it.each([
    ["minecraft:stick"],
    ["minecraft:torch"],
    ["minecraft:furnace"],
    ["minecraft:crafting_table"],
    ["minecraft:oak_planks"],
    ["minecraft:bread"],
    ["minecraft:diamond_sword"],
    ["minecraft:netherite_pickaxe"], // no llega por CraftItemEvent
    ["cosa_no_reconocida"],
  ])("item=%s → NO publica, NO lanza", async (item) => {
    const publisher = fakePublisher();
    await expect(
      new CraftHandler().handle(
        fakeContext(publisher),
        craftEvent({ data: { item, count: 1 } }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.item ausente → NO publica, NO lanza", async () => {
    const publisher = fakePublisher();
    await expect(
      new CraftHandler().handle(
        fakeContext(publisher),
        craftEvent({ data: { count: 1 } }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.item no-string → NO publica, NO lanza", async () => {
    const publisher = fakePublisher();
    await expect(
      new CraftHandler().handle(
        fakeContext(publisher),
        craftEvent({ data: { item: 42, count: 1 } }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.item vacío/whitespace → NO publica, NO lanza", async () => {
    const publisher = fakePublisher();
    await expect(
      new CraftHandler().handle(
        fakeContext(publisher),
        craftEvent({ data: { item: "   ", count: 1 } }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------
// player_uuid: el handler NO lo valida (no lo usa)
// -------------------------------------------------------------------

describe("CraftHandler · tolerancia con player_uuid", () => {
  it("player_uuid null + item del catálogo → publica igual (nombre no se usa)", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new CraftHandler().handle(
      fakeContext(publisher),
      craftEvent({ playerUuid: null }),
    );
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------------------
// Selección aleatoria (delega al catálogo)
// -------------------------------------------------------------------

describe("CraftHandler · selección aleatoria", () => {
  it("Math.random varía → body varía dentro del pool", async () => {
    const seen = new Set<string>();
    for (const r of [0, 0.5, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      const publisher = fakePublisher();
      await new CraftHandler().handle(fakeContext(publisher), craftEvent());
      seen.add(publisher.publish.mock.calls[0]![0].body as string);
      vi.restoreAllMocks();
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

// -------------------------------------------------------------------
// Errores del publisher se propagan (retry via dispatcher)
// -------------------------------------------------------------------

describe("CraftHandler · errores del publisher", () => {
  it("publisher lanza → el handler propaga el error", async () => {
    stubRandomToFirstVariant();
    const publisher: Publisher & { publish: ReturnType<typeof vi.fn> } = {
      publish: vi.fn(async () => {
        throw new Error("discord caido");
      }),
    };
    await expect(
      new CraftHandler().handle(fakeContext(publisher), craftEvent()),
    ).rejects.toThrow(/discord caido/);
  });

  it("publisher NO se llama para items fuera del catálogo (aunque lanzaría)", async () => {
    const publisher: Publisher & { publish: ReturnType<typeof vi.fn> } = {
      publish: vi.fn(async () => {
        throw new Error("no debe llamarse");
      }),
    };
    await expect(
      new CraftHandler().handle(
        fakeContext(publisher),
        craftEvent({ data: { item: "minecraft:stick", count: 4 } }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
