// Crónicas de Evolución del Servidor (T15 v1.1).
//
// Consume el evento `item.enchant` — no cada uso de la mesa de
// encantamientos, sino sólo aquellos que representan un salto real
// en la civilización del servidor: Mending, Silk Touch, Infinity,
// Fortune III, Efficiency V, encantamientos ofensivos al máximo
// nivel, etc.
//
// Contrato consumido (verificado en plugin/.../EconomyListener.java:68-86):
//   - data.enchants: array de `{ id: string, lvl: integer }` donde
//     `id` es la NamespacedKey del encantamiento
//     ("minecraft:mending", "minecraft:sharpness", ...).
//     `event.getEnchantsToAdd()` es un Map — el orden dentro del
//     array NO está garantizado.
//   - data.item: namespaced key del item encantado. NO usado por
//     este catálogo (la narrativa habla del salto tecnológico del
//     servidor, no del item concreto).
//   - data.cost_levels: XP levels cost. NO usado (el filtro por
//     nivel del encantamiento es más significativo).
//
// Filosofía: narrativas atemporales, impersonales, describiendo la
// evolución del servidor — materia prima reutilizable por Insight,
// Memoria, Legacy y Genesis en el roadmap futuro.
//
// Extensibilidad: añadir un encantamiento notable = añadir una
// entrada a NOTABLE_ENCHANTS (id + umbral de lvl + categoría).
// Añadir una categoría = añadirla a `ProgressCategory` + a VARIANTS
// + a PRIORITY_ORDER.

/**
 * Entrada del narrador. `enchants` viene ya extraído por el handler
 * como un array plano; el catálogo no toca el evento crudo.
 */
export interface ProgressInput {
  /**
   * Encantamientos añadidos en esta operación. Puede venir vacío
   * o con IDs no reconocidos — el catálogo devuelve `null` en ese
   * caso (el handler termina en silencio).
   */
  readonly enchants: readonly EnchantEntry[];
}

/** Entrada del array `data.enchants` del payload del plugin. */
export interface EnchantEntry {
  readonly id: string;
  readonly lvl: number;
}

/**
 * Categorías narrativas: cada una representa un "salto" tecnológico
 * concreto en la evolución del servidor. Añadir una nueva requiere
 * añadirla a VARIANTS y a PRIORITY_ORDER.
 */
type ProgressCategory =
  | "mending"
  | "infinity"
  | "silk_touch"
  | "fortune"
  | "efficiency"
  | "weapon_mastery"
  | "protection_mastery"
  | "trident_mastery"
  | "unbreaking_iii";

/** Función de variante — narración pura, sin datos externos. */
type Variant = () => string;

// --------------------------------------------------------------------
// Catálogo narrativo — el servidor entra en una nueva etapa
// --------------------------------------------------------------------

const MENDING: readonly Variant[] = [
  () => "⚙️ El servidor acaba de aprender a reparar lo que creía perdido.",
  () => "🛠️ Mending llegó al mundo: las herramientas ya no tienen fecha de caducidad.",
  () => "♾️ La era de las herramientas eternas acaba de empezar.",
  () => "⚙️ El servidor cruzó un umbral: la reparación por experiencia ya existe.",
  () => "🌍 Con Mending, la economía del servidor cambió para siempre.",
  () => "⚙️ Un encantamiento acaba de volver obsoleto al yunque tradicional.",
];

const INFINITY: readonly Variant[] = [
  () => "🏹 La era de las flechas infinitas comenzó.",
  () => "⚙️ El servidor ya no cuenta flechas al salir de expedición.",
  () => "🏹 El arco del servidor acaba de encontrar su forma definitiva.",
  () => "🌍 Con Infinity en escena, el tiro a distancia se volvió sostenible.",
  () => "🏹 Los aventureros ya salen sin límite de munición.",
  () => "⚙️ La logística del combate a distancia acaba de simplificarse.",
];

const SILK_TOUCH: readonly Variant[] = [
  () => "🪨 El servidor aprendió a recoger lo que antes se destruía al minar.",
  () => "🌱 Silk Touch abrió una nueva forma de coleccionar el mundo.",
  () => "🪨 La minería del servidor entró en su fase de precisión.",
  () => "🌍 Con Silk Touch, los bloques ya se transportan intactos.",
  () => "🪨 Las cosechas raras ya son parte del inventario cotidiano.",
  () => "⚙️ El servidor acaba de sumar una herramienta clave para su desarrollo.",
];

