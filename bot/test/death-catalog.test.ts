import { describe, it, expect, vi, afterEach } from "vitest";
import { narrateDeath, _INTERNAL } from "../src/minecraft/death-catalog";

// Tests estructurales del Death Catalog.
//
// Objetivo doble:
//   1. Verificar el CONTRATO de `narrateDeath` (categorías esperadas
//      producen frases, fallback funciona, nombre siempre presente).
//   2. Verificar INVARIANTES del catálogo (mínimos por categoría, todo
//      variante devuelve string no vacío, todos los mobs mapean a
//      categorías existentes).
//
// Cero acoplamiento a texto literal salvo cuando comprobamos el
// fallback (que es texto fijo). Selección aleatoria se controla con
// vi.spyOn(Math, "random").

const NAME = "Vancorbus";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("narrateDeath · categorías reconocidas por cause", () => {
  it.each([
    ["fall", /gravedad|suelo|aterriz|volar/i],
    ["void", /gravedad|suelo|aterriz|volar/i],
    ["fly_into_wall", /gravedad|suelo|aterriz|volar/i],
    ["lava", /lava|spa|Nether|liquido|líquido|temperatura|baño/i],
    ["fire", /fuego|llamas|quema|cocinado|temperatura/i],
    ["fire_tick", /fuego|llamas|quema|cocinado|temperatura/i],
    ["entity_explosion", /pólvora|explos|detonación|onda expansiva|ingeniería|reorganiz|TNT|Creeper/i],
    ["block_explosion", /pólvora|explos|detonación|onda expansiva|ingeniería|reorganiz|TNT/i],
    ["drowning", /respirar|agua|pulmones|océano/i],
    ["starvation", /ayuno|refrigerador|hambre|comer|estómago/i],
    ["contact", /cactus|desierto/i],
    ["hot_floor", /magma|Nether|suelas|brillante|caminar/i],
    ["lightning", /rayo|cielo|puntería|pararrayos|probabilidad/i],
    ["magic", /poción|química|efecto|etiqueta/i],
  ])("cause=%s produce narración con nombre y palabras clave", (cause, pattern) => {
    // Sin killer_mob: la clasificación cae por cause.
    const body = narrateDeath({
      playerName: NAME,
      cause,
      killerMob: null,
      vanillaMessage: null,
    });
    expect(body).toContain(NAME);
    expect(body).toMatch(pattern);
    expect(body).toMatch(/^💀 /);
  });
});

describe("narrateDeath · categorías reconocidas por killer_mob", () => {
  it.each([
    ["minecraft:creeper", /Creeper|radio|explos/i],
    ["minecraft:skeleton", /esqueleto|flecha|arco|arquero|blanco/i],
    ["minecraft:stray", /esqueleto|flecha|arco|arquero|blanco/i],
    ["minecraft:wither_skeleton", /esqueleto|flecha|arco|arquero|blanco/i],
    ["minecraft:zombie", /zombie|cadáver|inteligencia|fan menos amigable/i],
    ["minecraft:husk", /zombie|cadáver|inteligencia|fan menos amigable/i],
    ["minecraft:drowned", /zombie|cadáver|inteligencia|fan menos amigable/i],
    ["minecraft:spider", /araña|antorchas|ojos|patas|cueva/i],
    ["minecraft:cave_spider", /araña|antorchas|ojos|patas|cueva/i],
    ["minecraft:enderman", /Enderman|mir|teletransporte|contacto/i],
  ])("killer_mob=%s produce narración de la pool esperada", (mob, pattern) => {
    // Aunque la cause sea genérica (entity_attack o projectile), el mob
    // decide la pool.
    const body = narrateDeath({
      playerName: NAME,
      cause: "entity_attack",
      killerMob: mob,
      vanillaMessage: null,
    });
    expect(body).toContain(NAME);
    expect(body).toMatch(pattern);
    expect(body).toMatch(/^💀 /);
  });
});

describe("narrateDeath · precedencia mob > cause", () => {
  it("con killer_mob conocido, la cause se ignora incluso si tuviese entrada propia", () => {
    // entity_explosion mapea a 'explosion'; pero killer_mob=creeper
    // debe ganar y usar la pool 'creeper'.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateDeath({
      playerName: NAME,
      cause: "entity_explosion",
      killerMob: "minecraft:creeper",
      vanillaMessage: null,
    });
    expect(body).toContain("Creeper");
  });

  it("con killer_mob desconocido, se cae al mapeo por cause", () => {
    const body = narrateDeath({
      playerName: NAME,
      cause: "lava",
      killerMob: "minecraft:mob_que_no_existe_todavia",
      vanillaMessage: null,
    });
    expect(body).toMatch(/lava|spa|Nether|liquido|líquido|temperatura|baño/i);
  });
});

