import { describe, it, expect, vi, afterEach } from "vitest";
import { ExplorationHandler } from "../src/handlers/exploration-handler";
import type { DispatchContext } from "../src/context";
import type { Publisher } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";
import { PlayerNameResolver } from "../src/players";

// Tests de ExplorationHandler (T17 · Exploration Chronicle).
//
// Handler puro: sin estado, sin dedup, sin llamadas al resolver
// (narrativa impersonal). Publica sólo cuando el chunk cae en la
// rejilla de muestreo (mult. de 16 en X y Z) y el mundo/coords
// son válidos; todo lo demás se ignora silenciosamente.

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

/** Resolver que grita si es llamado: verifica que el handler NO resuelve. */
function noCallResolver(): PlayerNameResolver {
  const resolve = vi.fn(async () => {
    throw new Error("resolver no debe ser llamado por ExplorationHandler");
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

const DISCOVERER = "71804e99-f2aa-32dc-bfcb-0ea5cfdda708";

function chunkEvent(
  overrides: {
    playerUuid?: string | null;
    eventUuid?: string;
    id?: string;
    world?: string | null;
    x?: number | null;
    z?: number | null;
    data?: Record<string, unknown>;
  } = {},
): EventRecord {
  return {
    id: overrides.id ?? "42",
    event_uuid: overrides.eventUuid ?? "00000000-0000-4000-8000-00000000c001",
    type: "chunk.first_load",
    v: 1,
    ts: "2026-08-01T00:00:00.000Z",
    received_at: "2026-08-01T00:00:00.010Z",
    player_uuid: overrides.playerUuid === undefined ? DISCOVERER : overrides.playerUuid,
    world: overrides.world === undefined ? "world" : overrides.world,
    x: overrides.x === undefined ? 0 : overrides.x,
    y: null,
    z: overrides.z === undefined ? 0 : overrides.z,
    data: overrides.data ?? { chunk_x: 0, chunk_z: 0 },
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

describe("ExplorationHandler · shape", () => {
  it("supports('chunk.first_load') = true", () => {
    expect(new ExplorationHandler().supports("chunk.first_load")).toBe(true);
  });

  it("supports() de cualquier otro tipo = false", () => {
    const h = new ExplorationHandler();
    expect(h.supports("chunk.load")).toBe(false);
    expect(h.supports("block.place")).toBe(false);
    expect(h.supports("dimension.enter")).toBe(false);
    expect(h.supports("exploration")).toBe(false);
  });

  it("publica title y kind acordados", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new ExplorationHandler().handle(fakeContext(publisher), chunkEvent());
    const call = publisher.publish.mock.calls[0]![0];
    expect(call.title).toBe("Exploración del servidor");
    expect(call.kind).toBe("exploration");
    expect(typeof call.body).toBe("string");
    expect((call.body as string).length).toBeGreaterThan(0);
  });

  it("NO llama al PlayerNameResolver (narrativa impersonal)", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    // fakeContext por defecto usa resolver que lanza si es invocado.
    await new ExplorationHandler().handle(fakeContext(publisher), chunkEvent());
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------------------
// Chunks en rejilla publican
// -------------------------------------------------------------------

describe("ExplorationHandler · chunks en la rejilla publican", () => {
  it.each([
    // Overworld
    [{ world: "world", data: { chunk_x: 0, chunk_z: 0 } }, /🗺/],
    [{ world: "world", data: { chunk_x: 128, chunk_z: 0 } }, /🏞/], // d=2048
    [{ world: "world", data: { chunk_x: 400, chunk_z: 0 } }, /🌄/], // d=6400
    [{ world: "world", data: { chunk_x: 1024, chunk_z: 1024 } }, /🏔/], // d≈23170
    // Nether/End
    [{ world: "world_nether", data: { chunk_x: 32, chunk_z: 0 } }, /🔥/],
    [{ world: "world_the_end", data: { chunk_x: 0, chunk_z: 0 } }, /👁/],
    // Custom
    [{ world: "arena", data: { chunk_x: 16, chunk_z: 16 } }, /🌐/],
  ])("input=%o → publica con emoji del pool", async (overrides, emojiPattern) => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new ExplorationHandler().handle(
      fakeContext(publisher),
      chunkEvent(overrides),
    );
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const body = publisher.publish.mock.calls[0]![0].body as string;
    expect(body).toMatch(emojiPattern);
  });
});

// -------------------------------------------------------------------
// Chunks fuera de rejilla / payload inválido → NO publica
// -------------------------------------------------------------------

describe("ExplorationHandler · chunks fuera de rejilla se ignoran silenciosamente", () => {
  it.each([
    // Off-grid: sólo uno de los ejes fuera basta
    [{ chunk_x: 1, chunk_z: 0 }],
    [{ chunk_x: 0, chunk_z: 1 }],
    [{ chunk_x: 15, chunk_z: 32 }],
    [{ chunk_x: 32, chunk_z: 15 }],
    [{ chunk_x: -1, chunk_z: -1 }],
    // Off-grid en Nether también
    [{ chunk_x: 17, chunk_z: 32 }],
  ])("chunk (%o) fuera de rejilla → NO publica, NO lanza", async (data) => {
    const publisher = fakePublisher();
    await expect(
      new ExplorationHandler().handle(
        fakeContext(publisher),
        chunkEvent({ data }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.chunk_x ausente → NO publica, NO lanza", async () => {
    const publisher = fakePublisher();
    await expect(
      new ExplorationHandler().handle(
        fakeContext(publisher),
        chunkEvent({ data: { chunk_z: 0 } }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.chunk_z ausente → NO publica, NO lanza", async () => {
    const publisher = fakePublisher();
    await expect(
      new ExplorationHandler().handle(
        fakeContext(publisher),
        chunkEvent({ data: { chunk_x: 0 } }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.chunk_x no-integer (float) → NO publica, NO lanza", async () => {
    const publisher = fakePublisher();
    await expect(
      new ExplorationHandler().handle(
        fakeContext(publisher),
        chunkEvent({ data: { chunk_x: 16.5, chunk_z: 0 } }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.chunk_x no-number → NO publica, NO lanza", async () => {
    const publisher = fakePublisher();
    await expect(
      new ExplorationHandler().handle(
        fakeContext(publisher),
        chunkEvent({ data: { chunk_x: "no-numero", chunk_z: 0 } }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("world null → NO publica, NO lanza", async () => {
    const publisher = fakePublisher();
    await expect(
      new ExplorationHandler().handle(
        fakeContext(publisher),
        chunkEvent({ world: null }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------
// player_uuid: el handler NO lo valida (no lo usa)
// -------------------------------------------------------------------

describe("ExplorationHandler · tolerancia con player_uuid", () => {
  it("player_uuid null + chunk válido → publica igual", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    await new ExplorationHandler().handle(
      fakeContext(publisher),
      chunkEvent({ playerUuid: null }),
    );
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------------------
// Selección aleatoria delegada al catálogo
// -------------------------------------------------------------------

describe("ExplorationHandler · selección aleatoria", () => {
  it("Math.random varía → body varía dentro del pool", async () => {
    const seen = new Set<string>();
    for (const r of [0, 0.5, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      const publisher = fakePublisher();
      await new ExplorationHandler().handle(
        fakeContext(publisher),
        chunkEvent(),
      );
      seen.add(publisher.publish.mock.calls[0]![0].body as string);
      vi.restoreAllMocks();
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

// -------------------------------------------------------------------
// Errores del publisher se propagan
// -------------------------------------------------------------------

describe("ExplorationHandler · errores del publisher", () => {
  it("publisher lanza → el handler propaga el error", async () => {
    stubRandomToFirstVariant();
    const publisher: Publisher & { publish: ReturnType<typeof vi.fn> } = {
      publish: vi.fn(async () => {
        throw new Error("discord caido");
      }),
    };
    await expect(
      new ExplorationHandler().handle(fakeContext(publisher), chunkEvent()),
    ).rejects.toThrow(/discord caido/);
  });

  it("publisher NO se llama para chunks off-grid (aunque lanzaría)", async () => {
    const publisher: Publisher & { publish: ReturnType<typeof vi.fn> } = {
      publish: vi.fn(async () => {
        throw new Error("no debe llamarse");
      }),
    };
    await expect(
      new ExplorationHandler().handle(
        fakeContext(publisher),
        chunkEvent({ data: { chunk_x: 1, chunk_z: 0 } }),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
