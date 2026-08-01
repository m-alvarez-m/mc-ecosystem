import { describe, it, expect, vi, afterEach } from "vitest";
import {
  narrateExploration,
  _INTERNAL,
} from "../src/minecraft/exploration-catalog";

// Tests estructurales del Exploration Catalog (T17).
//
// Doble objetivo:
//   1. Contrato de `narrateExploration`: filtro de rejilla, mapeo
//      de mundos, buckets de distancia, tolerancia a inputs
//      inválidos.
//   2. Invariantes del catálogo (7 pools, 6..8 variantes cada uno,
//      narrativa impersonal, total 50..70 frases).

afterEach(() => {
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------
// classifyDimension — nombre de mundo → tipo de dimensión
// -------------------------------------------------------------------

describe("classifyDimension", () => {
  it.each([
    ["world", "overworld"],
    ["world_the_normal", "overworld"],
    ["world_nether", "nether"],
    ["world_the_nether", "nether"],
    ["world_the_end", "end"],
    ["world_end", "end"],
  ])("world=%s → %s", (name, expected) => {
    expect(_INTERNAL.classifyDimension(name)).toBe(expected);
  });

  it.each([
    ["world_creative"],
    ["arena"],
    ["skyblock"],
    ["nombre_raro"],
    [""],
  ])("world=%s (custom) → unknown", (name) => {
    expect(_INTERNAL.classifyDimension(name)).toBe("unknown");
  });
});

// -------------------------------------------------------------------
// Filtro de rejilla (multiplicaciones de GRID_STEP)
// -------------------------------------------------------------------

describe("isOnSamplingGrid", () => {
  it("acepta multiplicaciones exactas de GRID_STEP", () => {
    expect(_INTERNAL.isOnSamplingGrid(0, 0)).toBe(true);
    expect(_INTERNAL.isOnSamplingGrid(16, 0)).toBe(true);
    expect(_INTERNAL.isOnSamplingGrid(0, 16)).toBe(true);
    expect(_INTERNAL.isOnSamplingGrid(32, 48)).toBe(true);
    expect(_INTERNAL.isOnSamplingGrid(128, -256)).toBe(true);
    expect(_INTERNAL.isOnSamplingGrid(-16, -16)).toBe(true);
  });

  it("rechaza coordenadas que no caen en la rejilla (ambas o cualquiera)", () => {
    expect(_INTERNAL.isOnSamplingGrid(1, 0)).toBe(false);
    expect(_INTERNAL.isOnSamplingGrid(0, 1)).toBe(false);
    expect(_INTERNAL.isOnSamplingGrid(15, 16)).toBe(false);
    expect(_INTERNAL.isOnSamplingGrid(16, 15)).toBe(false);
    expect(_INTERNAL.isOnSamplingGrid(17, 32)).toBe(false);
    expect(_INTERNAL.isOnSamplingGrid(-1, -1)).toBe(false);
  });
});

// -------------------------------------------------------------------
// classify — pool completo (mundo + distancia + rejilla)
// -------------------------------------------------------------------

describe("classify · overworld por distancia (chunk en rejilla)", () => {
  it.each([
    // frontier: d < 1000 bloques (d < 62.5 chunks)
    [{ world: "world", chunkX: 0, chunkZ: 0 }, "frontier"], // d=0
    [{ world: "world", chunkX: 16, chunkZ: 16 }, "frontier"], // d = 16*16*sqrt(2) ≈ 362
    [{ world: "world", chunkX: 32, chunkZ: 32 }, "frontier"], // d ≈ 724
    // wilderness: 1000 ≤ d < 5000 (62.5 ≤ chunk-dist < 312.5)
    [{ world: "world", chunkX: 64, chunkZ: 0 }, "wilderness"], // d = 1024
    [{ world: "world", chunkX: 128, chunkZ: 128 }, "wilderness"], // d ≈ 2896
    [{ world: "world", chunkX: 208, chunkZ: 0 }, "wilderness"], // d = 3328
    // far_wilderness: 5000 ≤ d < 15000
    [{ world: "world", chunkX: 320, chunkZ: 0 }, "far_wilderness"], // d = 5120
    [{ world: "world", chunkX: 512, chunkZ: 512 }, "far_wilderness"], // d ≈ 11585
    // deep_wilderness: d ≥ 15000
    [{ world: "world", chunkX: 1024, chunkZ: 0 }, "deep_wilderness"], // d = 16384
    [{ world: "world", chunkX: -1024, chunkZ: 1024 }, "deep_wilderness"], // d ≈ 23170
  ])("chunk=%o → %s", (input, expected) => {
    expect(_INTERNAL.classify(input)).toBe(expected);
  });
});

describe("classify · nether y end · distancia irrelevante", () => {
  it("Nether: cualquier distancia → 'nether'", () => {
    expect(
      _INTERNAL.classify({ world: "world_nether", chunkX: 0, chunkZ: 0 }),
    ).toBe("nether");
    expect(
      _INTERNAL.classify({ world: "world_nether", chunkX: 1024, chunkZ: 1024 }),
    ).toBe("nether");
    expect(
      _INTERNAL.classify({ world: "world_the_nether", chunkX: -32, chunkZ: 16 }),
    ).toBe("nether");
  });

  it("End: cualquier distancia → 'end'", () => {
    expect(
      _INTERNAL.classify({ world: "world_the_end", chunkX: 0, chunkZ: 0 }),
    ).toBe("end");
    expect(
      _INTERNAL.classify({ world: "world_end", chunkX: 64, chunkZ: 64 }),
    ).toBe("end");
  });
});

describe("classify · unknown_world", () => {
  it.each([
    ["world_creative"],
    ["arena_pvp"],
    ["skyblock"],
    ["multiverse_hub"],
  ])("world=%s → unknown_world", (world) => {
    expect(_INTERNAL.classify({ world, chunkX: 32, chunkZ: 32 })).toBe(
      "unknown_world",
    );
  });
});

describe("classify · rejecciones (null)", () => {
  it("chunk fuera de la rejilla → null (incluso overworld/nether/end)", () => {
    expect(_INTERNAL.classify({ world: "world", chunkX: 1, chunkZ: 0 })).toBeNull();
    expect(_INTERNAL.classify({ world: "world", chunkX: 15, chunkZ: 16 })).toBeNull();
    expect(
      _INTERNAL.classify({ world: "world_nether", chunkX: 17, chunkZ: 32 }),
    ).toBeNull();
    expect(
      _INTERNAL.classify({ world: "world_the_end", chunkX: 32, chunkZ: 1 }),
    ).toBeNull();
  });

  it("world=null → null", () => {
    expect(_INTERNAL.classify({ world: null, chunkX: 0, chunkZ: 0 })).toBeNull();
  });

  it("chunkX o chunkZ null → null", () => {
    expect(
      _INTERNAL.classify({ world: "world", chunkX: null, chunkZ: 0 }),
    ).toBeNull();
    expect(
      _INTERNAL.classify({ world: "world", chunkX: 0, chunkZ: null }),
    ).toBeNull();
  });

  it("chunkX o chunkZ no-entero / no-finito → null", () => {
    expect(
      _INTERNAL.classify({ world: "world", chunkX: 16.5, chunkZ: 0 }),
    ).toBeNull();
    expect(
      _INTERNAL.classify({ world: "world", chunkX: Number.POSITIVE_INFINITY, chunkZ: 0 }),
    ).toBeNull();
    expect(
      _INTERNAL.classify({ world: "world", chunkX: Number.NaN, chunkZ: 0 }),
    ).toBeNull();
  });
});

// -------------------------------------------------------------------
// distanceInBlocks
// -------------------------------------------------------------------

describe("distanceInBlocks", () => {
  it.each([
    [0, 0, 0],
    [1, 0, 16], // 1 chunk = 16 bloques
    [0, 1, 16],
    [3, 4, 80], // 3^2+4^2=25, sqrt=5, 5*16=80
    [-3, -4, 80],
  ])("chunk (%d, %d) → %d bloques", (cx, cz, expected) => {
    expect(_INTERNAL.distanceInBlocks(cx, cz)).toBeCloseTo(expected, 5);
  });
});

// -------------------------------------------------------------------
// narrateExploration — API pública
// -------------------------------------------------------------------

describe("narrateExploration · pools reconocidos publican", () => {
  it.each([
    // Overworld (por distancia)
    [{ world: "world", chunkX: 0, chunkZ: 0 }, /🗺/],
    [{ world: "world", chunkX: 128, chunkZ: 0 }, /🏞/], // d=2048 → wilderness
    [{ world: "world", chunkX: 400, chunkZ: 0 }, /🌄/], // d=6400 → far
    [{ world: "world", chunkX: 1024, chunkZ: 1024 }, /🏔/], // d≈23170 → deep
    // Nether / End
    [{ world: "world_nether", chunkX: 32, chunkZ: 0 }, /🔥/],
    [{ world: "world_the_end", chunkX: 0, chunkZ: 0 }, /👁/],
    // Custom
    [{ world: "arena", chunkX: 16, chunkZ: 16 }, /🌐/],
  ])("input=%o produce body con emoji del pool esperado", (input, emojiPattern) => {
    const body = narrateExploration(input);
    expect(body).not.toBeNull();
    expect(body!).toMatch(emojiPattern);
  });

  it("Math.random=0 elige la PRIMERA variante de frontier", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(
      narrateExploration({ world: "world", chunkX: 0, chunkZ: 0 }),
    ).toBe("🗺️ El servidor acaba de ampliar sus horizontes.");
  });

  it("Math.random=0 elige la PRIMERA variante de nether", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(
      narrateExploration({ world: "world_nether", chunkX: 0, chunkZ: 0 }),
    ).toBe("🔥 El Nether del servidor sigue abriendo nuevos territorios.");
  });

  it("Math.random=0 elige la PRIMERA variante de end", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(
      narrateExploration({ world: "world_the_end", chunkX: 0, chunkZ: 0 }),
    ).toBe("👁️ El End del servidor sigue revelando sus islas.");
  });

  it("Math.random=0.99 elige la ÚLTIMA variante del pool", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    // Pool 'frontier' tiene 8 variantes; 0.99*8 = 7.92 → floor=7 (última).
    expect(
      narrateExploration({ world: "world", chunkX: 0, chunkZ: 0 }),
    ).toBe("🗺️ La periferia inmediata del servidor gana otro fragmento.");
  });

  it("distintos valores de random producen ≥ 2 frases distintas", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      vi.spyOn(Math, "random").mockReturnValue(i / 8);
      const body = narrateExploration({ world: "world", chunkX: 0, chunkZ: 0 });
      if (body !== null) seen.add(body);
      vi.restoreAllMocks();
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

describe("narrateExploration · rejecciones (null)", () => {
  it.each([
    // Fuera de rejilla
    [{ world: "world", chunkX: 1, chunkZ: 0 }],
    [{ world: "world", chunkX: 15, chunkZ: 32 }],
    // Nulls / inválidos
    [{ world: null, chunkX: 0, chunkZ: 0 }],
    [{ world: "world", chunkX: null, chunkZ: 0 }],
    [{ world: "world", chunkX: 0, chunkZ: null }],
    [{ world: "world", chunkX: 16.5, chunkZ: 0 }],
  ])("input=%o → null (no publicar)", (input) => {
    expect(narrateExploration(input)).toBeNull();
  });
});

// -------------------------------------------------------------------
// Impersonalidad — protagonista es el servidor / mundo
// -------------------------------------------------------------------

describe("narrateExploration · narrativa impersonal", () => {
  it("ninguna variante contiene nombres de jugador (word-boundary)", () => {
    const NAMES_PROHIBIDOS = /\b(Miguel|Carlos|Pedro|Vancorbus|Ana)\b/i;
    for (const [category, variants] of Object.entries(_INTERNAL.VARIANTS)) {
      for (const variant of variants) {
        const out = variant();
        expect(out, `${category}: "${out}"`).not.toMatch(NAMES_PROHIBIDOS);
      }
    }
  });

  it("todas las variantes mencionan 'servidor' o 'mundo'", () => {
    for (const [category, variants] of Object.entries(_INTERNAL.VARIANTS)) {
      for (const variant of variants) {
        const out = variant().toLowerCase();
        expect(
          out.includes("servidor") || out.includes("mundo"),
          `${category}: "${variant()}"`,
        ).toBe(true);
      }
    }
  });
});

// -------------------------------------------------------------------
// Invariantes estructurales
// -------------------------------------------------------------------

describe("Catálogo · invariantes estructurales", () => {
  it("cubre exactamente 7 pools", () => {
    const expected = [
      "frontier",
      "wilderness",
      "far_wilderness",
      "deep_wilderness",
      "nether",
      "end",
      "unknown_world",
    ].sort();
    expect(Object.keys(_INTERNAL.VARIANTS).sort()).toEqual(expected);
  });

  it("cada pool tiene entre 6 y 8 variantes (spec T17)", () => {
    for (const [pool, variants] of Object.entries(_INTERNAL.VARIANTS)) {
      expect(variants.length, `pool ${pool}`).toBeGreaterThanOrEqual(6);
      expect(variants.length, `pool ${pool}`).toBeLessThanOrEqual(8);
    }
  });

  it("total de variantes está en el rango objetivo (50..70)", () => {
    let total = 0;
    for (const variants of Object.values(_INTERNAL.VARIANTS)) {
      total += variants.length;
    }
    expect(total).toBeGreaterThanOrEqual(50);
    expect(total).toBeLessThanOrEqual(70);
  });

  it("cada variante produce string no vacío", () => {
    for (const [pool, variants] of Object.entries(_INTERNAL.VARIANTS)) {
      for (const variant of variants) {
        expect(variant().length, pool).toBeGreaterThan(0);
      }
    }
  });

  it("cada world de WORLD_TO_DIMENSION apunta a una dimensión conocida", () => {
    const validKinds = new Set(["overworld", "nether", "end"]);
    for (const [world, kind] of _INTERNAL.WORLD_TO_DIMENSION) {
      expect(validKinds.has(kind), `${world} → ${kind}`).toBe(true);
    }
  });

  it("umbrales de distancia están en orden ascendente y son positivos", () => {
    expect(_INTERNAL.FRONTIER_MAX).toBeGreaterThan(0);
    expect(_INTERNAL.WILDERNESS_MAX).toBeGreaterThan(_INTERNAL.FRONTIER_MAX);
    expect(_INTERNAL.FAR_MAX).toBeGreaterThan(_INTERNAL.WILDERNESS_MAX);
  });

  it("GRID_STEP es entero positivo (rejilla determinística)", () => {
    expect(Number.isInteger(_INTERNAL.GRID_STEP)).toBe(true);
    expect(_INTERNAL.GRID_STEP).toBeGreaterThan(0);
  });
});
