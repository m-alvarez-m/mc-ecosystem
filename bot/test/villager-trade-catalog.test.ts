import { describe, it, expect, vi, afterEach } from "vitest";
import {
  narrateVillagerTrade,
  _INTERNAL,
} from "../src/minecraft/villager-trade-catalog";

// Tests estructurales del Villager Trade Catalog (T14).
//
// Doble objetivo, mismo patrón que los catálogos previos:
//   1. Contrato de `narrateVillagerTrade`: clasificación de dos
//      niveles (profession+output → pool específico; profession
//      → pool genérico; nada → null).
//   2. Invariantes del catálogo (12 pools, 6..8 variantes cada uno,
//      mapping consistente).

afterEach(() => {
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------
// Clasificación — Nivel 1: (profession + output) específico
// -------------------------------------------------------------------

describe("classify · nivel 1a: profession + output específico", () => {
  it.each([
    ["librarian", "minecraft:enchanted_book", "enchanted_book"],
    ["cleric", "minecraft:ender_pearl", "ender_pearl"],
    ["cleric", "minecraft:glowstone", "glowstone"],
    ["cleric", "minecraft:experience_bottle", "experience_bottle"],
    ["farmer", "minecraft:golden_carrot", "golden_carrot"],
  ])(
    "%s + %s → pool específico %s",
    (profession, output, expected) => {
      expect(_INTERNAL.classify(profession, output)).toBe(expected);
    },
  );
});

// -------------------------------------------------------------------
// Clasificación — Nivel 1b: diamond_gear shortcut
// -------------------------------------------------------------------

describe("classify · nivel 1b: diamond_gear shortcut", () => {
  it.each([
    ["toolsmith", "minecraft:diamond_pickaxe"],
    ["toolsmith", "minecraft:diamond_hoe"],
    ["toolsmith", "minecraft:diamond_axe"],
    ["toolsmith", "minecraft:diamond_shovel"],
    ["armorer", "minecraft:diamond_chestplate"],
    ["armorer", "minecraft:diamond_helmet"],
    ["armorer", "minecraft:diamond_leggings"],
    ["armorer", "minecraft:diamond_boots"],
    ["weaponsmith", "minecraft:diamond_sword"],
    ["weaponsmith", "minecraft:diamond_axe"],
  ])(
    "%s + %s → diamond_gear (via prefix)",
    (profession, output) => {
      expect(_INTERNAL.classify(profession, output)).toBe("diamond_gear");
    },
  );

  it("profesión no-smith con diamond_* → NO se activa el shortcut", () => {
    // librarian trading diamond_pickaxe no es una configuración vanilla
    // real, pero verificamos que el shortcut sólo aplica al set correcto.
    expect(_INTERNAL.classify("librarian", "minecraft:diamond_pickaxe")).toBe(
      "librarian", // cae al nivel 2 profesional
    );
  });
});

// -------------------------------------------------------------------
// Clasificación — Nivel 2: profession-only (fallback)
// -------------------------------------------------------------------

describe("classify · nivel 2: profession-only fallback", () => {
  it.each([
    ["librarian", "librarian"],
    ["cleric", "cleric"],
    ["cartographer", "cartographer"],
    ["mason", "mason"],
    ["armorer", "armorer"],
    ["weaponsmith", "weaponsmith"],
  ])(
    "profession=%s con output no-específico → pool genérico %s",
    (profession, expected) => {
      // Un output cualquiera que no dispare match específico ni el
      // shortcut de diamond_gear.
      expect(_INTERNAL.classify(profession, "minecraft:emerald")).toBe(
        expected,
      );
    },
  );

  it("librarian con output no-libro → pool genérico librarian (no enchanted_book)", () => {
    expect(_INTERNAL.classify("librarian", "minecraft:book")).toBe("librarian");
    expect(_INTERNAL.classify("librarian", "minecraft:paper")).toBe("librarian");
  });

  it("cleric con output no-específico → pool genérico cleric", () => {
    expect(_INTERNAL.classify("cleric", "minecraft:rotten_flesh")).toBe(
      "cleric",
    );
    expect(_INTERNAL.classify("cleric", "minecraft:redstone")).toBe("cleric");
  });
});

// -------------------------------------------------------------------
// Clasificación — devuelve null
// -------------------------------------------------------------------

describe("classify · profesiones fuera del catálogo → null", () => {
  it.each([
    ["farmer", "minecraft:wheat"], // farmer sólo dispara golden_carrot
    ["farmer", "minecraft:bread"],
    ["butcher", "minecraft:cooked_beef"],
    ["fisherman", "minecraft:cod"],
    ["fletcher", "minecraft:arrow"],
    ["leatherworker", "minecraft:leather_boots"],
    ["shepherd", "minecraft:white_wool"],
    ["nitwit", "minecraft:emerald"],
    ["none", "minecraft:emerald"],
    ["wandering_trader", "minecraft:sea_pickle"],
    ["profesion_inventada", "minecraft:emerald"],
  ])("%s + %s → null", (profession, output) => {
    expect(_INTERNAL.classify(profession, output)).toBeNull();
  });

  it("profession=null → null (independientemente del output)", () => {
    expect(_INTERNAL.classify(null, "minecraft:enchanted_book")).toBeNull();
    expect(_INTERNAL.classify(null, null)).toBeNull();
  });

  it("output=null con profession soportada → cae al nivel 2 (profession-only)", () => {
    expect(_INTERNAL.classify("cleric", null)).toBe("cleric");
    expect(_INTERNAL.classify("librarian", null)).toBe("librarian");
  });

  it("output=null con profession que sólo tiene match específico → null", () => {
    // farmer sólo dispara golden_carrot. Sin output no hay match.
    expect(_INTERNAL.classify("farmer", null)).toBeNull();
  });
});

// -------------------------------------------------------------------
// Prioridad: nivel 1 gana a nivel 2
// -------------------------------------------------------------------

describe("classify · prioridad (nivel 1 gana a nivel 2)", () => {
  it("cleric + ender_pearl → ender_pearl (no 'cleric')", () => {
    expect(_INTERNAL.classify("cleric", "minecraft:ender_pearl")).toBe(
      "ender_pearl",
    );
  });

  it("librarian + enchanted_book → enchanted_book (no 'librarian')", () => {
    expect(
      _INTERNAL.classify("librarian", "minecraft:enchanted_book"),
    ).toBe("enchanted_book");
  });

  it("armorer + diamond_chestplate → diamond_gear (no 'armorer')", () => {
    expect(
      _INTERNAL.classify("armorer", "minecraft:diamond_chestplate"),
    ).toBe("diamond_gear");
  });
});

// -------------------------------------------------------------------
// narrateVillagerTrade — API pública
// -------------------------------------------------------------------

describe("narrateVillagerTrade · pools específicos", () => {
  it.each([
    ["librarian", "minecraft:enchanted_book", /📚/],
    ["cleric", "minecraft:ender_pearl", /👁/],
    ["cleric", "minecraft:glowstone", /💡/],
    ["cleric", "minecraft:experience_bottle", /🍾/],
    ["farmer", "minecraft:golden_carrot", /🥕/],
    ["armorer", "minecraft:diamond_chestplate", /💎/],
    ["toolsmith", "minecraft:diamond_pickaxe", /💎/],
    ["weaponsmith", "minecraft:diamond_sword", /💎/],
  ])(
    "profession=%s + output=%s produce body con emoji esperado",
    (profession, output, emojiPattern) => {
      const body = narrateVillagerTrade({ profession, output });
      expect(body).not.toBeNull();
      expect(body!).toMatch(emojiPattern);
    },
  );

  it("Math.random=0 elige la PRIMERA variante de enchanted_book", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateVillagerTrade({
      profession: "librarian",
      output: "minecraft:enchanted_book",
    });
    expect(body).toBe(
      "📚 Los bibliotecarios ya comparten conocimiento prohibido.",
    );
  });

  it("Math.random=0 elige la PRIMERA variante de diamond_gear", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateVillagerTrade({
      profession: "weaponsmith",
      output: "minecraft:diamond_sword",
    });
    expect(body).toBe(
      "💎 Los aldeanos ya son capaces de ofrecer equipo digno de una expedición.",
    );
  });

  it("Math.random=0.99 elige la ÚLTIMA variante del pool", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const body = narrateVillagerTrade({
      profession: "librarian",
      output: "minecraft:enchanted_book",
    });
    // Pool 'enchanted_book' tiene 6 variantes; 0.99*6 = 5.94 → floor=5.
    expect(body).toBe(
      "📚 Los libros encantados forman ya parte de la economía local.",
    );
  });
});

