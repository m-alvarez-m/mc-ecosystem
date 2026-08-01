import { describe, it, expect, vi, afterEach } from "vitest";
import { TechnologyHandler } from "../src/handlers/technology-handler";
import type { DispatchContext } from "../src/context";
import type { Publisher } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";
import { PlayerNameResolver } from "../src/players";

// Tests de TechnologyHandler (T16 · Technology Chronicle).
//
// Handler puro: sin estado, sin dedup, sin llamadas al resolver
// (narrativa impersonal). Publica sólo cuando data.block es un
// bloque tecnológico curado; todo lo demás se ignora silenciosamente.

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

/** Resolver que grita si es llamado: verifica que el handler NO resuelve. */
function noCallResolver(): PlayerNameResolver {
  const resolve = vi.fn(async () => {
    throw new Error("resolver no debe ser llamado por TechnologyHandler");
  });
  return { resolve } as unknown as PlayerNameResolver;
}

function fakeContext(
  publisher: Publisher,
  resolver: PlayerNameResolver = noCallResolver(),
): DispatchContext {
  return { publisher, playerNameResolver: resolver };
}

const PLACER = "71804e99-f2aa-32dc-bfcb-0ea5cfdda708";

function placeEvent(
  overrides: {
    playerUuid?: string | null;
    eventUuid?: string;
    id?: string;
    data?: Record<string, unknown>;
  } = {},
): EventRecord {
  return {
    id: overrides.id ?? "42",
    event_uuid: overrides.eventUuid ?? "00000000-0000-4000-8000-00000000b001",
    type: "block.place",
    v: 1,
    ts: "2026-08-01T00:00:00.000Z",
    received_at: "2026-08-01T00:00:00.010Z",
    player_uuid: overrides.playerUuid === undefined ? PLACER : overrides.playerUuid,
    world: "world",
    x: 100,
    y: 64,
    z: -50,
    data: overrides.data ?? { block: "minecraft:hopper" },
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

describe("TechnologyHandler · shape", () => {
  it("supports('block.place') = true", () => {
    expect(new TechnologyHandler().supports("block.place")).toBe(true);
  });

  it("supports() de cualquier otro tipo = false", () => {
    const h = new TechnologyHandler();
    expect(h.supports("block.break")).toBe(false);
    expect(h.supports("item.craft")).toBe(false);
    expect(h.supports("technology")).toBe(false);
    expect(h.supports("place")).toBe(false);
  });

  it("publica title y kind acordados", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new TechnologyHandler().handle(fakeContext(publisher), placeEvent());
    const call = publisher.publish.mock.calls[0]![0];
    expect(call.title).toBe("Tecnología del servidor");
    expect(call.kind).toBe("technology");
    expect(typeof call.body).toBe("string");
    expect((call.body as string).length).toBeGreaterThan(0);
  });

  it("NO llama al PlayerNameResolver (narrativa impersonal)", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    // fakeContext por defecto usa un resolver que lanza si es invocado.
    await new TechnologyHandler().handle(fakeContext(publisher), placeEvent());
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------------------
// Bloques del catálogo → publica
// -------------------------------------------------------------------

describe("TechnologyHandler · bloques del catálogo publican", () => {
  it.each([
    ["minecraft:redstone_torch", /⚡/],
    ["minecraft:comparator", /⚡/],
    ["minecraft:piston", /🔧/],
    ["minecraft:sticky_piston", /🔧/],
    ["minecraft:observer", /🔧/],
    ["minecraft:hopper", /🏭/],
    ["minecraft:dropper", /🏭/],
    ["minecraft:powered_rail", /🛤/],
    ["minecraft:blast_furnace", /⚙/],
    ["minecraft:smoker", /⚙/],
    ["minecraft:sculk_sensor", /🔊/],
    ["minecraft:bookshelf", /📚/],
    ["minecraft:iron_door", /🔒/],
  ])("block=%s → publica embed con emoji del pool", async (block, emojiPattern) => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new TechnologyHandler().handle(
      fakeContext(publisher),
      placeEvent({ data: { block } }),
    );
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const body = publisher.publish.mock.calls[0]![0].body as string;
    expect(body).toMatch(emojiPattern);
  });
});

// -------------------------------------------------------------------
// Bloques fuera del catálogo → NO publica (silencioso, no error)
// -------------------------------------------------------------------

describe("TechnologyHandler · bloques fuera del catálogo se ignoran silenciosamente", () => {
  it.each([
    ["minecraft:dirt"],
    ["minecraft:cobblestone"],
    ["minecraft:stone"],
    ["minecraft:oak_planks"],
    ["minecraft:white_wool"],
    ["minecraft:glass"],
    // Exclusiones deliberadas del filtro anti-spam:
    ["minecraft:redstone"], // dust
    ["minecraft:rail"], // rail ordinario
    ["minecraft:furnace"], // furnace ordinario
    // Desconocido / mal formado:
    ["cosa_no_reconocida"],
  ])("block=%s → NO publica, NO lanza", async (block) => {
    const publisher = fakePublisher();
    await expect(
      new TechnologyHandler().handle(
        fakeContext(publisher),
        placeEvent({ data: { block } }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.block ausente → NO publica, NO lanza", async () => {
    const publisher = fakePublisher();
    await expect(
      new TechnologyHandler().handle(
        fakeContext(publisher),
        placeEvent({ data: {} }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.block no-string → NO publica, NO lanza", async () => {
    const publisher = fakePublisher();
    await expect(
      new TechnologyHandler().handle(
        fakeContext(publisher),
        placeEvent({ data: { block: 42 } }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.block vacío / whitespace → NO publica, NO lanza", async () => {
    const publisher = fakePublisher();
    await expect(
      new TechnologyHandler().handle(
        fakeContext(publisher),
        placeEvent({ data: { block: "   " } }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------
// player_uuid: el handler NO lo valida (no lo usa)
// -------------------------------------------------------------------

describe("TechnologyHandler · tolerancia con player_uuid", () => {
  it("player_uuid null + bloque del catálogo → publica igual (nombre no se usa)", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new TechnologyHandler().handle(
      fakeContext(publisher),
      placeEvent({ playerUuid: null }),
    );
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------------------
// Selección aleatoria (delega al catálogo)
// -------------------------------------------------------------------

describe("TechnologyHandler · selección aleatoria", () => {
  it("Math.random varía → body varía dentro del pool", async () => {
    const seen = new Set<string>();
    for (const r of [0, 0.5, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      const publisher = fakePublisher();
      await new TechnologyHandler().handle(
        fakeContext(publisher),
        placeEvent(),
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

describe("TechnologyHandler · errores del publisher", () => {
  it("publisher lanza → el handler propaga el error", async () => {
    stubRandomToFirstVariant();
    const publisher: Publisher & { publish: ReturnType<typeof vi.fn> } = {
      publish: vi.fn(async () => {
        throw new Error("discord caido");
      }),
    };
    await expect(
      new TechnologyHandler().handle(fakeContext(publisher), placeEvent()),
    ).rejects.toThrow(/discord caido/);
  });

  it("publisher NO se llama para bloques fuera del catálogo (aunque lanzaría)", async () => {
    const publisher: Publisher & { publish: ReturnType<typeof vi.fn> } = {
      publish: vi.fn(async () => {
        throw new Error("no debe llamarse");
      }),
    };
    await expect(
      new TechnologyHandler().handle(
        fakeContext(publisher),
        placeEvent({ data: { block: "minecraft:dirt" } }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
