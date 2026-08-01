// Crónicas del Servidor (T10 v1.1).
//
// Convierte los eventos milestone.first en narraciones de "primera
// vez EN LA HISTORIA DEL SERVIDOR" (no por jugador — eso lo cubre
// Dimension Chronicle). El plugin garantiza unicidad histórica vía
// SQLite (`MilestoneTracker.claim` + INSERT atómico en la tabla
// milestones), así que el bot NO deduplica.
//
// Reglas del producto:
//   1. Fidelidad al evento: nunca inventa hitos.
//   2. Tono épico contenido: cronista, no locutor.
//   3. Narración impersonal para hitos conocidos ("El servidor…",
//      "Alguien…") — la historia le pertenece al servidor, no al
//      jugador individual. El nombre sólo aparece en el fallback
//      genérico (donde no hay narrativa curada que lo permita).
//
// Extensibilidad: añadir un hito nuevo = (a) añadir su clave a
// `MilestoneCategory` y a `VARIANTS`; (b) mapear su valor de
// `data.what` en `WHAT_TO_CATEGORY`. Los `what` no reconocidos caen
// automáticamente en el fallback, así que nuevos valores emitidos
// por el plugin nunca rompen ni se pierden.

/**
 * Entrada del narrador.
 *
 * `playerName` es opcional a propósito: los hitos conocidos usan
 * narrativa impersonal ("El servidor…"), y el plugin puede emitir
 * `milestone.first` con `player_uuid = null` (p. ej. Wither muerto
 * sin killer — `ProgressListener.onBossDeath` pasa `null` a
 * `MilestoneTracker.claim`). Sólo el fallback lo interpola cuando
 * está disponible.
 */
export interface ServerMilestoneInput {
  /** Valor de `data.what` emitido por el plugin. */
  readonly what: string;
  /**
   * Nombre canónico del jugador que reclamó el hito, si lo hubo.
   * `null` para hitos server-first cuyo emisor no es un jugador
   * concreto (ver docstring de la interfaz).
   */
  readonly playerName: string | null;
}

/**
 * Categorías reconocidas por el catálogo — 1:1 con los `what` que
 * hoy emite `MilestoneTracker` desde `WorldListener` (diamond,
 * elytra, nether, end) y `ProgressListener.onBossDeath` (wither,
 * ender_dragon).
 */
type MilestoneCategory =
  | "diamond"
  | "nether"
  | "end"
  | "elytra"
  | "wither"
  | "ender_dragon";

/** Función de variante — narración pura, sin datos externos. */
type Variant = () => string;

// --------------------------------------------------------------------
// Catálogo narrativo
// --------------------------------------------------------------------

const DIAMOND: readonly Variant[] = [
  () => "💎 El servidor acaba de encontrar su primer diamante.",
  () => "💎 La era del diamante acaba de comenzar.",
  () => "💎 El primer diamante ya forma parte de la historia.",
  () => "💎 Un nuevo capítulo comienza bajo tierra.",
  () => "💎 El brillo azul apareció por primera vez.",
  () => "💎 Nunca volverá a existir un \"primer diamante\".",
];

const NETHER: readonly Variant[] = [
  () => "🔥 El Nether ya no está inexplorado.",
  () => "🔥 Alguien cruzó el portal por primera vez.",
  () => "🔥 El calor acaba de ganar un nuevo visitante.",
  () => "🔥 El primer viaje al Nether ya es historia.",
  () => "🔥 El otro mundo dejó de ser un misterio.",
  () => "🔥 La expedición comenzó.",
];

const END: readonly Variant[] = [
  () => "👁️ El End acaba de recibir a su primer visitante.",
  () => "👁️ El último capítulo acaba de abrirse.",
  () => "👁️ El vacío ya no está solo.",
  () => "👁️ El End dejó de ser un lugar desconocido.",
  () => "👁️ El portal final ya fue cruzado.",
  () => "👁️ Comienza el principio del fin.",
];