const FORTUNE: readonly Variant[] = [
  () => "💎 El servidor entró en su edad dorada de la minería.",
  () => "⛏️ Fortune III acaba de multiplicar la abundancia del servidor.",
  () => "💎 La suerte del minero ya se enseña como oficio.",
  () => "🌍 Con Fortune III, el mercado de gemas del servidor cambió de escala.",
  () => "⛏️ El diamante ya se saca en manojos, no de a uno.",
  () => "💎 Una nueva era de abundancia acaba de instalarse bajo tierra.",
];

const EFFICIENCY: readonly Variant[] = [
  () => "⛏️ Efficiency V llegó: el servidor mina al doble de velocidad.",
  () => "⚙️ La minería del servidor entró en su fase industrial.",
  () => "⛏️ Los túneles se cavan ahora en un pestañeo.",
  () => "🌍 Con Efficiency V, los proyectos grandes acaban de volverse viables.",
  () => "⛏️ El servidor tiene ya un ritmo de excavación digno de máquina.",
  () => "⚙️ La velocidad de picar bloques acaba de alcanzar su tope.",
];

const WEAPON_MASTERY: readonly Variant[] = [
  () => "⚔️ El armamento del servidor acaba de alcanzar su nivel máximo.",
  () => "🗡️ Las armas del servidor golpean ya con toda su fuerza posible.",
  () => "⚔️ La ofensiva del servidor entró en su era definitiva.",
  () => "🌍 Con encantamientos ofensivos al máximo, el combate cambió de escala.",
  () => "⚔️ El servidor ya no depende sólo del acero — depende del encantamiento.",
  () => "🗡️ Los duelos y las cacerías del servidor acaban de subir de nivel.",
];

const PROTECTION_MASTERY: readonly Variant[] = [
  () => "🛡️ La defensa del servidor acaba de alcanzar su ceiling.",
  () => "⚙️ Las armaduras del servidor ya llevan la protección máxima posible.",
  () => "🛡️ El servidor entró en su era de resistencia total.",
  () => "🌍 Con Protection IV en juego, sobrevivir ya es una decisión de equipo.",
  () => "🛡️ Los aventureros del servidor visten ya como veteranos.",
  () => "⚙️ La supervivencia acaba de dejar de depender del azar.",
];

const TRIDENT_MASTERY: readonly Variant[] = [
  () => "🔱 El servidor acaba de dominar el arte del tridente.",
  () => "⚙️ Loyalty, Riptide y Channeling ya son parte del combate del servidor.",
  () => "🔱 El mar dejó de ser un obstáculo para los guerreros del servidor.",
  () => "🌍 Con el tridente al máximo, el servidor conquistó las tormentas.",
  () => "🔱 Un nuevo estilo de combate acaba de entrar al canon del servidor.",
  () => "⚙️ Los rayos ya se dirigen a voluntad — el servidor cambió de era.",
];

const UNBREAKING_III: readonly Variant[] = [
  () => "🛠️ El servidor aprendió a construir herramientas casi imperecederas.",
  () => "⚙️ Unbreaking III se volvió estándar: la durabilidad dejó de ser un problema.",
  () => "🛠️ La economía del servidor deja de gastar tanto en reposiciones.",
  () => "🌍 Con Unbreaking III, cada objeto vive el triple de vidas.",
  () => "🛠️ El servidor entró en su era del equipo confiable.",
  () => "⚙️ Las herramientas del servidor ya casi no se rompen.",
];

const VARIANTS: Readonly<Record<ProgressCategory, readonly Variant[]>> = {
  mending: MENDING,
  infinity: INFINITY,
  silk_touch: SILK_TOUCH,
  fortune: FORTUNE,
  efficiency: EFFICIENCY,
  weapon_mastery: WEAPON_MASTERY,
  protection_mastery: PROTECTION_MASTERY,
  trident_mastery: TRIDENT_MASTERY,
  unbreaking_iii: UNBREAKING_III,
};

