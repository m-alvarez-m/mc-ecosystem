// Crónicas de Exploración del Servidor (T17 v1.1).
//
// Consume `chunk.first_load` — pero SÓLO publica cuando el chunk
// generado cae en la rejilla-muestra (multiplicaciones de 16 en
// ambos ejes). Sin este filtro el handler sería spam: en una
// sesión activa un jugador puede generar 500+ chunks nuevos.
//
// Contrato consumido (verificado en plugin/.../WorldListener.java:76-96):
//   - world (root): nombre raw del mundo del server ("world",
//     "world_nether", "world_the_end", o nombres custom).
//   - data.chunk_x, data.chunk_z: coordenadas de chunk (enteros,
//     pueden ser negativos).
//   - player_uuid, x, z: emitidos pero NO usados aquí (narrativa
//     impersonal — el hito es del servidor, no del explorador).
//
// Filosofía: narrativas atemporales, impersonales. Materia prima
// reutilizable por Insight, Memoria, Legacy y Genesis en el
// roadmap futuro. El protagonista siempre es "el servidor" o "el
// mundo" — nunca un jugador.
//
// Extensibilidad: añadir un pool = añadirlo a `ExplorationCategory`
// + VARIANTS. Cambiar rangos de distancia = editar las constantes
// FRONTIER_MAX / WILDERNESS_MAX / FAR_MAX. Cambiar densidad de
// muestreo = editar GRID_STEP.

/**
 * Entrada del narrador. Todos los campos son tolerantes a null
 * para soportar payloads corruptos — el catálogo devuelve `null`
 * en ese caso y el handler termina en silencio.
 */
export interface ExplorationInput {
  /** Nombre raw del mundo emitido por el plugin (`world`, `world_nether`, ...). */
  readonly world: string | null;
  /** Coordenada X del chunk generado (entero, puede ser negativo). */
  readonly chunkX: number | null;
  /** Coordenada Z del chunk generado (entero, puede ser negativo). */
  readonly chunkZ: number | null;
}

/**
 * Pools narrativos. 4 para overworld estratificados por distancia
 * del spawn, más 1 por dimensión estable, más 1 para mundos
 * custom del server (creativo, arena, etc.).
 */
type ExplorationCategory =
  | "frontier"          // overworld, d < 1000 bloques
  | "wilderness"        // overworld, 1000 ≤ d < 5000
  | "far_wilderness"    // overworld, 5000 ≤ d < 15000
  | "deep_wilderness"   // overworld, d ≥ 15000 (aproximándose al border)
  | "nether"            // cualquier chunk en Nether
  | "end"               // cualquier chunk en End
  | "unknown_world";    // mundos custom (nombres no reconocidos)

/** Función de variante — narración pura, sin datos externos. */
type Variant = () => string;

// --------------------------------------------------------------------
// Constantes de clasificación
// --------------------------------------------------------------------

/**
 * Paso de la rejilla de muestreo. Un chunk publica sólo si sus
 * coordenadas (chunk_x, chunk_z) son ambas multiplicaciones exactas
 * de GRID_STEP. Densidad efectiva: 1 chunk de cada GRID_STEP²
 * (16×16 = 256). En bloques: un evento cada ~256 bloques de
 * frontera. Determinístico y stateless — el handler no necesita
 * memoria para filtrar.
 */
const GRID_STEP = 16;

/** Umbrales de distancia en BLOQUES desde spawn (0,0). */
const FRONTIER_MAX = 1000;
const WILDERNESS_MAX = 5000;
const FAR_MAX = 15000;

// --------------------------------------------------------------------
// Catálogo narrativo
// --------------------------------------------------------------------

const FRONTIER: readonly Variant[] = [
  () => "🗺️ El servidor acaba de ampliar sus horizontes.",
  () => "🗺️ Un nuevo terreno cercano del mundo dejó de ser desconocido.",
  () => "🗺️ El mapa del servidor sigue creciendo desde el centro.",
  () => "🗺️ Los alrededores del mundo siguen revelándose.",
  () => "🗺️ La zona conocida del servidor acaba de expandirse otro paso.",
  () => "🗺️ Un rincón nuevo apareció en el mundo, al alcance del spawn.",
  () => "🗺️ El servidor está trazando los primeros contornos de su mundo.",
  () => "🗺️ La periferia inmediata del servidor gana otro fragmento.",
];

