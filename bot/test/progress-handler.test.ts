import { describe, it, expect, vi, afterEach } from "vitest";
import { ProgressHandler } from "../src/handlers/progress-handler";
import type { DispatchContext } from "../src/context";
import type { Publisher } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";
import { PlayerNameResolver } from "../src/players";

// Tests de ProgressHandler (T15 · Progress Chronicle).
//
// Handler puro: sin estado, sin dedup, sin llamadas al resolver
// (narrativa impersonal). Publica sólo cuando los encantamientos
// del evento contienen al menos uno notable (Mending, Fortune III,
// Efficiency V, ...); todo lo demás se ignora silenciosamente.

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

/** Resolver que grita si se le llama: verifica que el handler NO resuelve. */
function noCallResolver(): PlayerNameResolver {
  const resolve = vi.fn(async () => {
    throw new Error("resolver no debe ser llamado por ProgressHandler");
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

const ENCHANTER = "71804e99-f2aa-32dc-bfcb-0ea5cfdda708";

function enchantEvent(
  overrides: {
    playerUuid?: string | null;
    eventUuid?: string;
    id?: string;
    data?: Record<string, unknown>;
  } = {},
): EventRecord {
  return {
    id: overrides.id ?? "42",
    event_uuid: overrides.eventUuid ?? "00000000-0000-4000-8000-00000000e001",
    type: "item.enchant",
    v: 1,
    ts: "2026-07-30T00:00:00.000Z",
    received_at: "2026-07-30T00:00:00.010Z",
    player_uuid: overrides.playerUuid === undefined ? ENCHANTER : overrides.playerUuid,
    world: "world",
    x: 0,
    y: 64,
    z: 0,
    data:
      overrides.data ??
      {
        item: "minecraft:diamond_pickaxe",
        enchants: [{ id: "minecraft:mending", lvl: 1 }],
        cost_levels: 30,
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

describe("ProgressHandler · shape", () => {
  it("supports('item.enchant') = true", () => {
    expect(new ProgressHandler().supports("item.enchant")).toBe(true);
  });

  it("supports() de cualquier otro tipo = false", () => {
    const h = new ProgressHandler();
    expect(h.supports("item.craft")).toBe(false);
    expect(h.supports("advancement.done")).toBe(false);
    expect(h.supports("enchant")).toBe(false);
  });

  it("publica title y kind acordados", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new ProgressHandler().handle(fakeContext(publisher), enchantEvent());
    const call = publisher.publish.mock.calls[0]![0];
    expect(call.title).toBe("Evolución del servidor");
    expect(call.kind).toBe("progress");
    expect(typeof call.body).toBe("string");
    expect((call.body as string).length).toBeGreaterThan(0);
  });

  it("NO llama al PlayerNameResolver (narrativa impersonal)", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    // El fakeContext por defecto usa un resolver que lanza si es llamado.
    await new ProgressHandler().handle(fakeContext(publisher), enchantEvent());
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------------------
// Encantamientos notables → publica
// -------------------------------------------------------------------

describe("ProgressHandler · encantamientos notables publican", () => {
  it.each([
    // Nivel único
    [{ id: "minecraft:mending", lvl: 1 }, /⚙|🛠|♾|🌍/],
    [{ id: "minecraft:silk_touch", lvl: 1 }, /🪨|🌱|🌍|⚙/],
    [{ id: "minecraft:infinity", lvl: 1 }, /🏹|⚙|🌍/],
    [{ id: "minecraft:channeling", lvl: 1 }, /🔱|⚙|🌍/],
    // Tiered al máximo
    [{ id: "minecraft:fortune", lvl: 3 }, /💎|⛏|🌍/],
    [{ id: "minecraft:efficiency", lvl: 5 }, /⛏|⚙|🌍/],
    [{ id: "minecraft:sharpness", lvl: 5 }, /⚔|🗡|🌍/],
    [{ id: "minecraft:power", lvl: 5 }, /⚔|🗡|🌍/],
    [{ id: "minecraft:impaling", lvl: 5 }, /⚔|🗡|🌍/],
    [{ id: "minecraft:protection", lvl: 4 }, /🛡|⚙|🌍/],
    [{ id: "minecraft:loyalty", lvl: 3 }, /🔱|⚙|🌍/],
    [{ id: "minecraft:riptide", lvl: 3 }, /🔱|⚙|🌍/],
    [{ id: "minecraft:unbreaking", lvl: 3 }, /🛠|⚙|🌍/],
  ])("enchant=%o → publica con emoji temático", async (entry, emoji) => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new ProgressHandler().handle(
      fakeContext(publisher),
      enchantEvent({
        data: { item: "minecraft:diamond_pickaxe", enchants: [entry], cost_levels: 30 },
      }),
    );
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const body = publisher.publish.mock.calls[0]![0].body as string;
    expect(body).toMatch(emoji);
  });

  it("orden de prioridad en handler: mending gana a unbreaking III (multi-enchant en un mismo libro)", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new ProgressHandler().handle(
      fakeContext(publisher),
      enchantEvent({
        data: {
          item: "minecraft:diamond_pickaxe",
          enchants: [
            { id: "minecraft:unbreaking", lvl: 3 },
            { id: "minecraft:mending", lvl: 1 },
          ],
          cost_levels: 30,
        },
      }),
    );
    const body = publisher.publish.mock.calls[0]![0].body as string;
    // Primera variante del pool mending
    expect(body).toBe(
      "⚙️ El servidor acaba de aprender a reparar lo que creía perdido.",
    );
  });

  it("orden de prioridad en handler: protection_mastery gana a weapon_mastery", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new ProgressHandler().handle(
      fakeContext(publisher),
      enchantEvent({
        data: {
          item: "minecraft:diamond_chestplate",
          enchants: [
            { id: "minecraft:sharpness", lvl: 5 },
            { id: "minecraft:protection", lvl: 4 },
          ],
          cost_levels: 30,
        },
      }),
    );
    const body = publisher.publish.mock.calls[0]![0].body as string;
    // Debe venir del pool protection_mastery (emoji 🛡 o 🌍 o ⚙).
    expect(body).toMatch(/🛡|🛡️/);
  });
});

// -------------------------------------------------------------------
// Encantamientos NO notables → NO publica (silencioso)
// -------------------------------------------------------------------

describe("ProgressHandler · encantamientos no-notables se ignoran silenciosamente", () => {
  it.each([
    [[{ id: "minecraft:sharpness", lvl: 1 }]], // Sharpness I no cuenta
    [[{ id: "minecraft:sharpness", lvl: 3 }]], // Sharpness III no cuenta
    [[{ id: "minecraft:fortune", lvl: 1 }]], // Fortune I no cuenta
    [[{ id: "minecraft:fortune", lvl: 2 }]], // Fortune II no cuenta
    [[{ id: "minecraft:efficiency", lvl: 4 }]], // Efficiency IV no cuenta
    [[{ id: "minecraft:protection", lvl: 3 }]], // Protection III no cuenta
    [[{ id: "minecraft:knockback", lvl: 2 }]], // no está en catálogo
    [[{ id: "minecraft:looting", lvl: 3 }]], // no está en catálogo
    [[{ id: "minecraft:feather_falling", lvl: 4 }]], // no está en catálogo
  ])("enchants=%o → NO publica, NO lanza", async (enchants) => {
    const publisher = fakePublisher();
    await expect(
      new ProgressHandler().handle(
        fakeContext(publisher),
        enchantEvent({
          data: { item: "minecraft:iron_sword", enchants, cost_levels: 5 },
        }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.enchants ausente → NO publica, NO lanza", async () => {
    const publisher = fakePublisher();
    await expect(
      new ProgressHandler().handle(
        fakeContext(publisher),
        enchantEvent({ data: { item: "minecraft:diamond_pickaxe", cost_levels: 3 } }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.enchants no-array → NO publica, NO lanza", async () => {
    const publisher = fakePublisher();
    await expect(
      new ProgressHandler().handle(
        fakeContext(publisher),
        enchantEvent({
          data: { item: "x", enchants: "no-array", cost_levels: 3 },
        }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.enchants array vacío → NO publica, NO lanza", async () => {
    const publisher = fakePublisher();
    await expect(
      new ProgressHandler().handle(
        fakeContext(publisher),
        enchantEvent({ data: { item: "x", enchants: [], cost_levels: 3 } }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("entradas corruptas en enchants se filtran (defensivo)", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new ProgressHandler().handle(
      fakeContext(publisher),
      enchantEvent({
        data: {
          item: "minecraft:diamond_pickaxe",
          // Mezcla: entrada válida + basura variada + entrada válida.
          enchants: [
            null,
            "no-object",
            { id: 42, lvl: 1 }, // id no-string
            { id: "minecraft:knockback" }, // sin lvl
            { id: "minecraft:sharpness", lvl: "5" }, // lvl no-number
            { id: "minecraft:mending", lvl: 1 }, // ← esta sobrevive
          ],
          cost_levels: 30,
        },
      }),
    );
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const body = publisher.publish.mock.calls[0]![0].body as string;
    // Debe salir del pool mending.
    expect(body).toBe(
      "⚙️ El servidor acaba de aprender a reparar lo que creía perdido.",
    );
  });
});

// -------------------------------------------------------------------
// player_uuid: el handler NO lo valida (no lo usa)
// -------------------------------------------------------------------

describe("ProgressHandler · tolerancia con player_uuid", () => {
  it("player_uuid null + enchant notable → publica igual (nombre no se usa)", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new ProgressHandler().handle(
      fakeContext(publisher),
      enchantEvent({ playerUuid: null }),
    );
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------------------
// Selección aleatoria (delega al catálogo)
// -------------------------------------------------------------------

describe("ProgressHandler · selección aleatoria", () => {
  it("Math.random varía → body varía dentro del pool", async () => {
    const seen = new Set<string>();
    for (const r of [0, 0.5, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      const publisher = fakePublisher();
      await new ProgressHandler().handle(
        fakeContext(publisher),
        enchantEvent(),
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

describe("ProgressHandler · errores del publisher", () => {
  it("publisher lanza → el handler propaga el error", async () => {
    stubRandomToFirstVariant();
    const publisher: Publisher & { publish: ReturnType<typeof vi.fn> } = {
      publish: vi.fn(async () => {
        throw new Error("discord caido");
      }),
    };
    await expect(
      new ProgressHandler().handle(fakeContext(publisher), enchantEvent()),
    ).rejects.toThrow(/discord caido/);
  });

  it("publisher NO se llama para eventos no-notables (aunque lanzaría)", async () => {
    const publisher: Publisher & { publish: ReturnType<typeof vi.fn> } = {
      publish: vi.fn(async () => {
        throw new Error("no debe llamarse");
      }),
    };
    await expect(
      new ProgressHandler().handle(
        fakeContext(publisher),
        enchantEvent({
          data: {
            item: "x",
            enchants: [{ id: "minecraft:sharpness", lvl: 1 }],
            cost_levels: 3,
          },
        }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
