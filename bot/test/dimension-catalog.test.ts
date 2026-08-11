import { describe, it, expect, vi, afterEach } from "vitest";
import { narrateDimension, _INTERNAL } from "../src/minecraft/dimension-catalog";

// Tests estructurales del Dimension Catalog.
//
// Doble objetivo, mismo patrón que death-catalog.test.ts:
//   1. Contrato de `narrateDimension` (categorías esperadas producen
//      frases, fallback funciona, nombre siempre interpolado).
//   2. Invariantes del catálogo (mínimos por dimensión, todas las
//      variantes producen string no vacío, todas las claves del
//      mapping apuntan a categorías existentes).
//
// Cero acoplamiento a texto literal salvo para el fallback (texto
// fijo) y para la selección aleatoria determinística.

const NAME = "Miguel";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("narrateDimension · dimensiones canónicas", () => {
  it.each([
    ["overworld", /🌍/, /Overworld|aventura|mundo|explorador|capítulo|viaje/i],
    ["the_nether", /🔥/, /Nether|infierno|calor|expedición|portal|cielo/i],
    ["the_end", /👁/, /End|dragón|portal|capítulo final|visitante/i],
  ])(
    "dimension=%s produce narración con emoji y nombre interpolado (todas las variantes)",
    (dimension, emojiPattern, textPattern) => {
      // Refactor determinista: iteramos Math.random para forzar cada
      // variante del pool y verificar que TODAS matcheen la regex.
      // Sin este loop el test es flaky (ver fix institucional en el
      // runbook, sección post-FASE A). N=24 cubre pools de 6-8
      // variantes exhaustivamente con margen para crecimiento.
      for (let i = 0; i < 24; i++) {
        vi.spyOn(Math, "random").mockReturnValue(i / 24);
        const body = narrateDimension({ playerName: NAME, dimension });
        expect(body, `variante i=${i}`).toContain(NAME);
        expect(body, `variante i=${i}`).toMatch(emojiPattern);
        expect(body, `variante i=${i}`).toMatch(textPattern);
        vi.restoreAllMocks();
      }
    },
  );
});

describe("narrateDimension · selección aleatoria", () => {
  it("Math.random=0 elige la PRIMERA variante de overworld", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateDimension({ playerName: NAME, dimension: "overworld" });
    expect(body).toBe("🌍 Miguel comenzó una nueva aventura.");
  });

  it("Math.random=0 elige la PRIMERA variante de the_nether", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateDimension({
      playerName: NAME,
      dimension: "the_nether",
    });
    expect(body).toBe("🔥 Miguel cruzó el portal hacia el Nether.");
  });

  it("Math.random=0 elige la PRIMERA variante de the_end", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateDimension({ playerName: NAME, dimension: "the_end" });
    expect(body).toBe("👁️ Miguel llegó al End.");
  });

  it("Math.random=0.99 elige la ÚLTIMA variante de overworld", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const body = narrateDimension({ playerName: NAME, dimension: "overworld" });
    // La pool 'overworld' tiene 6 variantes; 0.99*6 = 5.94 → floor=5 (última).
    expect(body).toBe("🌍 Miguel pisó el Overworld por primera vez.");
  });

  it("distintos valores de random producen ≥ 2 frases distintas", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      vi.spyOn(Math, "random").mockReturnValue(i / 6);
      seen.add(
        narrateDimension({ playerName: NAME, dimension: "overworld" }),
      );
      vi.restoreAllMocks();
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

describe("narrateDimension · fallback dimensión desconocida", () => {
  it("dimensión custom del servidor produce fallback genérico con el nombre crudo", () => {
    const body = narrateDimension({
      playerName: NAME,
      dimension: "world_creative",
    });
    expect(body).toBe("🌐 Miguel descubrió un nuevo mundo: world_creative.");
  });

  it("dimensión desconocida sigue interpolando el nombre del jugador", () => {
    const body = narrateDimension({
      playerName: "Vancorbus",
      dimension: "arena_ki",
    });
    expect(body).toContain("Vancorbus");
    expect(body).toContain("arena_ki");
  });
});

describe("Catálogo · invariantes estructurales", () => {
  it("catálogo cubre las 3 dimensiones canónicas declaradas en el spec", () => {
    const expected = ["overworld", "nether", "end"].sort();
    expect(Object.keys(_INTERNAL.VARIANTS).sort()).toEqual(expected);
  });

  it("cada dimensión tiene mínimo 5 variantes (spec T9)", () => {
    for (const [category, variants] of Object.entries(_INTERNAL.VARIANTS)) {
      expect(variants.length, `categoría ${category}`).toBeGreaterThanOrEqual(5);
    }
  });

  it("cada variante produce string no vacío y contiene el nombre interpolado", () => {
    for (const [category, variants] of Object.entries(_INTERNAL.VARIANTS)) {
      for (const variant of variants) {
        const out = variant(NAME);
        expect(out.length, `${category}`).toBeGreaterThan(0);
        expect(out, `${category}`).toContain(NAME);
      }
    }
  });

  it("cada key de DIMENSION_TO_CATEGORY mapea a una categoría existente", () => {
    for (const [dim, cat] of _INTERNAL.DIMENSION_TO_CATEGORY) {
      expect(_INTERNAL.VARIANTS[cat], `dim ${dim} → ${cat}`).toBeDefined();
    }
  });

  it("las 3 dimensiones canónicas del plugin están mapeadas", () => {
    // Claves reales que emite WorldListener.dimensionName en el plugin.
    expect(_INTERNAL.DIMENSION_TO_CATEGORY.get("overworld")).toBe("overworld");
    expect(_INTERNAL.DIMENSION_TO_CATEGORY.get("the_nether")).toBe("nether");
    expect(_INTERNAL.DIMENSION_TO_CATEGORY.get("the_end")).toBe("end");
  });
});