describe("narrateDeath · selección aleatoria", () => {
  it("Math.random=0 elige la PRIMERA variante", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = narrateDeath({
      playerName: NAME,
      cause: "fall",
      killerMob: null,
      vanillaMessage: null,
    });
    expect(body).toBe("💀 Vancorbus descubrió que la gravedad sigue funcionando.");
  });

  it("Math.random=0.99 elige la ÚLTIMA variante", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const body = narrateDeath({
      playerName: NAME,
      cause: "fall",
      killerMob: null,
      vanillaMessage: null,
    });
    // La pool 'fall' tiene 8 variantes; 0.99*8 = 7.92 → floor=7 (última).
    expect(body).toBe("💀 Vancorbus creyó que podía volar durante unos segundos.");
  });

  it("distintos valores de random producen distintas frases (cobertura ≥ 2 variantes)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      vi.spyOn(Math, "random").mockReturnValue(i / 8);
      seen.add(
        narrateDeath({
          playerName: NAME,
          cause: "fall",
          killerMob: null,
          vanillaMessage: null,
        }),
      );
      vi.restoreAllMocks();
    }
    // Con 8 buckets uniformes sobre pool de 8, deberíamos ver ≥ 2.
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

describe("narrateDeath · fallback cuando no existe traducción", () => {
  it("cause+mob desconocidos + vanilla presente: usa el vanilla con prefijo 💀", () => {
    const body = narrateDeath({
      playerName: NAME,
      cause: "wither",
      killerMob: null,
      vanillaMessage: "Vancorbus withered away",
    });
    expect(body).toBe("💀 Vancorbus withered away");
  });

  it("cause+mob desconocidos + vanilla vacío: fallback genérico con nombre", () => {
    const body = narrateDeath({
      playerName: NAME,
      cause: "sonic_boom",
      killerMob: null,
      vanillaMessage: "",
    });
    expect(body).toBe(`💀 ${NAME} ha muerto.`);
  });

  it("cause+mob desconocidos + sin vanilla: fallback genérico con nombre", () => {
    const body = narrateDeath({
      playerName: NAME,
      cause: null,
      killerMob: null,
      vanillaMessage: null,
    });
    expect(body).toBe(`💀 ${NAME} ha muerto.`);
  });
});

describe("Catálogo · invariantes estructurales", () => {
  it("cada categoría tiene mínimo 3 variantes (spec T8)", () => {
    for (const [category, variants] of Object.entries(_INTERNAL.VARIANTS)) {
      expect(variants.length, `categoría ${category}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("catálogo cubre las 15 categorías declaradas en el spec", () => {
    const expected = [
      "fall",
      "creeper",
      "lava",
      "fire",
      "explosion",
      "skeleton",
      "drowning",
      "zombie",
      "spider",
      "enderman",
      "hunger",
      "cactus",
      "magma",
      "lightning",
      "potion",
    ].sort();
    expect(Object.keys(_INTERNAL.VARIANTS).sort()).toEqual(expected);
  });

  it("categorías principales cumplen los mínimos concretos del spec", () => {
    // fall/creeper/lava = 8; fire/explosion/skeleton/drowning/zombie = 6;
    // spider/enderman/hunger = 5; cactus/magma/lightning/potion = 4.
    const minimums: Record<string, number> = {
      fall: 8,
      creeper: 8,
      lava: 8,
      fire: 6,
      explosion: 6,
      skeleton: 6,
      drowning: 6,
      zombie: 6,
      spider: 5,
      enderman: 5,
      hunger: 5,
      cactus: 4,
      magma: 4,
      lightning: 4,
      potion: 4,
    };
    for (const [cat, min] of Object.entries(minimums)) {
      const variants = _INTERNAL.VARIANTS[cat as keyof typeof _INTERNAL.VARIANTS];
      expect(variants.length, `categoría ${cat}`).toBeGreaterThanOrEqual(min);
    }
  });

  it("cada variante produce string no vacío y contiene el nombre interpolado", () => {
    for (const [category, variants] of Object.entries(_INTERNAL.VARIANTS)) {
      for (const variant of variants) {
        const out = variant(NAME);
        expect(out.length, `${category}`).toBeGreaterThan(0);
        expect(out, `${category}`).toContain(NAME);
        expect(out, `${category}`).toMatch(/^💀 /);
      }
    }
  });

  it("cada mob de MOB_TO_CATEGORY mapea a una categoría existente", () => {
    for (const [mob, cat] of _INTERNAL.MOB_TO_CATEGORY) {
      expect(_INTERNAL.VARIANTS[cat], `mob ${mob} → ${cat}`).toBeDefined();
    }
  });

  it("cada cause de CAUSE_TO_CATEGORY mapea a una categoría existente", () => {
    for (const [cause, cat] of _INTERNAL.CAUSE_TO_CATEGORY) {
      expect(_INTERNAL.VARIANTS[cat], `cause ${cause} → ${cat}`).toBeDefined();
    }
  });

  it("total de frases del catálogo está en el rango objetivo [80, 120]", () => {
    let total = 0;
    for (const variants of Object.values(_INTERNAL.VARIANTS)) {
      total += variants.length;
    }
    expect(total).toBeGreaterThanOrEqual(80);
    expect(total).toBeLessThanOrEqual(120);
  });
});
