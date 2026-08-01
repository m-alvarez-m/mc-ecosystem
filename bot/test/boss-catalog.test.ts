import { describe, it, expect, vi, afterEach } from "vitest";
import { narrateBossKill, _INTERNAL } from "../src/minecraft/boss-catalog";

// Tests estructurales del Boss Catalog (T11).
//
// Doble objetivo, mismo patrón que los catálogos anteriores:
//   1. Contrato de `narrateBossKill` (bosses canónicos producen
//      variantes del pool, fallback funciona, sección
//      "Participaron:" se formatea correctamente).
//   2. Invariantes del catálogo (mínimos por categoría, mapping
//      consistente, variantes no vacías).

afterEach(() => {
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------
// Narrativa por boss canónico
// -------------------------------------------------------------------

describe("narrateBossKill · bosses canónicos", () => {
  it.each([
    ["wither", /☠/, /Wither|caos|amenaza|monstruo|problema|oscuridad/i],
    ["ender_dragon", /🐉/, /Dragón|End|era|enemigo|batalla|silencio/i],
  ])(
    "boss=%s produce narración con emoji y palabras clave",
    (boss, emojiPattern, textPattern) => {
      const body = narrateBossKill({ boss, participants: [], extraCount: 0 });
      expect(body).toMatch(emojiPattern);
      expect(body).toMatch(textPattern);
    },
  );

  it("Math.random=0 elige la PRIMERA variante de wither", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateBossKill({
      boss: "wither",
      participants: [],
      extraCount: 0,
    });
    expect(body).toBe("☠️ El Wither finalmente cayó.");
  });

  it("Math.random=0 elige la PRIMERA variante de ender_dragon", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateBossKill({
      boss: "ender_dragon",
      participants: [],
      extraCount: 0,
    });
    expect(body).toBe("🐉 El Dragón del End fue derrotado.");
  });

  it("Math.random=0.99 elige la ÚLTIMA variante", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const body = narrateBossKill({
      boss: "wither",
      participants: [],
      extraCount: 0,
    });
    // Pool 'wither' tiene 6 variantes; 0.99*6 = 5.94 → floor=5 (última).
    expect(body).toBe("☠️ La oscuridad fue contenida.");
  });

  it("distintos valores de random producen ≥ 2 frases distintas", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      vi.spyOn(Math, "random").mockReturnValue(i / 6);
      seen.add(
        narrateBossKill({
          boss: "ender_dragon",
          participants: [],
          extraCount: 0,
        }),
      );
      vi.restoreAllMocks();
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

// -------------------------------------------------------------------
// Fallback: boss desconocido
// -------------------------------------------------------------------

describe("narrateBossKill · fallback boss desconocido", () => {
  it("boss desconocido produce fallback genérico con el nombre crudo", () => {
    const body = narrateBossKill({
      boss: "warden",
      participants: [],
      extraCount: 0,
    });
    expect(body).toBe("⚔️ Un gran enemigo fue derrotado: warden.");
  });

  it("boss desconocido combinado con participantes también funciona", () => {
    const body = narrateBossKill({
      boss: "elder_guardian",
      participants: ["Miguel"],
      extraCount: 0,
    });
    expect(body).toContain("⚔️ Un gran enemigo fue derrotado: elder_guardian.");
    expect(body).toContain("Participaron:");
    expect(body).toContain("• Miguel");
  });
});

// -------------------------------------------------------------------
// Sección "Participaron"
// -------------------------------------------------------------------

describe("narrateBossKill · sección participantes", () => {
  it("participants vacío: NO añade sección 'Participaron:'", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateBossKill({
      boss: "wither",
      participants: [],
      extraCount: 0,
    });
    expect(body).toBe("☠️ El Wither finalmente cayó.");
    expect(body).not.toContain("Participaron");
  });

  it("un solo participante: sección con una línea", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateBossKill({
      boss: "wither",
      participants: ["Miguel"],
      extraCount: 0,
    });
    expect(body).toBe(
      "☠️ El Wither finalmente cayó.\n\nParticiparon:\n• Miguel",
    );
  });

  it("3 participantes (bajo tope): todos aparecen, sin cola 'y N más.'", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateBossKill({
      boss: "wither",
      participants: ["Miguel", "Carlos", "Ana"],
      extraCount: 0,
    });
    expect(body).toBe(
      "☠️ El Wither finalmente cayó.\n\nParticiparon:\n• Miguel\n• Carlos\n• Ana",
    );
    expect(body).not.toContain("más.");
  });

  it("exactamente 5 participantes (tope): todos aparecen, sin cola", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateBossKill({
      boss: "wither",
      participants: ["Miguel", "Carlos", "Ana", "Pedro", "Luis"],
      extraCount: 0,
    });
    expect(body).toContain("• Miguel");
    expect(body).toContain("• Carlos");
    expect(body).toContain("• Ana");
    expect(body).toContain("• Pedro");
    expect(body).toContain("• Luis");
    expect(body).not.toContain("más.");
  });

  it("más de 5 participantes: solo aparecen los 5 y se añade '... y N más.'", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateBossKill({
      boss: "wither",
      participants: ["Miguel", "Carlos", "Ana", "Pedro", "Luis"],
      extraCount: 3,
    });
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
  });

  it("extraCount=1 usa 'más.' singular (formato del spec)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateBossKill({
      boss: "wither",
      participants: ["A", "B", "C", "D", "E"],
      extraCount: 1,
    });
    // Formato acordado en el spec: "... y N más." (sin diferenciar
    // singular/plural — mantiene el patrón único).
    expect(body).toContain("... y 1 más.");
  });
});

// -------------------------------------------------------------------
// Invariantes del catálogo
// -------------------------------------------------------------------

describe("Catálogo · invariantes estructurales", () => {
  it("cubre exactamente los 2 bosses emitidos por ProgressListener", () => {
    const expected = ["wither", "ender_dragon"].sort();
    expect(Object.keys(_INTERNAL.VARIANTS).sort()).toEqual(expected);
  });

  it("cada boss tiene entre 6 y 8 variantes (spec T11)", () => {
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

  it("cada boss de BOSS_TO_CATEGORY mapea a una categoría existente", () => {
    for (const [boss, cat] of _INTERNAL.BOSS_TO_CATEGORY) {
      expect(_INTERNAL.VARIANTS[cat], `boss ${boss} → ${cat}`).toBeDefined();
    }
  });

  it("los 2 bosses canónicos del plugin están mapeados 1:1", () => {
    // ProgressListener.onBossDeath sólo distingue WITHER y ENDER_DRAGON.
    expect(_INTERNAL.BOSS_TO_CATEGORY.get("wither")).toBe("wither");
    expect(_INTERNAL.BOSS_TO_CATEGORY.get("ender_dragon")).toBe("ender_dragon");
  });
});
