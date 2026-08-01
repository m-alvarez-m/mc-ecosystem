import { describe, it, expect, vi, afterEach } from "vitest";
import { narrateProgress, _INTERNAL } from "../src/minecraft/progress-catalog";

// Tests estructurales del Progress Catalog (T15).
//
// Doble objetivo, mismo patrón que los catálogos previos:
//   1. Contrato de `narrateProgress`: filtra por (id + umbral de
//      lvl), aplica orden de prioridad cuando varios notables
//      coinciden, devuelve null cuando nada es notable.
//   2. Invariantes del catálogo (9 pools, 6..8 variantes cada uno,
//      mapping consistente).

afterEach(() => {
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------
// Clasificación por (id + lvl)
// -------------------------------------------------------------------

describe("classify · encantamientos de nivel único", () => {
  it.each([
    ["minecraft:mending", 1, "mending"],
    ["minecraft:silk_touch", 1, "silk_touch"],
    ["minecraft:infinity", 1, "infinity"],
    ["minecraft:channeling", 1, "trident_mastery"],
  ])(
    "%s lvl=%i → %s",
    (id, lvl, expected) => {
      expect(_INTERNAL.classify([{ id, lvl }])).toBe(expected);
    },
  );
});

describe("classify · encantamientos tiered — sólo su máximo dispara", () => {
  it.each([
    // Fortune III necesario (I y II ignorados).
    ["minecraft:fortune", 1, null],
    ["minecraft:fortune", 2, null],
    ["minecraft:fortune", 3, "fortune"],
    // Efficiency V necesario.
    ["minecraft:efficiency", 4, null],
    ["minecraft:efficiency", 5, "efficiency"],
    // Sharpness V (weapon_mastery).
    ["minecraft:sharpness", 4, null],
    ["minecraft:sharpness", 5, "weapon_mastery"],
    // Power V (weapon_mastery).
    ["minecraft:power", 4, null],
    ["minecraft:power", 5, "weapon_mastery"],
    // Impaling V (weapon_mastery).
    ["minecraft:impaling", 4, null],
    ["minecraft:impaling", 5, "weapon_mastery"],
    // Protection IV.
    ["minecraft:protection", 3, null],
    ["minecraft:protection", 4, "protection_mastery"],
    // Loyalty III (trident).
    ["minecraft:loyalty", 2, null],
    ["minecraft:loyalty", 3, "trident_mastery"],
    // Riptide III (trident).
    ["minecraft:riptide", 2, null],
    ["minecraft:riptide", 3, "trident_mastery"],
    // Unbreaking III.
    ["minecraft:unbreaking", 2, null],
    ["minecraft:unbreaking", 3, "unbreaking_iii"],
  ])("%s lvl=%i → %s", (id, lvl, expected) => {
    expect(_INTERNAL.classify([{ id, lvl }])).toBe(expected);
  });
});

describe("classify · encantamientos no-notables o desconocidos → null", () => {
  it.each([
    // Existen en vanilla pero no están en el catálogo → null.
    ["minecraft:knockback", 2, null],
    ["minecraft:fire_aspect", 2, null],
    ["minecraft:looting", 3, null],
    ["minecraft:respiration", 3, null],
    ["minecraft:feather_falling", 4, null],
    ["minecraft:aqua_affinity", 1, null],
    // No existentes (defensivo).
    ["minecraft:cosa_inventada", 1, null],
  ])("%s lvl=%i → null", (id, lvl, expected) => {
    expect(_INTERNAL.classify([{ id, lvl }])).toBe(expected);
  });

  it("array vacío → null", () => {
    expect(_INTERNAL.classify([])).toBeNull();
  });

  it("nivel 0 en un notable → null (defensivo)", () => {
    expect(_INTERNAL.classify([{ id: "minecraft:mending", lvl: 0 }])).toBeNull();
  });
});

// -------------------------------------------------------------------
// Prioridad cuando varios notables coinciden
// -------------------------------------------------------------------

describe("classify · orden de prioridad multi-enchant", () => {
  it("mending gana a todos", () => {
    // Escenario realista: Mending + Unbreaking III en un mismo libro.
    expect(
      _INTERNAL.classify([
        { id: "minecraft:mending", lvl: 1 },
        { id: "minecraft:unbreaking", lvl: 3 },
      ]),
    ).toBe("mending");
  });

  it("mending gana incluso a otro notable poderoso", () => {
    expect(
      _INTERNAL.classify([
        { id: "minecraft:mending", lvl: 1 },
        { id: "minecraft:sharpness", lvl: 5 },
      ]),
    ).toBe("mending");
  });

  it("infinity > silk_touch > fortune", () => {
    expect(
      _INTERNAL.classify([
        { id: "minecraft:silk_touch", lvl: 1 },
        { id: "minecraft:infinity", lvl: 1 },
      ]),
    ).toBe("infinity");
    expect(
      _INTERNAL.classify([
        { id: "minecraft:fortune", lvl: 3 },
        { id: "minecraft:silk_touch", lvl: 1 },
      ]),
    ).toBe("silk_touch");
  });

  it("protection_mastery > weapon_mastery (spec T15: defensa habilita más progreso)", () => {
    expect(
      _INTERNAL.classify([
        { id: "minecraft:sharpness", lvl: 5 },
        { id: "minecraft:protection", lvl: 4 },
      ]),
    ).toBe("protection_mastery");
    expect(
      _INTERNAL.classify([
        { id: "minecraft:power", lvl: 5 },
        { id: "minecraft:protection", lvl: 4 },
      ]),
    ).toBe("protection_mastery");
  });

  it("weapon_mastery > trident_mastery > unbreaking_iii", () => {
    expect(
      _INTERNAL.classify([
        { id: "minecraft:sharpness", lvl: 5 },
        { id: "minecraft:loyalty", lvl: 3 },
      ]),
    ).toBe("weapon_mastery");
    expect(
      _INTERNAL.classify([
        { id: "minecraft:channeling", lvl: 1 },
        { id: "minecraft:unbreaking", lvl: 3 },
      ]),
    ).toBe("trident_mastery");
  });

  it("orden canónico (spec T15) reflejado en PRIORITY_ORDER", () => {
    // Verificación explícita de la secuencia exacta del spec.
    expect(_INTERNAL.PRIORITY_ORDER).toEqual([
      "mending",
      "infinity",
      "silk_touch",
      "fortune",
      "efficiency",
      "protection_mastery",
      "weapon_mastery",
      "trident_mastery",
      "unbreaking_iii",
    ]);
  });

  it("unbreaking_iii es el último — cualquier otro notable gana", () => {
    expect(
      _INTERNAL.classify([
        { id: "minecraft:unbreaking", lvl: 3 },
        { id: "minecraft:trident_mastery_alias", lvl: 1 }, // desconocido
        { id: "minecraft:channeling", lvl: 1 },
      ]),
    ).toBe("trident_mastery");
  });

  it("el orden del array NO afecta el resultado (getEnchantsToAdd es Map)", () => {
    // Ambas permutaciones deben devolver lo mismo.
    const a = _INTERNAL.classify([
      { id: "minecraft:mending", lvl: 1 },
      { id: "minecraft:unbreaking", lvl: 3 },
    ]);
    const b = _INTERNAL.classify([
      { id: "minecraft:unbreaking", lvl: 3 },
      { id: "minecraft:mending", lvl: 1 },
    ]);
    expect(a).toBe(b);
    expect(a).toBe("mending");
  });

  it("mezcla notable + no-notable: cuenta sólo la notable", () => {
    expect(
      _INTERNAL.classify([
        { id: "minecraft:knockback", lvl: 2 }, // no notable
        { id: "minecraft:fortune", lvl: 3 }, // notable
      ]),
    ).toBe("fortune");
  });
});

// -------------------------------------------------------------------
// narrateProgress — API pública
// -------------------------------------------------------------------

describe("narrateProgress · pools notables producen narración", () => {
  it.each([
    ["minecraft:mending", 1, /⚙|🛠|♾|🌍/],
    ["minecraft:infinity", 1, /🏹|⚙|🌍/],
    ["minecraft:silk_touch", 1, /🪨|🌱|🌍|⚙/],
    ["minecraft:fortune", 3, /💎|⛏|🌍/],
    ["minecraft:efficiency", 5, /⛏|⚙|🌍/],
    ["minecraft:sharpness", 5, /⚔|🗡|🌍/],
    ["minecraft:protection", 4, /🛡|⚙|🌍/],
    ["minecraft:channeling", 1, /🔱|⚙|🌍/],
    ["minecraft:unbreaking", 3, /🛠|⚙|🌍/],
  ])("%s lvl=%i produce body no vacío con emoji temático", (id, lvl, emoji) => {
    const body = narrateProgress({ enchants: [{ id, lvl }] });
    expect(body).not.toBeNull();
    expect(body!.length).toBeGreaterThan(0);
    expect(body!).toMatch(emoji);
  });

  it("Math.random=0 elige la PRIMERA variante de mending", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateProgress({
      enchants: [{ id: "minecraft:mending", lvl: 1 }],
    });
    expect(body).toBe(
      "⚙️ El servidor acaba de aprender a reparar lo que creía perdido.",
    );
  });

  it("Math.random=0.99 elige la ÚLTIMA variante del pool", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const body = narrateProgress({
      enchants: [{ id: "minecraft:mending", lvl: 1 }],
    });
    // Pool 'mending' tiene 6 variantes; 0.99*6 = 5.94 → floor=5.
    expect(body).toBe(
      "⚙️ Un encantamiento acaba de volver obsoleto al yunque tradicional.",
    );
  });

  it("distintos valores de random producen ≥ 2 frases distintas", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      vi.spyOn(Math, "random").mockReturnValue(i / 6);
      const body = narrateProgress({
        enchants: [{ id: "minecraft:mending", lvl: 1 }],
      });
      if (body !== null) seen.add(body);
      vi.restoreAllMocks();
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

describe("narrateProgress · no notables → null", () => {
  it.each([
    [{ id: "minecraft:fortune", lvl: 1 }], // Fortune I no cuenta
    [{ id: "minecraft:sharpness", lvl: 3 }], // Sharpness III no cuenta
    [{ id: "minecraft:knockback", lvl: 2 }], // no-notable
    [{ id: "minecraft:looting", lvl: 3 }], // no-notable
  ])("enchant=%o → null", (entry) => {
    expect(narrateProgress({ enchants: [entry] })).toBeNull();
  });

  it("array vacío → null", () => {
    expect(narrateProgress({ enchants: [] })).toBeNull();
  });
});

// -------------------------------------------------------------------
// Invariantes estructurales
// -------------------------------------------------------------------

describe("Catálogo · invariantes estructurales", () => {
  it("cubre exactamente 9 pools", () => {
    const expected = [
      "mending",
      "infinity",
      "silk_touch",
      "fortune",
      "efficiency",
      "weapon_mastery",
      "protection_mastery",
      "trident_mastery",
      "unbreaking_iii",
    ].sort();
    expect(Object.keys(_INTERNAL.VARIANTS).sort()).toEqual(expected);
  });

  it("cada pool tiene entre 6 y 8 variantes (spec T15)", () => {
    for (const [pool, variants] of Object.entries(_INTERNAL.VARIANTS)) {
      expect(variants.length, `pool ${pool}`).toBeGreaterThanOrEqual(6);
      expect(variants.length, `pool ${pool}`).toBeLessThanOrEqual(8);
    }
  });

  it("total de variantes está en el rango objetivo (50..80)", () => {
    let total = 0;
    for (const variants of Object.values(_INTERNAL.VARIANTS)) {
      total += variants.length;
    }
    expect(total).toBeGreaterThanOrEqual(50);
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

  it("cada NOTABLE_ENCHANTS apunta a un pool existente", () => {
    for (const [id, notable] of _INTERNAL.NOTABLE_ENCHANTS) {
      expect(
        _INTERNAL.VARIANTS[notable.category],
        `${id} → ${notable.category}`,
      ).toBeDefined();
    }
  });

  it("PRIORITY_ORDER cubre exactamente las 9 categorías (sin duplicados)", () => {
    const expected = Object.keys(_INTERNAL.VARIANTS).sort();
    expect([..._INTERNAL.PRIORITY_ORDER].sort()).toEqual(expected);
    expect(new Set(_INTERNAL.PRIORITY_ORDER).size).toBe(
      _INTERNAL.PRIORITY_ORDER.length,
    );
  });

  it("todos los IDs de NOTABLE_ENCHANTS son namespaced (formato del plugin)", () => {
    for (const id of _INTERNAL.NOTABLE_ENCHANTS.keys()) {
      expect(id.startsWith("minecraft:"), id).toBe(true);
    }
  });
});