const WILDERNESS: readonly Variant[] = [
  () => "🏞️ La frontera del servidor sigue avanzando.",
  () => "🏞️ Un nuevo tramo salvaje del mundo dejó de ser un misterio.",
  () => "🏞️ El servidor descubrió otra parcela del gran mapa.",
  () => "🏞️ La ruta hacia el interior del mundo sigue trazándose.",
  () => "🏞️ Un valle nuevo entró en la cartografía del servidor.",
  () => "🏞️ El mapa del mundo ganó otro rincón salvaje.",
  () => "🏞️ La exploración del servidor está en pleno vuelo.",
  () => "🏞️ El pulso de expedición del mundo sigue firme.",
];

const FAR_WILDERNESS: readonly Variant[] = [
  () => "🌄 El horizonte lejano del servidor acaba de acortarse otro trecho.",
  () => "🌄 El servidor entra en territorio realmente distante.",
  () => "🌄 Las tierras remotas del mundo empiezan a rendirse.",
  () => "🌄 Un nuevo bioma lejano acaba de sumarse al mapa del servidor.",
  () => "🌄 La leyenda de las tierras lejanas del servidor se sigue escribiendo.",
  () => "🌄 El mapa del servidor se estira hacia lo desconocido.",
  () => "🌄 Un rincón olvidado del mundo acaba de aparecer.",
  () => "🌄 La frontera del mundo del servidor está lejos y sigue moviéndose.",
];

const DEEP_WILDERNESS: readonly Variant[] = [
  () => "🏔️ El servidor se está acercando a los confines del mundo.",
  () => "🏔️ Un territorio profundo del mundo dejó de ser sólo un rumor.",
  () => "🏔️ El límite del mapa del servidor está cada vez más lejos.",
  () => "🏔️ Las tierras de nadie del mundo ya tienen huellas.",
  () => "🏔️ El servidor acaba de tocar zonas que casi nadie visita.",
  () => "🏔️ La geografía extrema del mundo sigue revelándose.",
  () => "🏔️ El mundo del servidor se sigue extendiendo hasta donde alcanza la vista.",
  () => "🏔️ Los límites del mapa del servidor siguen retrocediendo.",
];

const NETHER: readonly Variant[] = [
  () => "🔥 El Nether del servidor sigue abriendo nuevos territorios.",
  () => "🔥 Un rincón infernal del mundo entró en el mapa.",
  () => "🔥 Las tierras rojas del Nether siguen expandiéndose en el servidor.",
  () => "🔥 El otro mundo del servidor revela otra de sus zonas.",
  () => "🔥 La geografía del Nether del servidor sigue creciendo.",
  () => "🔥 Un tramo del Nether del servidor acaba de dejar de ser inexplorado.",
  () => "🔥 El mapa del inframundo del servidor gana otro pedazo.",
  () => "🔥 El Nether del servidor sigue escribiendo su cartografía.",
];

const END: readonly Variant[] = [
  () => "👁️ El End del servidor sigue revelando sus islas.",
  () => "👁️ Un fragmento del vacío final acaba de sumarse al mapa del servidor.",
  () => "👁️ Las islas del End del servidor continúan apareciendo.",
  () => "👁️ El otro lado del portal del servidor sigue expandiéndose.",
  () => "👁️ El fin del servidor acaba de mostrar otro trozo de sí mismo.",
  () => "👁️ La geografía del End del servidor gana un nuevo pedazo.",
  () => "👁️ Las tierras finales del mundo siguen brotando de la nada.",
  () => "👁️ El vacío del End del servidor cede otro fragmento al mapa.",
];

const UNKNOWN_WORLD: readonly Variant[] = [
  () => "🌐 Un mundo lateral del servidor sigue creciendo.",
  () => "🌐 Una dimensión adicional del servidor acaba de expandirse.",
  () => "🌐 El mapa de un mundo extra del servidor sumó otro rincón.",
  () => "🌐 El servidor descubrió otro fragmento de un mundo secundario.",
  () => "🌐 Los mundos accesorios del servidor siguen ganando geografía.",
  () => "🌐 Un territorio de otro mundo del servidor dejó de ser desconocido.",
  () => "🌐 La geografía secundaria del servidor sigue avanzando.",
  () => "🌐 Un mundo alterno del servidor acaba de crecer un poco más.",
];

const VARIANTS: Readonly<Record<ExplorationCategory, readonly Variant[]>> = {
  frontier: FRONTIER,
  wilderness: WILDERNESS,
  far_wilderness: FAR_WILDERNESS,
  deep_wilderness: DEEP_WILDERNESS,
  nether: NETHER,
  end: END,
  unknown_world: UNKNOWN_WORLD,
};