describe("narrateVillagerTrade · pools genéricos (nivel 2)", () => {
  it.each([
    ["librarian", "minecraft:book", /📖/],
    ["cleric", "minecraft:rotten_flesh", /⚗/],
    ["cartographer", "minecraft:paper", /🧭/],
    ["mason", "minecraft:polished_granite", /🧱/],
    ["armorer", "minecraft:iron_chestplate", /⚒/],
    ["weaponsmith", "minecraft:iron_sword", /⚔/],
  ])(
    "profession=%s + output no-específico produce body del pool genérico",
    (profession, output, emojiPattern) => {
      const body = narrateVillagerTrade({ profession, output });
      expect(body).not.toBeNull();
      expect(body!).toMatch(emojiPattern);
    },
  );

  it("distintos valores de random producen ≥ 2 frases distintas dentro del mismo pool", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      vi.spyOn(Math, "random").mockReturnValue(i / 6);
      const body = narrateVillagerTrade({
        profession: "cartographer",
        output: "minecraft:paper",
      });
      if (body !== null) seen.add(body);
      vi.restoreAllMocks();
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

describe("narrateVillagerTrade · fuera del catálogo → null (no publicar)", () => {
  it.each([
    ["farmer", "minecraft:wheat"],
    ["farmer", "minecraft:bread"],
    ["butcher", "minecraft:cooked_beef"],
    ["fisherman", "minecraft:cod"],
    ["fletcher", "minecraft:arrow"],
    ["leatherworker", "minecraft:leather_helmet"],
    ["shepherd", "minecraft:white_wool"],
    ["nitwit", "minecraft:emerald"],
    ["wandering_trader", "minecraft:sea_pickle"],
    ["profesion_desconocida", "minecraft:emerald"],
  ])("profession=%s + output=%s → null", (profession, output) => {
    expect(narrateVillagerTrade({ profession, output })).toBeNull();
  });

  it("profession=null → null", () => {
    expect(
      narrateVillagerTrade({
        profession: null,
        output: "minecraft:enchanted_book",
      }),
    ).toBeNull();
  });

  it("ambos null → null", () => {
    expect(
      narrateVillagerTrade({ profession: null, output: null }),
    ).toBeNull();
  });
});

// -------------------------------------------------------------------
// Invariantes del catálogo
// -------------------------------------------------------------------

describe("Catálogo · invariantes estructurales", () => {
  it("cubre exactamente 12 pools (6 específicos + 6 genéricos)", () => {
    const expected = [
      // Específicos
      "enchanted_book",
      "ender_pearl",
      "glowstone",
      "experience_bottle",
      "diamond_gear",
      "golden_carrot",
      // Genéricos
      "librarian",
      "cleric",
      "cartographer",
      "mason",
      "armorer",
      "weaponsmith",
    ].sort();
    expect(Object.keys(_INTERNAL.VARIANTS).sort()).toEqual(expected);
  });

  it("cada pool tiene entre 6 y 8 variantes (spec T14)", () => {
    for (const [pool, variants] of Object.entries(_INTERNAL.VARIANTS)) {
      expect(variants.length, `pool ${pool}`).toBeGreaterThanOrEqual(6);
      expect(variants.length, `pool ${pool}`).toBeLessThanOrEqual(8);
    }
  });

  it("total de variantes está en el rango objetivo (60..80)", () => {
    let total = 0;
    for (const variants of Object.values(_INTERNAL.VARIANTS)) {
      total += variants.length;
    }
    expect(total).toBeGreaterThanOrEqual(60);
    expect(total).toBeLessThanOrEqual(80);
  });

  it("cada variante produce string no vacío", () => {
    for (const [pool, variants] of Object.entries(_INTERNAL.VARIANTS)) {
      for (const variant of variants) {
        const out = variant();
        expect(out.length, `${pool}`).toBeGreaterThan(0);
      }
    }
  });

  it("cada pool específico de SPECIFIC_BY_PROFESSION apunta a un pool existente", () => {
    for (const [profession, outputMap] of _INTERNAL.SPECIFIC_BY_PROFESSION) {
      for (const [output, pool] of outputMap) {
        expect(
          _INTERNAL.VARIANTS[pool],
          `${profession} + ${output} → ${pool}`,
        ).toBeDefined();
      }
    }
  });

  it("cada pool de PROFESSION_TO_POOL apunta a un pool existente", () => {
    for (const [profession, pool] of _INTERNAL.PROFESSION_TO_POOL) {
      expect(_INTERNAL.VARIANTS[pool], `${profession} → ${pool}`).toBeDefined();
    }
  });

  it("DIAMOND_GEAR_PROFESSIONS incluye las tres profesiones herreras", () => {
    expect(_INTERNAL.DIAMOND_GEAR_PROFESSIONS.has("toolsmith")).toBe(true);
    expect(_INTERNAL.DIAMOND_GEAR_PROFESSIONS.has("armorer")).toBe(true);
    expect(_INTERNAL.DIAMOND_GEAR_PROFESSIONS.has("weaponsmith")).toBe(true);
    // Contramuestra: profesiones que NO son herreras.
    expect(_INTERNAL.DIAMOND_GEAR_PROFESSIONS.has("librarian")).toBe(false);
    expect(_INTERNAL.DIAMOND_GEAR_PROFESSIONS.has("farmer")).toBe(false);
  });
});
