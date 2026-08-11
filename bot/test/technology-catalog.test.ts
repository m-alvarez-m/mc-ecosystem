import { describe, it, expect, vi, afterEach } from "vitest";
import {
  narrateTechnology,
  _INTERNAL,
} from "../src/minecraft/technology-catalog";

// Tests estructurales del Technology Catalog (T16).
//
// Doble objetivo, mismo patrón que los catálogos previos:
//   1. Contrato de `narrateTechnology`: 8 categorías → variantes;
//      bloques fuera del catálogo → null.
//   2. Invariantes del catálogo (8 pools, 6..8 variantes por pool,
//      mapping consistente).

afterEach(() => {
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------
// Clasificación por bloque
// -------------------------------------------------------------------

describe("classify", () => {
  it.each([
    // redstone
    ["minecraft:redstone_torch", "redstone"],
    ["minecraft:redstone_wall_torch", "redstone"],
    ["minecraft:redstone_block", "redstone"],
    ["minecraft:redstone_lamp", "redstone"],
    ["minecraft:repeater", "redstone"],
    ["minecraft:comparator", "redstone"],
    ["minecraft:daylight_detector", "redstone"],
    ["minecraft:lightning_rod", "redstone"],
    ["minecraft:target", "redstone"],
    ["minecraft:tripwire_hook", "redstone"],
    // piston
    ["minecraft:piston", "piston"],
    ["minecraft:sticky_piston", "piston"],
    ["minecraft:observer", "piston"],
    // automation
    ["minecraft:hopper", "automation"],
    ["minecraft:dropper", "automation"],
    ["minecraft:dispenser", "automation"],
    // rail (sólo mecánicos)
    ["minecraft:powered_rail", "rail"],
    ["minecraft:detector_rail", "rail"],
    ["minecraft:activator_rail", "rail"],
    // industry
    ["minecraft:blast_furnace", "industry"],
    ["minecraft:smoker", "industry"],
    ["minecraft:composter", "industry"],
    ["minecraft:campfire", "industry"],
    ["minecraft:soul_campfire", "industry"],
    ["minecraft:cauldron", "industry"],
    // sculk
    ["minecraft:sculk_sensor", "sculk"],
    ["minecraft:calibrated_sculk_sensor", "sculk"],
    ["minecraft:sculk_shrieker", "sculk"],
    ["minecraft:sculk_catalyst", "sculk"],
    // knowledge
    ["minecraft:bookshelf", "knowledge"],
    ["minecraft:chiseled_bookshelf", "knowledge"],
    ["minecraft:jukebox", "knowledge"],
    ["minecraft:note_block", "knowledge"],
    // defense
    ["minecraft:iron_bars", "defense"],
    ["minecraft:iron_door", "defense"],
    ["minecraft:iron_trapdoor", "defense"],
  ])("block=%s → categoria=%s", (block, expected) => {
    expect(_INTERNAL.classify(block)).toBe(expected);
  });
});

describe("classify · exclusiones deliberadas (evitan spam)", () => {
  it.each([
    // Filtro clave: dust redstone es demasiado frecuente en circuitos
    // grandes. Los torches/blocks/lamps sí cuentan.
    ["minecraft:redstone"],
    // Rail ordinario: tan común como la tierra. Los rieles mecánicos
    // (powered/detector/activator) sí cuentan.
    ["minecraft:rail"],
    // Furnace ordinario: demasiado básico. Blast furnace y smoker sí.
    ["minecraft:furnace"],
  ])("block=%s → null (exclusión intencionada)", (block) => {
    expect(_INTERNAL.classify(block)).toBeNull();
  });

  it.each([
    // Estéticos.
    ["minecraft:oak_planks"],
    ["minecraft:white_wool"],
    ["minecraft:cyan_terracotta"],
    ["minecraft:red_glazed_terracotta"],
    ["minecraft:glass"],
    // Relleno.
    ["minecraft:dirt"],
    ["minecraft:cobblestone"],
    ["minecraft:stone"],
    ["minecraft:oak_log"],
    // Ítems consumibles / no-tech.
    ["minecraft:cake"],
    ["minecraft:bed"],
    // Bloques inventados / mal formados.
    ["cosa_no_reconocida"],
  ])("block %s (estético / relleno / desconocido) → null", (block) => {
    expect(_INTERNAL.classify(block)).toBeNull();
  });
});

// -------------------------------------------------------------------
// narrateTechnology · pools reconocidos publican
// -------------------------------------------------------------------

describe("narrateTechnology · bloques en el catálogo", () => {
  it.each([
    ["minecraft:comparator", /⚡/, /circuito|redstone|lógica|cable|señal|era|cerebro|responder/i],
    ["minecraft:piston", /🔧/, /mover|mecanismo|estát|pistón|movimiento|paredes|mecánica/i],
    ["minecraft:hopper", /🏭/, /automatización|trabajo|viajan|delegó|máquin|logística|silenciosa|mira/i],
    ["minecraft:powered_rail", /🛤/, /transporte|raíles|distancias|carril|movimiento|rieles|viajes/i],
    ["minecraft:blast_furnace", /⚙/, /industria|producción|cadena|procesamiento|forja|especialización|estación/i],
    ["minecraft:sculk_sensor", /🔊/, /escuchar|sculk|pasos|biotecnología|silenciosa|atenta|oído|vibraciones|sentido/i],
    ["minecraft:bookshelf", /📚/, /conocimiento|biblioteca|estantería|libros|preservar|cultura|estudio|historia|rincón/i],
    ["minecraft:iron_door", /🔒/, /fortificación|defensa|hierro|puertas|seguridad|perímetro|accesos/i],
  ])(
    "block=%s produce body con emoji temático + palabras clave",
    (block, emojiPattern, textPattern) => {
      const body = narrateTechnology({ block });
      expect(body).not.toBeNull();
      expect(body!).toMatch(emojiPattern);
      expect(body!).toMatch(textPattern);
    },
  );

  it("Math.random=0 elige la PRIMERA variante de redstone", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(narrateTechnology({ block: "minecraft:redstone_torch" })).toBe(
      "⚡ El servidor acaba de descubrir la ingeniería redstone.",
    );
  });

  it("Math.random=0 elige la PRIMERA variante de piston", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(narrateTechnology({ block: "minecraft:piston" })).toBe(
      "🔧 El servidor aprendió a mover bloques a voluntad.",
    );
  });

  it("Math.random=0 elige la PRIMERA variante de automation", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(narrateTechnology({ block: "minecraft:hopper" })).toBe(
      "🏭 La automatización llegó al servidor.",
    );
  });

  it("Math.random=0 elige la PRIMERA variante de rail", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(narrateTechnology({ block: "minecraft:powered_rail" })).toBe(
      "🛤️ El transporte del servidor entró en su fase mecánica.",
    );
  });

  it("Math.random=0 elige la PRIMERA variante de industry", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(narrateTechnology({ block: "minecraft:blast_furnace" })).toBe(
      "⚙️ La industria del servidor se especializó.",
    );
  });

  it("Math.random=0 elige la PRIMERA variante de sculk", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(narrateTechnology({ block: "minecraft:sculk_sensor" })).toBe(
      "🔊 El mundo aprendió a escuchar.",
    );
  });

  it("Math.random=0 elige la PRIMERA variante de knowledge", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(narrateTechnology({ block: "minecraft:bookshelf" })).toBe(
      "📚 El servidor descubrió que el conocimiento necesita un hogar.",
    );
  });

  it("Math.random=0 elige la PRIMERA variante de defense", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(narrateTechnology({ block: "minecraft:iron_door" })).toBe(
      "🔒 La fortificación del servidor avanzó otro paso.",
    );
  });

  it("Math.random=0.99 elige la ÚLTIMA variante del pool", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    // Pool 'redstone' tiene 7 variantes; 0.99*7 = 6.93 → floor=6.
    expect(narrateTechnology({ block: "minecraft:redstone_torch" })).toBe(
      "⚡ La era de los circuitos ya comenzó en el servidor.",
    );
  });

  it("distintos valores de random producen ≥ 2 frases distintas", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 7; i++) {
      vi.spyOn(Math, "random").mockReturnValue(i / 7);
      const body = narrateTechnology({ block: "minecraft:hopper" });
      if (body !== null) seen.add(body);
      vi.restoreAllMocks();
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

// -------------------------------------------------------------------
// narrateTechnology · fuera del catálogo → null
// -------------------------------------------------------------------

describe("narrateTechnology · fuera del catálogo", () => {
  it.each([
    ["minecraft:dirt"],
    ["minecraft:cobblestone"],
    ["minecraft:oak_planks"],
    ["minecraft:white_wool"],
    ["minecraft:redstone"], // dust — exclusión deliberada
    ["minecraft:rail"], // rail ordinario — exclusión deliberada
    ["minecraft:furnace"], // furnace ordinario — exclusión deliberada
    ["minecraft:cake"],
    ["cosa_no_reconocida"],
  ])("block=%s → null (no publicar)", (block) => {
    expect(narrateTechnology({ block })).toBeNull();
  });

  it("block=null (payload sin data.block) → null", () => {
    expect(narrateTechnology({ block: null })).toBeNull();
  });
});

// -------------------------------------------------------------------
// Impersonalidad — el protagonista es el servidor, no el jugador
// -------------------------------------------------------------------

describe("narrateTechnology · narrativa impersonal", () => {
  it("ninguna variante contiene nombres de jugador (word-boundary match)", () => {
    // Word-boundary evita falsos positivos como "ganaron"/"planaria"/
    // "banana" atrapando "ana". Sólo la palabra suelta (case-insensitive)
    // dispara el check.
    const NAMES_PROHIBIDOS = /\b(Miguel|Carlos|Pedro|Vancorbus|Ana)\b/i;
    for (const [category, variants] of Object.entries(_INTERNAL.VARIANTS)) {
      for (const variant of variants) {
        const out = variant();
        expect(out, `${category}: "${out}"`).not.toMatch(NAMES_PROHIBIDOS);
      }
    }
  });

  it("mayoría de variantes mencionan explícitamente 'servidor' o 'mundo'", () => {
    // Directriz narrativa, no regla estricta línea a línea: una
    // variante como "Un pistón siempre significa que algo mayor está
    // por venir." es válidamente impersonal — sin nombrar el mundo,
    // el protagonista sigue siendo implícito. Exigimos que la
    // MAYORÍA (≥ 75%) sean explícitas, para preservar el tono
    // sin obligar cadencia rígida.
    let total = 0;
    let explicit = 0;
    for (const variants of Object.values(_INTERNAL.VARIANTS)) {
      for (const variant of variants) {
        total += 1;
        const out = variant().toLowerCase();
        if (out.includes("servidor") || out.includes("mundo")) explicit += 1;
      }
    }
    expect(explicit / total).toBeGreaterThanOrEqual(0.75);
  });

});

// -------------------------------------------------------------------
// Invariantes estructurales
// -------------------------------------------------------------------

describe("Catálogo · invariantes estructurales", () => {
  it("cubre exactamente 8 pools", () => {
    const expected = [
      "redstone",
      "piston",
      "automation",
      "rail",
      "industry",
      "sculk",
      "knowledge",
      "defense",
    ].sort();
    expect(Object.keys(_INTERNAL.VARIANTS).sort()).toEqual(expected);
  });

  it("cada pool tiene entre 6 y 8 variantes (spec T16)", () => {
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

  it("cada bloque de BLOCK_TO_CATEGORY apunta a un pool existente", () => {
    for (const [block, cat] of _INTERNAL.BLOCK_TO_CATEGORY) {
      expect(_INTERNAL.VARIANTS[cat], `${block} → ${cat}`).toBeDefined();
    }
  });

  it("todos los IDs de BLOCK_TO_CATEGORY son namespaced (formato del plugin)", () => {
    for (const block of _INTERNAL.BLOCK_TO_CATEGORY.keys()) {
      expect(block.startsWith("minecraft:"), block).toBe(true);
    }
  });

  it("cada pool es alcanzable por al menos un bloque de BLOCK_TO_CATEGORY", () => {
    const reachable = new Set<string>();
    for (const cat of _INTERNAL.BLOCK_TO_CATEGORY.values()) {
      reachable.add(cat);
    }
    for (const cat of Object.keys(_INTERNAL.VARIANTS)) {
      expect(reachable, `pool huérfano: ${cat}`).toContain(cat);
    }
  });
});