const ELYTRA: readonly Variant[] = [
  () => "🪽 El servidor ya conoce el vuelo.",
  () => "🪽 Las alturas acaban de cambiar para siempre.",
  () => "🪽 Una Elytra acaba de entrar en la historia.",
  () => "🪽 El cielo ya tiene un nuevo explorador.",
  () => "🪽 Caminar dejó de ser obligatorio.",
  () => "🪽 Comienza una nueva forma de viajar.",
];

const WITHER: readonly Variant[] = [
  () => "☠️ El primer Wither ha despertado.",
  () => "☠️ La oscuridad acaba de tomar forma.",
  () => "☠️ El servidor enfrenta un nuevo desafío.",
  () => "☠️ Alguien decidió invocar algo que quizá no debía.",
  () => "☠️ El caos acaba de comenzar.",
  () => "☠️ La paz terminó oficialmente.",
];

const ENDER_DRAGON: readonly Variant[] = [
  () => "🐉 El Dragón del End cayó por primera vez.",
  () => "🐉 El primer gran enemigo fue derrotado.",
  () => "🐉 El End nunca volverá a ser el mismo.",
  () => "🐉 La historia acaba de cambiar.",
  () => "🐉 El cielo del End quedó en silencio.",
  () => "🐉 Una era acaba de terminar.",
];

const VARIANTS: Readonly<Record<MilestoneCategory, readonly Variant[]>> = {
  diamond: DIAMOND,
  nether: NETHER,
  end: END,
  elytra: ELYTRA,
  wither: WITHER,
  ender_dragon: ENDER_DRAGON,
};

// --------------------------------------------------------------------
// Clasificación: raw `what` del plugin → categoría del catálogo
// --------------------------------------------------------------------
//
// Tabla de lookup (Map). Añadir un hito nuevo = añadir una fila.
// Fuente de los valores canónicos:
//   - `plugin/.../WorldListener.java` (diamond, elytra, nether, end)
//   - `plugin/.../ProgressListener.java` (wither, ender_dragon)

const WHAT_TO_CATEGORY: ReadonlyMap<string, MilestoneCategory> = new Map<
  string,
  MilestoneCategory
>([
  ["diamond", "diamond"],
  ["nether", "nether"],
  ["end", "end"],
  ["elytra", "elytra"],
  ["wither", "wither"],
  ["ender_dragon", "ender_dragon"],
]);

function classify(what: string): MilestoneCategory | null {
  return WHAT_TO_CATEGORY.get(what) ?? null;
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
 * Devuelve la línea final a publicar como body del embed de un
 * `milestone.first`. Contrato:
 *
 *   - Si `what` se reconoce → una variante narrada al azar; el
 *     `playerName` NO se interpola (los hitos server-first son
 *     historia impersonal del servidor).
 *   - Si NO se reconoce → fallback genérico. Si el evento trae
 *     nombre resuelto, "🏆 <nombre> alcanzó un nuevo hito histórico:
 *     <what>."; si no, "🏆 Nuevo hito histórico del servidor:
 *     <what>." — nunca perder información.
 *
 * Nunca inventa hitos ni jugadores.
 */
export function narrateServerMilestone(input: ServerMilestoneInput): string {
  const category = classify(input.what);
  if (category !== null) {
    return pickVariant(VARIANTS[category])();
  }
  if (input.playerName !== null) {
    return `🏆 ${input.playerName} alcanzó un nuevo hito histórico: ${input.what}.`;
  }
  return `🏆 Nuevo hito histórico del servidor: ${input.what}.`;
}

// --------------------------------------------------------------------
// Introspección para tests
// --------------------------------------------------------------------
//
// Estructuras crudas expuestas SOLO para tests estructurales
// (mínimos por categoría, invariantes de mapping, etc.). Consumers
// en producción sólo usan `narrateServerMilestone`.

export const _INTERNAL = {
  VARIANTS,
  WHAT_TO_CATEGORY,
} as const;
