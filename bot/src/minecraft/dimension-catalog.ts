// Crónicas de Dimensión (T9 v1.1).
//
// Convierte los eventos dimension.enter (filtrados por "primera vez"
// en el handler) en narraciones cortas de exploración. Comparte la
// filosofía de death-catalog.ts: variantes múltiples por dimensión,
// selección aleatoria dentro del catálogo, cero lógica narrativa en
// los handlers, lookups por Map (sin ifs ni switches gigantes).
//
// Reglas del producto:
//   1. Fidelidad al evento: nunca inventa mundos ni jugadores. Sólo
//      re-narra el hito.
//   2. Tono: cronista ligero, sin exageración ni humor absurdo.
//   3. Personalidad consistente con Death Chronicle.
//
// Extensibilidad: añadir una dimensión soportada = (a) añadir su
// clave a `DimensionCategory` y a `VARIANTS`; (b) mapear su(s)
// identificador(es) del plugin en `DIMENSION_TO_CATEGORY`. Dimensiones
// desconocidas (mundos custom del servidor) reciben una narrativa
// fallback genérica que interpola el nombre crudo.

/**
 * Entrada del narrador. Ambos campos siempre presentes: el handler
 * los rechaza antes de llamar aquí.
 */
export interface DimensionChronicleInput {
  /** Nombre canónico del jugador (resuelto por PlayerNameResolver). */
  readonly playerName: string;
  /**
   * Identificador de dimensión emitido por el plugin
   * (`WorldListener.dimensionName`): `"overworld"`, `"the_nether"`,
   * `"the_end"`, o el nombre crudo del mundo cuando es un entorno
   * exótico (mundos multiverse, minijuegos, etc.).
   */
  readonly dimension: string;
}

/**
 * Categorías reconocidas por el catálogo. Añadir una = añadir su
 * clave aquí + su array en VARIANTS + entrada(s) en la tabla de
 * clasificación.
 */
type DimensionCategory = "overworld" | "nether" | "end";

/** Función que interpola el nombre en una plantilla concreta. */
type Variant = (playerName: string) => string;

// --------------------------------------------------------------------
// Catálogo narrativo
// --------------------------------------------------------------------

const OVERWORLD: readonly Variant[] = [
  (n) => `🌍 ${n} comenzó una nueva aventura.`,
  (n) => `🌍 Todo viaje empieza con un primer paso. ${n} acaba de darlo.`,
  (n) => `🌍 El Overworld tiene un nuevo explorador: ${n}.`,
  (n) => `🌍 ${n} abrió un nuevo capítulo.`,
  (n) => `🌍 El mundo acaba de recibir otro aventurero: ${n}.`,
  (n) => `🌍 ${n} pisó el Overworld por primera vez.`,
];

const NETHER: readonly Variant[] = [
  (n) => `🔥 ${n} cruzó el portal hacia el Nether.`,
  (n) => `🔥 El Nether tiene un nuevo visitante: ${n}.`,
  (n) => `🔥 ${n} decidió que el infierno parecía una buena idea.`,
  (n) => `🔥 Comienza la expedición al Nether de ${n}.`,
  (n) => `🔥 El calor acaba de aumentar: ${n} ha llegado.`,
  (n) => `🔥 ${n} dejó atrás el cielo azul y bajó al Nether.`,
];

const END: readonly Variant[] = [
  (n) => `👁️ ${n} llegó al End.`,
  (n) => `👁️ Un nuevo visitante desafía al dragón: ${n}.`,
  (n) => `👁️ El End ya no está tan solo. ${n} ha llegado.`,
  (n) => `👁️ ${n} cruzó el último portal.`,
  (n) => `👁️ Comienza el capítulo final para ${n}.`,
  (n) => `👁️ ${n} pisó el End por primera vez.`,
];

const VARIANTS: Readonly<Record<DimensionCategory, readonly Variant[]>> = {
  overworld: OVERWORLD,
  nether: NETHER,
  end: END,
};

// --------------------------------------------------------------------
// Clasificación: raw dimension del plugin → categoría
// --------------------------------------------------------------------
//
// El plugin (`plugin/.../WorldListener.dimensionName`) emite las
// claves de abajo. Añadir soporte a un mundo canónico nuevo = añadir
// una fila. Cualquier valor fuera de la tabla se trata como
// dimensión desconocida (fallback genérico).

const DIMENSION_TO_CATEGORY: ReadonlyMap<string, DimensionCategory> = new Map<
  string,
  DimensionCategory
>([
  ["overworld", "overworld"],
  ["the_nether", "nether"],
  ["the_end", "end"],
]);

function classify(dimension: string): DimensionCategory | null {
  return DIMENSION_TO_CATEGORY.get(dimension) ?? null;
}

// --------------------------------------------------------------------
// Selección aleatoria de variante
// --------------------------------------------------------------------

function pickVariant(variants: readonly Variant[]): Variant {
  // `Math.random()` como fuente de entropía por defecto. Los tests
  // que necesitan determinismo hacen `vi.spyOn(Math, "random")`.
  const idx = Math.floor(Math.random() * variants.length);
  return variants[idx]!;
}

// --------------------------------------------------------------------
// API pública
// --------------------------------------------------------------------

/**
 * Devuelve la línea final a publicar como body del embed
 * `dimension.enter` (primera vez). Contrato:
 *
 *   - Si la dimensión se reconoce → una variante narrada al azar,
 *     con el nombre del jugador interpolado.
 *   - Si NO → fallback genérico "🌐 <nombre> descubrió un nuevo
 *     mundo: <dimension>." que interpola el identificador crudo
 *     emitido por el plugin (evita perder el hito para mundos
 *     custom del servidor).
 *
 * Nunca inventa dimensiones ni jugadores: sólo re-narra el hecho.
 */
export function narrateDimension(input: DimensionChronicleInput): string {
  const category = classify(input.dimension);
  if (category !== null) {
    return pickVariant(VARIANTS[category])(input.playerName);
  }
  return `🌐 ${input.playerName} descubrió un nuevo mundo: ${input.dimension}.`;
}

// --------------------------------------------------------------------
// Introspección para tests
// --------------------------------------------------------------------
//
// Estructuras crudas expuestas SOLO para tests estructurales
// (mínimos por categoría, invariantes de mapping, etc.).
// Consumidores en producción sólo usan `narrateDimension`.

export const _INTERNAL = {
  VARIANTS,
  DIMENSION_TO_CATEGORY,
} as const;