// --------------------------------------------------------------------
// Clasificación: encantamientos → categoría (con umbral de nivel)
// --------------------------------------------------------------------
//
// Tabla de encantamientos notables. Cada entrada dice:
//   - `id`: NamespacedKey del encantamiento como lo emite el plugin.
//   - `minLvl`: nivel mínimo para que este encantamiento cuente como
//     "hito de progreso". Encantamientos de nivel único (Mending,
//     Silk Touch, Infinity, Channeling) usan `1`; tiered
//     encantamientos exigen su máximo nivel para no publicar por
//     cada Sharpness I que cae de un libro cualquiera.
//   - `category`: pool narrativo al que pertenece.
//
// Los IDs son 1:1 con `Enchantment.getKey().toString()` del plugin.

interface NotableEnchant {
  readonly minLvl: number;
  readonly category: ProgressCategory;
}

const NOTABLE_ENCHANTS: ReadonlyMap<string, NotableEnchant> = new Map<
  string,
  NotableEnchant
>([
  // Nivel único — siempre notables.
  ["minecraft:mending", { minLvl: 1, category: "mending" }],
  ["minecraft:silk_touch", { minLvl: 1, category: "silk_touch" }],
  ["minecraft:infinity", { minLvl: 1, category: "infinity" }],
  ["minecraft:channeling", { minLvl: 1, category: "trident_mastery" }],
  // Tiered — sólo su máximo nivel dispara la crónica.
  ["minecraft:fortune", { minLvl: 3, category: "fortune" }],
  ["minecraft:efficiency", { minLvl: 5, category: "efficiency" }],
  ["minecraft:sharpness", { minLvl: 5, category: "weapon_mastery" }],
  ["minecraft:power", { minLvl: 5, category: "weapon_mastery" }],
  ["minecraft:impaling", { minLvl: 5, category: "weapon_mastery" }],
  ["minecraft:protection", { minLvl: 4, category: "protection_mastery" }],
  ["minecraft:loyalty", { minLvl: 3, category: "trident_mastery" }],
  ["minecraft:riptide", { minLvl: 3, category: "trident_mastery" }],
  ["minecraft:unbreaking", { minLvl: 3, category: "unbreaking_iii" }],
]);

/**
 * Orden de prioridad para decidir el pool cuando un mismo evento
 * trae varios encantamientos notables.
 *
 *   mending > infinity > silk_touch > fortune > efficiency >
 *   protection_mastery > weapon_mastery > trident_mastery >
 *   unbreaking_iii
 *
 * Racional: Mending es el hito narrativo más grande en Minecraft
 * moderno. Protection IV va antes que Sharpness/Power V porque en
 * el meta de PvE la defensa habilita más progreso que la ofensiva
 * (spec T15). Trident y Unbreaking cierran la lista porque suelen
 * aparecer combinados con cosas más significativas.
 */
const PRIORITY_ORDER: readonly ProgressCategory[] = [
  "mending",
  "infinity",
  "silk_touch",
  "fortune",
  "efficiency",
  "protection_mastery",
  "weapon_mastery",
  "trident_mastery",
  "unbreaking_iii",
];

/**
 * Devuelve la categoría de mayor prioridad entre las categorías
 * disparadas por los encantamientos del evento. `null` si ninguno
 * es notable (o si el array está vacío / corrupto).
 */
function classify(enchants: readonly EnchantEntry[]): ProgressCategory | null {
  const matched = new Set<ProgressCategory>();
  for (const e of enchants) {
    const notable = NOTABLE_ENCHANTS.get(e.id);
    if (notable !== undefined && e.lvl >= notable.minLvl) {
      matched.add(notable.category);
    }
  }
  if (matched.size === 0) return null;
  for (const cat of PRIORITY_ORDER) {
    if (matched.has(cat)) return cat;
  }
  return null;
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
 * Devuelve el body a publicar para un `item.enchant`, o `null` si
 * los encantamientos del evento no representan un salto notable
 * (Sharpness I común, Efficiency II de un libro suelto, etc.). El
 * handler interpreta `null` como "no publicar" (spec T15). Nunca
 * lanza.
 */
export function narrateProgress(input: ProgressInput): string | null {
  const category = classify(input.enchants);
  if (category === null) return null;
  return pickVariant(VARIANTS[category])();
}

// --------------------------------------------------------------------
// Introspección para tests
// --------------------------------------------------------------------

export const _INTERNAL = {
  VARIANTS,
  NOTABLE_ENCHANTS,
  PRIORITY_ORDER,
  classify,
} as const;
