import { describe, it, expect, vi, afterEach } from "vitest";
import { narrateCraft, _INTERNAL } from "../src/minecraft/craft-catalog";

// Tests estructurales del Craft Catalog (T13).
//
// Doble objetivo, mismo patrón que los catálogos previos:
//   1. Contrato de `narrateCraft` (los items reconocidos producen
//      variante del pool esperado; los desconocidos devuelven null).
//   2. Invariantes del catálogo (8 categorías, 6..8 variantes por
//      pool, mapping consistente).

afterEach(() => {
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------
// Clasificación por item key
// -------------------------------------------------------------------

describe("classify", () => {
  it.each([
    ["minecraft:beacon", "beacon"],
    ["minecraft:enchanting_table", "enchanting_table"],
    ["minecraft:ender_chest", "ender_chest"],
    ["minecraft:shulker_box", "shulker_box"],
    ["minecraft:smithing_table", "smithing_table"],
    ["minecraft:anvil", "anvil"],
    ["minecraft:lodestone", "lodestone"],
    ["minecraft:netherite_ingot", "netherite_upgrade"],
  ])("item=%s → categoria=%s", (item, expected) => {
    expect(_INTERNAL.classify(item)).toBe(expected);
  });

  it.each([
    ["minecraft:white_shulker_box"],
    ["minecraft:orange_shulker_box"],
    ["minecraft:cyan_shulker_box"],
    ["minecraft:black_shulker_box"],
    ["minecraft:magenta_shulker_box"],
  ])(
    "shulker box coloreado %s → categoria shulker_box (via sufijo)",
    (item) => {
      expect(_INTERNAL.classify(item)).toBe("shulker_box");
    },
  );

  it.each([
    ["minecraft:stick"],
    ["minecraft:torch"],
    ["minecraft:furnace"],
    ["minecraft:crafting_table"],
    ["minecraft:oak_planks"],
    ["minecraft:diamond_pickaxe"], // herramienta común, no un hito de progreso
    ["minecraft:netherite_pickaxe"], // no llega por CraftItemEvent (smithing)
    ["minecraft:bread"],
    ["cosa_no_namespaced"],
  ])("item fuera del catálogo %s → null", (item) => {
    expect(_INTERNAL.classify(item)).toBeNull();
  });
});

// -------------------------------------------------------------------
// Narrativa por categoría
// -------------------------------------------------------------------

describe("narrateCraft · items en el catálogo", () => {
  it.each([
    ["minecraft:beacon", /✨/, /Beacon|faro|tecnología|luz|horizonte/i],
    ["minecraft:enchanting_table", /📖/, /magia|conocimiento|encantamiento|poder|herramientas|experiencia/i],
    ["minecraft:ender_chest", /📦/, /logística|Ender Chest|viajes|almacenamiento|cofre|distancia/i],
    ["minecraft:shulker_box", /🎒/, /organización|Shulker Box|base|inventario|logística|caos/i],
    ["minecraft:smithing_table", /🛠/, /Smithing|taller|forja|Netherite|smithing|mejoras/i],
    ["minecraft:anvil", /🔨/, /acero|Reparar|yunque|trabajo|mantenimiento|herramienta/i],
    ["minecraft:lodestone", /🧭/, /exploración|referencia|Perderse|destino|brújula|viaje/i],
    ["minecraft:netherite_ingot", /⚒/, /Netherite|tecnología|futuro|equipo|herramientas|progreso/i],
  ])(
    "item=%s produce narración con emoji y palabras clave del pool",
    (item, emojiPattern, textPattern) => {
      const body = narrateCraft({ item });
      expect(body).not.toBeNull();
      expect(body!).toMatch(emojiPattern);
      expect(body!).toMatch(textPattern);
    },
  );

  it("Math.random=0 elige la PRIMERA variante de beacon", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateCraft({ item: "minecraft:beacon" });
    expect(body).toBe(
      "✨ El primer Beacon ya ilumina una nueva etapa del servidor.",
    );
  });

  it("Math.random=0 elige la PRIMERA variante de enchanting_table", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateCraft({ item: "minecraft:enchanting_table" });
    expect(body).toBe("📖 La magia acaba de instalarse oficialmente.");
  });

  it("Math.random=0 elige la PRIMERA variante de ender_chest", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateCraft({ item: "minecraft:ender_chest" });
    expect(body).toBe("📦 La logística del servidor acaba de evolucionar.");
  });

  it("Math.random=0 elige la PRIMERA variante de shulker_box (base)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateCraft({ item: "minecraft:shulker_box" });
    expect(body).toBe("🎒 La organización acaba de subir de nivel.");
  });

  it("shulker box coloreado también produce narración del pool shulker_box", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateCraft({ item: "minecraft:purple_shulker_box" });
    expect(body).toBe("🎒 La organización acaba de subir de nivel.");
  });

  it("Math.random=0 elige la PRIMERA variante de smithing_table", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateCraft({ item: "minecraft:smithing_table" });
    expect(body).toBe(
      "🛠️ El primer Smithing Table ya está listo para la próxima era.",
    );
  });

  it("Math.random=0 elige la PRIMERA variante de anvil", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateCraft({ item: "minecraft:anvil" });
    expect(body).toBe("🔨 El acero acaba de encontrar su taller.");
  });

  it("Math.random=0 elige la PRIMERA variante de lodestone", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateCraft({ item: "minecraft:lodestone" });
    expect(body).toBe(
      "🧭 La exploración acaba de ganar un nuevo punto de referencia.",
    );
  });

  it("Math.random=0 elige la PRIMERA variante de netherite_upgrade (via netherite_ingot)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateCraft({ item: "minecraft:netherite_ingot" });
    expect(body).toBe("⚒️ La era del Netherite acaba de comenzar.");
  });

  it("Math.random=0.99 elige la ÚLTIMA variante del pool", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const body = narrateCraft({ item: "minecraft:beacon" });
    // Pool 'beacon' tiene 6 variantes; 0.99*6 = 5.94 → floor=5 (última).
    expect(body).toBe("✨ Un Beacon siempre significa que el servidor avanzó.");
  });

  it("distintos valores de random producen ≥ 2 frases distintas dentro del mismo pool", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      vi.spyOn(Math, "random").mockReturnValue(i / 6);
      const body = narrateCraft({ item: "minecraft:beacon" });
      if (body !== null) seen.add(body);
      vi.restoreAllMocks();
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

// -------------------------------------------------------------------
// Fuera del catálogo → null (no publicar)
// -------------------------------------------------------------------

describe("narrateCraft · items fuera del catálogo", () => {
  it.each([
    ["minecraft:stick"],
    ["minecraft:torch"],
    ["minecraft:furnace"],
    ["minecraft:crafting_table"],
    ["minecraft:oak_planks"],
    ["minecraft:bread"],
    ["minecraft:diamond_sword"],
    ["cosa_no_reconocida"],
  ])("item=%s → null (no publicar)", (item) => {
    expect(narrateCraft({ item })).toBeNull();
  });

  it("item=null (payload sin data.item) → null", () => {
    expect(narrateCraft({ item: null })).toBeNull();
  });
});

// -------------------------------------------------------------------
// Invariantes del catálogo
// -------------------------------------------------------------------

describe("Catálogo · invariantes estructurales", () => {
  it("cubre las 8 categorías declaradas en el spec T13", () => {
    const expected = [
      "beacon",
      "enchanting_table",
      "ender_chest",
      "shulker_box",
      "smithing_table",
      "anvil",
      "lodestone",
      "netherite_upgrade",
    ].sort();
    expect(Object.keys(_INTERNAL.VARIANTS).sort()).toEqual(expected);
  });

  it("cada categoría tiene entre 6 y 8 variantes (spec T13)", () => {
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

  it("cada item de ITEM_TO_CATEGORY mapea a una categoría existente", () => {
    for (const [item, cat] of _INTERNAL.ITEM_TO_CATEGORY) {
      expect(_INTERNAL.VARIANTS[cat], `item ${item} → ${cat}`).toBeDefined();
    }
  });

  it("cada categoría del catálogo es alcanzable desde al menos un item real", () => {
    // Chequeo cruzado: no debe haber pools "muertos" sin ningún
    // item que los active (shulker_box se activa vía sufijo, pero
    // también tiene entrada explícita en el map).
    const reachable = new Set<string>();
    for (const cat of _INTERNAL.ITEM_TO_CATEGORY.values()) {
      reachable.add(cat);
    }
    // shulker_box adicionalmente vía sufijo; confirmamos que la
    // clave está en el map explícito también.
    expect(reachable.has("shulker_box")).toBe(true);
    for (const cat of Object.keys(_INTERNAL.VARIANTS)) {
      expect(reachable, `categoría huérfana: ${cat}`).toContain(cat);
    }
  });
});
