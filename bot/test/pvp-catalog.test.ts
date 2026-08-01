import { describe, it, expect, vi, afterEach } from "vitest";
import { narratePvpKill, _INTERNAL } from "../src/minecraft/pvp-catalog";

// Tests estructurales del PvP Catalog (T12).
//
// Doble objetivo, mismo patrón que los catálogos anteriores:
//   1. Contrato de `narratePvpKill` (weapon → categoría correcta,
//      selección aleatoria, fallback).
//   2. Invariantes del catálogo (7 categorías con 6..8 variantes,
//      mapping consistente, cada variante interpola killer y victim).
//
// Cero acoplamiento a texto literal salvo para el fallback (spec
// exige textualmente "⚔️ Miguel derrotó a Carlos.") y spot-checks
// deterministas con Math.random=0.

afterEach(() => {
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------
// Clasificación por weapon
// -------------------------------------------------------------------

describe("classifyByWeapon", () => {
  it.each([
    ["minecraft:diamond_sword", "melee"],
    ["minecraft:wooden_sword", "melee"],
    ["minecraft:netherite_sword", "melee"],
    ["minecraft:iron_axe", "melee"],
    ["minecraft:golden_axe", "melee"],
    ["minecraft:mace", "melee"],
    ["minecraft:stick", "melee"],
    ["minecraft:air", "melee"],
    ["minecraft:bow", "projectile"],
    ["minecraft:crossbow", "projectile"],
    ["minecraft:trident", "projectile"],
    ["minecraft:tnt", "explosion"],
    ["minecraft:end_crystal", "explosion"],
    ["minecraft:respawn_anchor", "explosion"],
    ["minecraft:flint_and_steel", "fire"],
    ["minecraft:lava_bucket", "fire"],
    ["minecraft:fire_charge", "fire"],
    ["minecraft:potion", "magic"],
    ["minecraft:splash_potion", "magic"],
    ["minecraft:lingering_potion", "magic"],
    ["minecraft:tipped_arrow", "magic"],
  ])("weapon=%s → categoria=%s", (weapon, expected) => {
    expect(_INTERNAL.classifyByWeapon(weapon)).toBe(expected);
  });

  it.each([
    ["minecraft:cake", "unknown"],
    ["minecraft:diamond", "unknown"],
    ["minecraft:dirt", "unknown"],
    ["cosa_no_namespaced", "unknown"],
  ])("weapon desconocido %s → unknown", (weapon, expected) => {
    expect(_INTERNAL.classifyByWeapon(weapon)).toBe(expected);
  });

  it("weapon=null → unknown", () => {
    expect(_INTERNAL.classifyByWeapon(null)).toBe("unknown");
  });

  it("void NO es alcanzable por weapon solo (spec: si no se puede distinguir → unknown)", () => {
    // No hay ningún weapon del vanilla que route a "void" — la
    // categoría existe en el catálogo para extensibilidad futura.
    for (const [, cat] of _INTERNAL.WEAPON_TO_CATEGORY) {
      expect(cat).not.toBe("void");
    }
  });
});

// -------------------------------------------------------------------
// Narrativa por categoría
// -------------------------------------------------------------------

describe("narratePvpKill · categorías por weapon", () => {
  const KILLER = "Miguel";
  const VICTIM = "Carlos";

  it.each([
    ["minecraft:iron_sword", /⚔/, /Miguel/, /Carlos/],
    ["minecraft:bow", /🏹/, /Miguel/, /Carlos/],
    ["minecraft:tnt", /💥/, /Miguel/, /Carlos/],
    ["minecraft:flint_and_steel", /🔥/, /Miguel/, /Carlos/],
    ["minecraft:splash_potion", /✨/, /Miguel/, /Carlos/],
    ["minecraft:cake", /⚔/, /Miguel/, /Carlos/], // → unknown → ⚔️
  ])(
    "weapon=%s produce narración con emoji y ambos nombres interpolados",
    (weapon, emojiPattern, killerPattern, victimPattern) => {
      const body = narratePvpKill({ killer: KILLER, victim: VICTIM, weapon });
      expect(body).toMatch(emojiPattern);
      expect(body).toMatch(killerPattern);
      expect(body).toMatch(victimPattern);
    },
  );

  it("Math.random=0 elige la PRIMERA variante de melee", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narratePvpKill({
      killer: "Miguel",
      victim: "Carlos",
      weapon: "minecraft:diamond_sword",
    });
    expect(body).toBe(
      "⚔️ Miguel convenció a Carlos de volver al punto de respawn.",
    );
  });

  it("Math.random=0 elige la PRIMERA variante de projectile", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narratePvpKill({
      killer: "Miguel",
      victim: "Carlos",
      weapon: "minecraft:bow",
    });
    expect(body).toBe(
      "🏹 Miguel demostró que la distancia no era un problema para Carlos.",
    );
  });

  it("Math.random=0 elige la PRIMERA variante de explosion", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narratePvpKill({
      killer: "Miguel",
      victim: "Carlos",
      weapon: "minecraft:tnt",
    });
    expect(body).toBe(
      "💥 Miguel decidió que la sutileza no era necesaria; Carlos lo notó.",
    );
  });

  it("Math.random=0 elige la PRIMERA variante de fire", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narratePvpKill({
      killer: "Miguel",
      victim: "Carlos",
      weapon: "minecraft:flint_and_steel",
    });
    expect(body).toBe(
      "🔥 Miguel calentó la conversación con Carlos de forma definitiva.",
    );
  });

  it("Math.random=0 elige la PRIMERA variante de magic", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narratePvpKill({
      killer: "Miguel",
      victim: "Carlos",
      weapon: "minecraft:splash_potion",
    });
    expect(body).toBe("✨ Miguel aplicó su formulario mágico a Carlos.");
  });

  it("Math.random=0 con weapon desconocido → primera variante de unknown (fallback textual del spec)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narratePvpKill({
      killer: "Miguel",
      victim: "Carlos",
      weapon: "minecraft:diamond", // no clasificable
    });
    expect(body).toBe("⚔️ Miguel derrotó a Carlos.");
  });

  it("Math.random=0 con weapon=null → primera variante de unknown (fallback)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narratePvpKill({
      killer: "Miguel",
      victim: "Carlos",
      weapon: null,
    });
    expect(body).toBe("⚔️ Miguel derrotó a Carlos.");
  });
});

