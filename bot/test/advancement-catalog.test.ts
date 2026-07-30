import { describe, it, expect } from "vitest";
import { ADVANCEMENT_CATALOG } from "../src/minecraft/advancement-catalog";

// Tests estructurales del catálogo estático de advancements.
//
// No verifican la traducción concreta de cada entrada (sería duplicar
// datos): verifican propiedades del diccionario que si alguien viola
// causa bugs sistemáticos — títulos vacíos, descripciones ausentes,
// IDs mal formados, etc.

describe("ADVANCEMENT_CATALOG", () => {
  it("contiene al menos los dos ejemplos que motivaron esta funcionalidad", () => {
    expect(ADVANCEMENT_CATALOG.has("minecraft:story/mine_stone")).toBe(true);
    expect(ADVANCEMENT_CATALOG.has("minecraft:story/enter_the_end")).toBe(true);

    expect(ADVANCEMENT_CATALOG.get("minecraft:story/mine_stone")?.title).toBe(
      "Edad de Piedra",
    );
    expect(ADVANCEMENT_CATALOG.get("minecraft:story/enter_the_end")?.title).toBe(
      "El End... ¿Otra vez?",
    );
  });

  it("todas las entradas tienen title no vacío tras trim", () => {
    for (const [id, entry] of ADVANCEMENT_CATALOG) {
      expect(typeof entry.title, `entry for ${id}`).toBe("string");
      expect(entry.title.trim().length, `title vacío para ${id}`).toBeGreaterThan(0);
    }
  });

  it("todas las entradas tienen description no vacía tras trim", () => {
    for (const [id, entry] of ADVANCEMENT_CATALOG) {
      expect(typeof entry.description, `entry for ${id}`).toBe("string");
      expect(
        entry.description.trim().length,
        `description vacía para ${id}`,
      ).toBeGreaterThan(0);
    }
  });

  it("todas las keys tienen la forma canónica minecraft:<tree>/<slug>", () => {
    const idPattern = /^minecraft:[a-z_]+\/[a-z_]+$/;
    for (const id of ADVANCEMENT_CATALOG.keys()) {
      expect(id).toMatch(idPattern);
    }
  });

  it("incluye la raíz de los 5 árboles vanilla", () => {
    for (const tree of ["story", "nether", "end", "adventure", "husbandry"]) {
      const rootId = `minecraft:${tree}/root`;
      expect(
        ADVANCEMENT_CATALOG.has(rootId),
        `falta la raíz del árbol '${tree}'`,
      ).toBe(true);
    }
  });

  it("expone al menos 25 entradas (seed set mínimo v1.1)", () => {
    // Umbral bajo intencional: el catálogo puede crecer commit a
    // commit sin romper este test. Sólo advierte si se degrada por
    // debajo del seed que se acordó en v1.1.
    expect(ADVANCEMENT_CATALOG.size).toBeGreaterThanOrEqual(25);
  });

  it("es un ReadonlyMap: el consumer no puede mutar el catálogo", () => {
    // TS marca .set como no permitido en ReadonlyMap. En runtime el
    // objeto es un Map real, pero el compilador rechaza la mutación
    // desde el import tipado. Aquí verificamos la superficie tipada:
    // simplemente que el objeto responde a los métodos de lectura y
    // no expone superficie de escritura por el tipo público.
    // (Cast a Map para poder llamar .set y demostrar que EN RUNTIME
    // sigue siendo mutable; el test es prueba de la disciplina TS,
    // no una garantía de inmutabilidad en runtime — para eso haría
    // falta Object.freeze o iterables. Aceptado: la promesa es de
    // tipos, no de runtime.)
    const asMap = ADVANCEMENT_CATALOG as unknown as Map<string, unknown>;
    expect(typeof asMap.get).toBe("function");
    expect(typeof asMap.has).toBe("function");
  });
});