// --------------------------------------------------------------------
// Clasificación de mundo — raw world name → tipo de dimensión
// --------------------------------------------------------------------
//
// El plugin emite `world.getName()` sin normalizar. Nombres estándar
// de Paper: "world" (overworld), "world_nether" (Nether),
// "world_the_end" (End). Nombres custom (multiworld, arenas,
// creativos) van al pool "unknown_world".
//
// Lookup por Map — un mundo desconocido devuelve "unknown" y el
// pipeline elige `unknown_world`. Añadir aliases de mundo (para
// plugins como Multiverse que renombran) = una fila más.

type DimensionKind = "overworld" | "nether" | "end";

const WORLD_TO_DIMENSION: ReadonlyMap<string, DimensionKind> = new Map<
  string,
  DimensionKind
>([
  ["world", "overworld"],
  ["world_the_normal", "overworld"],
  ["world_nether", "nether"],
  ["world_the_nether", "nether"],
  ["world_the_end", "end"],
  ["world_end", "end"],
]);

function classifyDimension(worldName: string): DimensionKind | "unknown" {
  return WORLD_TO_DIMENSION.get(worldName) ?? "unknown";
}

// --------------------------------------------------------------------
// Filtro de muestreo + selección de pool
// --------------------------------------------------------------------

function isOnSamplingGrid(chunkX: number, chunkZ: number): boolean {
  // % en JS: (-16) % 16 === 0, (-17) % 16 === -1. Ambos signos
  // funcionan correctamente sin necesidad de Math.abs.
  return chunkX % GRID_STEP === 0 && chunkZ % GRID_STEP === 0;
}

function distanceInBlocks(chunkX: number, chunkZ: number): number {
  const bx = chunkX * 16;
  const bz = chunkZ * 16;
  return Math.sqrt(bx * bx + bz * bz);
}

function pickOverworldPool(chunkX: number, chunkZ: number): ExplorationCategory {
  const d = distanceInBlocks(chunkX, chunkZ);
  if (d < FRONTIER_MAX) return "frontier";
  if (d < WILDERNESS_MAX) return "wilderness";
  if (d < FAR_MAX) return "far_wilderness";
  return "deep_wilderness";
}

function classify(input: ExplorationInput): ExplorationCategory | null {
  // Coordenadas inválidas → no clasificable.
  if (input.chunkX === null || input.chunkZ === null) return null;
  if (!Number.isFinite(input.chunkX) || !Number.isFinite(input.chunkZ)) return null;
  if (!Number.isInteger(input.chunkX) || !Number.isInteger(input.chunkZ)) return null;

  // Filtro de muestreo — sin él, spam.
  if (!isOnSamplingGrid(input.chunkX, input.chunkZ)) return null;

  // Sin nombre de mundo, no podemos ubicar la crónica.
  if (input.world === null) return null;

  const kind = classifyDimension(input.world);
  if (kind === "nether") return "nether";
  if (kind === "end") return "end";
  if (kind === "unknown") return "unknown_world";
  // overworld: bucket por distancia.
  return pickOverworldPool(input.chunkX, input.chunkZ);
}

// --------------------------------------------------------------------
// Selección aleatoria de variante
// --------------------------------------------------------------------

function pickVariant(variants: readonly Variant[]): Variant {
  const idx = Math.floor(Math.random() * variants.length);
  return variants[idx]!;
}

// --------------------------------------------------------------------
// API pública
// --------------------------------------------------------------------

/**
 * Devuelve el body a publicar para un `chunk.first_load`, o `null`
 * cuando el chunk cae fuera de la rejilla de muestreo o el
 * payload está incompleto. El handler interpreta `null` como
 * "no publicar" (spec T17). Nunca lanza.
 */
export function narrateExploration(input: ExplorationInput): string | null {
  const category = classify(input);
  if (category === null) return null;
  return pickVariant(VARIANTS[category])();
}

// --------------------------------------------------------------------
// Introspección para tests
// --------------------------------------------------------------------

export const _INTERNAL = {
  VARIANTS,
  WORLD_TO_DIMENSION,
  GRID_STEP,
  FRONTIER_MAX,
  WILDERNESS_MAX,
  FAR_MAX,
  classify,
  classifyDimension,
  isOnSamplingGrid,
  distanceInBlocks,
} as const;