// -------------------------------------------------------------------
// Selección aleatoria dentro del pool
// -------------------------------------------------------------------

describe("narratePvpKill · selección aleatoria", () => {
  it("distintos valores de random producen ≥ 2 frases distintas dentro del mismo pool", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      vi.spyOn(Math, "random").mockReturnValue(i / 6);
      seen.add(
        narratePvpKill({
          killer: "Miguel",
          victim: "Carlos",
          weapon: "minecraft:diamond_sword",
        }),
      );
      vi.restoreAllMocks();
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it("Math.random=0.99 elige la ÚLTIMA variante", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const body = narratePvpKill({
      killer: "Miguel",
      victim: "Carlos",
      weapon: "minecraft:diamond_sword",
    });
    // Pool 'melee' tiene 6 variantes; 0.99*6 = 5.94 → floor=5 (última).
    expect(body).toBe(
      "⚔️ El duelo terminó con Miguel como vencedor. Carlos lo asimila.",
    );
  });
});

// -------------------------------------------------------------------
// Invariantes del catálogo
// -------------------------------------------------------------------

describe("Catálogo · invariantes estructurales", () => {
  it("cubre las 7 categorías declaradas en el spec T12", () => {
    const expected = [
      "melee",
      "projectile",
      "explosion",
      "fire",
      "void",
      "magic",
      "unknown",
    ].sort();
    expect(Object.keys(_INTERNAL.VARIANTS).sort()).toEqual(expected);
  });

  it("cada categoría tiene entre 6 y 8 variantes (spec T12)", () => {
    for (const [category, variants] of Object.entries(_INTERNAL.VARIANTS)) {
      expect(variants.length, `categoría ${category}`).toBeGreaterThanOrEqual(6);
      expect(variants.length, `categoría ${category}`).toBeLessThanOrEqual(8);
    }
  });

  it("cada variante produce string no vacío e interpola killer y victim", () => {
    const K = "Killerino";
    const V = "Victimin";
    for (const [category, variants] of Object.entries(_INTERNAL.VARIANTS)) {
      for (const variant of variants) {
        const out = variant(K, V);
        expect(out.length, `${category}`).toBeGreaterThan(0);
        expect(out, `${category}`).toContain(K);
        expect(out, `${category}`).toContain(V);
      }
    }
  });

  it("void: pool existe con 6+ variantes (aunque no alcanzable desde weapon)", () => {
    // La categoría "void" se reserva para extensibilidad futura.
    // Verificamos que su pool está listo por si mañana el plugin
    // emite información suficiente.
    expect(_INTERNAL.VARIANTS.void.length).toBeGreaterThanOrEqual(6);
    for (const variant of _INTERNAL.VARIANTS.void) {
      const out = variant("K", "V");
      expect(out).toMatch(/🕳/);
      expect(out).toContain("K");
      expect(out).toContain("V");
    }
  });

  it("cada weapon de WEAPON_TO_CATEGORY mapea a una categoría existente", () => {
    for (const [weapon, cat] of _INTERNAL.WEAPON_TO_CATEGORY) {
      expect(_INTERNAL.VARIANTS[cat], `weapon ${weapon} → ${cat}`).toBeDefined();
    }
  });

  it("la primera variante de 'unknown' es exactamente el fallback textual del spec", () => {
    const first = _INTERNAL.VARIANTS.unknown[0]!("Miguel", "Carlos");
    expect(first).toBe("⚔️ Miguel derrotó a Carlos.");
  });
});
