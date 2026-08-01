import { describe, it, expect, vi, afterEach } from "vitest";
import {
  narrateServerMilestone,
  _INTERNAL,
} from "../src/minecraft/server-milestone-catalog";

// Tests estructurales del Server Milestone Catalog.
//
// Doble objetivo, mismo patrón que death-catalog.test.ts y
// dimension-catalog.test.ts:
//   1. Contrato de `narrateServerMilestone` (categorías esperadas
//      producen frases, fallback funciona con y sin nombre).
//   2. Invariantes del catálogo (mínimos por categoría, todas las
//      variantes producen string no vacío, mapping consistente).
//
// Los variantes de los 6 hitos actuales son IMPERSONALES por diseño
// (narrativa server-first, no per-player). Cero acoplamiento a
// texto literal salvo para el fallback (texto fijo) y para el
// spot-check de la primera variante de cada pool.

afterEach(() => {
  vi.restoreAllMocks();
});

describe("narrateServerMilestone · hitos canónicos (6 what conocidos)", () => {
  it.each([
    ["diamond", /💎/, /diamante|era|brillo|capítulo|tierra|historia|nunca/i],
    ["nether", /🔥/, /Nether|portal|calor|expedición|otro mundo/i],
    ["end", /👁/, /End|vacío|último capítulo|portal final|principio del fin/i],
    ["elytra", /🪽/, /Elytra|vuelo|alturas|cielo|caminar|viajar/i],
    ["wither", /☠/, /Wither|oscuridad|desafío|invocar|caos|paz terminó/i],
    ["ender_dragon", /🐉/, /Dragón|End|enemigo|historia|cielo|era/i],
  ])(
    "what=%s produce narración con emoji y palabras clave",
    (what, emojiPattern, textPattern) => {
      const body = narrateServerMilestone({ what, playerName: "Miguel" });
      expect(body).toMatch(emojiPattern);
      expect(body).toMatch(textPattern);
    },
  );

  it("los hitos canónicos NO interpolan el nombre del jugador (narrativa impersonal)", () => {
    // Con Math.random=0 fijado, para cada hito el body debe ser
    // EXACTAMENTE la primera variante — no contiene el nombre.
    const cases: Array<[string, string]> = [
      ["diamond", "💎 El servidor acaba de encontrar su primer diamante."],
      ["nether", "🔥 El Nether ya no está inexplorado."],
      ["end", "👁️ El End acaba de recibir a su primer visitante."],
      ["elytra", "🪽 El servidor ya conoce el vuelo."],
      ["wither", "☠️ El primer Wither ha despertado."],
      ["ender_dragon", "🐉 El Dragón del End cayó por primera vez."],
    ];
    for (const [what, expected] of cases) {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const body = narrateServerMilestone({ what, playerName: "Miguel" });
      expect(body).toBe(expected);
      expect(body).not.toContain("Miguel");
      vi.restoreAllMocks();
    }
  });
});

describe("narrateServerMilestone · selección aleatoria", () => {
  it("Math.random=0 elige la PRIMERA variante", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateServerMilestone({ what: "diamond", playerName: null });
    expect(body).toBe("💎 El servidor acaba de encontrar su primer diamante.");
  });

  it("Math.random=0.99 elige la ÚLTIMA variante", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const body = narrateServerMilestone({ what: "diamond", playerName: null });
    // Pool 'diamond' tiene 6 variantes; 0.99*6 = 5.94 → floor=5 (última).
    expect(body).toBe('💎 Nunca volverá a existir un "primer diamante".');
  });

  it("distintos valores de random producen ≥ 2 frases distintas", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      vi.spyOn(Math, "random").mockReturnValue(i / 6);
      seen.add(
        narrateServerMilestone({ what: "nether", playerName: null }),
      );
      vi.restoreAllMocks();
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

describe("narrateServerMilestone · fallback what desconocido", () => {
  it("what desconocido + nombre disponible: interpola el nombre", () => {
    const body = narrateServerMilestone({
      what: "netherite",
      playerName: "Miguel",
    });
    expect(body).toBe(
      "🏆 Miguel alcanzó un nuevo hito histórico: netherite.",
    );
  });

  it("what desconocido + nombre disponible: interpola el what crudo", () => {
    const body = narrateServerMilestone({
      what: "first_raid",
      playerName: "Vancorbus",
    });
    expect(body).toContain("Vancorbus");
    expect(body).toContain("first_raid");
    expect(body).toMatch(/^🏆 /);
  });

  it("what desconocido + sin nombre: fallback impersonal con el what crudo", () => {
    const body = narrateServerMilestone({
      what: "beacon_full",
      playerName: null,
    });
    expect(body).toBe("🏆 Nuevo hito histórico del servidor: beacon_full.");
  });
});

describe("Catálogo · invariantes estructurales", () => {
  it("catálogo cubre exactamente los 6 hitos que hoy emite el plugin", () => {
    const expected = [
      "diamond",
      "nether",
      "end",
      "elytra",
      "wither",
      "ender_dragon",
    ].sort();
    expect(Object.keys(_INTERNAL.VARIANTS).sort()).toEqual(expected);
  });

  it("cada hito tiene entre 6 y 8 variantes (spec T10)", () => {
    for (const [category, variants] of Object.entries(_INTERNAL.VARIANTS)) {
      expect(variants.length, `categoría ${category}`).toBeGreaterThanOrEqual(6);
      expect(variants.length, `categoría ${category}`).toBeLessThanOrEqual(8);
    }
  });

  it("cada variante produce string no vacío", () => {
    for (const [category, variants] of Object.entries(_INTERNAL.VARIANTS)) {
      for (const variant of variants) {
        const out = variant();
        expect(out.length, `${category}`).toBeGreaterThan(0);
      }
    }
  });

  it("cada what de WHAT_TO_CATEGORY mapea a una categoría existente", () => {
    for (const [what, cat] of _INTERNAL.WHAT_TO_CATEGORY) {
      expect(_INTERNAL.VARIANTS[cat], `what ${what} → ${cat}`).toBeDefined();
    }
  });

  it("los 6 what canónicos del plugin están mapeados 1:1", () => {
    // Valores emitidos hoy por plugin:
    //   WorldListener: nether, end, diamond, elytra
    //   ProgressListener: wither, ender_dragon
    for (const what of [
      "diamond",
      "nether",
      "end",
      "elytra",
      "wither",
      "ender_dragon",
    ]) {
      expect(_INTERNAL.WHAT_TO_CATEGORY.get(what)).toBe(what);
    }
  });
});
