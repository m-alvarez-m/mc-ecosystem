// Crónicas de Comercio con Aldeanos (T14 v1.1).
//
// Convierte los eventos `villager.trade` en crónicas del crecimiento
// económico del servidor — SÓLO cuando el intercambio representa un
// avance real. La inmensa mayoría de trades cotidianos (trigo por
// esmeralda, palos por esmeralda...) se ignora silenciosamente.
//
// Contrato consumido (verificado en plugin/.../EconomyListener.java:30-50):
//   - data.profession: SHORT key (sin "minecraft:") — "librarian",
//     "cleric", "cartographer", ..., o "wandering_trader" (fallback
//     de EntityType para AbstractVillager no-Villager).
//   - data.output: NAMESPACED key del ItemStack resultado —
//     "minecraft:enchanted_book", "minecraft:diamond_pickaxe", ...
//   - data.input, data.count: se emiten pero este catálogo NO los usa
//     — no aportan clasificación diferencial que output no dé.
//
// Filosofía: narrativa impersonal, atemporal, reutilizable — pensada
// para servir como materia prima de las siguientes fases del roadmap
// (Insight, Memoria, Legacy, Genesis). Cada crónica describe UN paso
// de la civilización del servidor, no una notificación efímera.
//
// Extensibilidad: añadir un hito nuevo específico = añadirlo a
// SPECIFIC_BY_PROFESSION; añadir una profesión al fallback = añadirla
// a PROFESSION_TO_POOL; añadir una familia de items (como el
// diamond_gear shortcut) = un nuevo helper local.

/**
 * Entrada del narrador. Ambos campos son opcionales para tolerar
 * payloads corruptos — el catálogo devuelve `null` si no puede
 * clasificar (y el handler sabe interpretarlo como "no publicar").
 */
export interface VillagerTradeInput {
  /** Short key de la profesión, o `null` si el payload la omitió. */
  readonly profession: string | null;
  /** Namespaced key del item resultado, o `null` si el payload la omitió. */
  readonly output: string | null;
}

/**
 * Pools narrativos del catálogo. Un pool o bien narra un tipo
 * específico de intercambio (nivel 1: profession + output) o bien
 * narra "cualquier trade con esta profesión" (nivel 2: profession).
 */
type TradePool =
  // ---- Nivel 1: (profession + output) — hitos concretos ----
  | "enchanted_book"
  | "ender_pearl"
  | "glowstone"
  | "experience_bottle"
  | "diamond_gear"
  | "golden_carrot"
  // ---- Nivel 2: profession — crecimiento sectorial ----
  | "librarian"
  | "cleric"
  | "cartographer"
  | "mason"
  | "armorer"
  | "weaponsmith";

/** Función de variante — narración pura, sin datos externos. */
type Variant = () => string;

// --------------------------------------------------------------------
// Catálogo narrativo
// --------------------------------------------------------------------
//
// Todas las variantes son IMPERSONALES — no nombran al jugador, ni
// mencionan cantidades ni items concretos. Cuentan el ESTADO de la
// civilización del servidor. Esto las hace reutilizables por Insight,
// Memoria y Legacy en el roadmap futuro.

const ENCHANTED_BOOK: readonly Variant[] = [
  () => "📚 Los bibliotecarios ya comparten conocimiento prohibido.",
  () => "📚 El primer libro encantado cambió de manos en el mercado.",
  () => "📚 La biblioteca ganó peso: un encantamiento pasó a la economía.",
  () => "📚 El saber ya se compra; el servidor entró en otra era.",
  () => "📚 Un pergamino con poder acaba de ser comerciado.",
  () => "📚 Los libros encantados forman ya parte de la economía local.",
];

const ENDER_PEARL: readonly Variant[] = [
  () => "👁️ Los clérigos ya venden pasajes al otro mundo.",
  () => "👁️ Una perla de Ender ya tiene precio en el servidor.",
  () => "👁️ El comercio acaba de acercar el End un paso.",
  () => "👁️ Los aldeanos comienzan a ofrecer lo imposible.",
  () => "👁️ La distancia ya se puede comprar.",
  () => "👁️ El teletransporte se está volviendo parte del mercado.",
];

const GLOWSTONE: readonly Variant[] = [
  () => "💡 La luz del Nether ya tiene demanda en la superficie.",
  () => "💡 El comercio acaba de traer glowstone del inframundo.",
  () => "💡 La iluminación ya forma parte de la economía del servidor.",
  () => "💡 Los clérigos iluminan ahora también el mercado local.",
  () => "💡 El polvo brillante ya vale su peso en esmeraldas.",
  () => "💡 Las noches del servidor serán un poco más cortas.",
];

const EXPERIENCE_BOTTLE: readonly Variant[] = [
  () => "🍾 La experiencia embotellada ya se puede adquirir.",
  () => "🍾 El progreso ahora se compra por frascos.",
  () => "🍾 Los clérigos aprendieron a envasar el saber.",
  () => "🍾 Un frasco con XP ya tiene mercado.",
  () => "🍾 El aprendizaje acaba de tener precio.",
  () => "🍾 La economía ya vende niveles de experiencia.",
];

const DIAMOND_GEAR: readonly Variant[] = [
  () => "💎 Los aldeanos ya son capaces de ofrecer equipo digno de una expedición.",
  () => "💎 El diamante ya forma parte del mercado del servidor.",
  () => "💎 El equipo de alto nivel ahora se puede comprar.",
  () => "💎 La economía alcanzó el nivel diamante.",
  () => "💎 Los herreros del pueblo ya trabajan con material de élite.",
  () => "💎 Comprar equipo de diamante es hoy una opción legítima.",
];

const GOLDEN_CARROT: readonly Variant[] = [
  () => "🥕 La cocina fina llegó al mercado del servidor.",
  () => "🥕 Los granjeros ya ofrecen alimentos de campaña.",
  () => "🥕 Preparar una expedición acaba de ser más fácil.",
  () => "🥕 El primer alimento dorado cambió de manos.",
  () => "🥕 La dieta del aventurero ya está a la venta.",
  () => "🥕 La agricultura del servidor entró en su fase gourmet.",
];

const LIBRARIAN: readonly Variant[] = [
  () => "📖 La biblioteca del servidor sigue creciendo.",
  () => "📖 Un bibliotecario cerró otro trato con el mundo.",
  () => "📖 El conocimiento continúa intercambiándose por esmeraldas.",
  () => "📖 Cada trato de un librarian construye historia.",
  () => "📖 La palabra escrita ya tiene mercado propio.",
  () => "📖 Los libros siguen circulando entre aldeanos y aventureros.",
];

const CLERIC: readonly Variant[] = [
  () => "⚗️ Los clérigos siguen ganando su lugar en la economía.",
  () => "⚗️ La casa del clérigo suma otro trato al registro del pueblo.",
  () => "⚗️ La medicina y el misticismo también dejan esmeraldas.",
  () => "⚗️ El templo del pueblo acaba de intercambiar bienes.",
  () => "⚗️ Los rituales del clérigo ya tienen precio de mercado.",
  () => "⚗️ Un clérigo cerró otro trato con la civilización.",
];

const CARTOGRAPHER: readonly Variant[] = [
  () => "🧭 El comercio ya abre caminos hacia territorios desconocidos.",
  () => "🧭 Un cartógrafo entregó otro mapa: el mundo se hace más pequeño.",
  () => "🧭 La exploración ya forma parte del mercado del servidor.",
  () => "🧭 Cada trato de un cartógrafo es una expedición futura.",
  () => "🧭 Los mapas ya se compran y se venden como cualquier bien.",
  () => "🧭 El horizonte del servidor se sigue expandiendo.",
];

const MASON: readonly Variant[] = [
  () => "🧱 El taller de piedra del pueblo cerró otro trabajo.",
  () => "🧱 El comercio ornamental ya existe en el servidor.",
  () => "🧱 Un mason cerró otro trato: la arquitectura avanza.",
  () => "🧱 Las decoraciones forman ya parte de la economía local.",
  () => "🧱 La construcción fina tiene su propio mercado.",
  () => "🧱 Cada trato de un cantero prepara la próxima ciudad.",
];

const ARMORER: readonly Variant[] = [
  () => "⚒️ El herrero de armaduras despachó otro pedido.",
  () => "⚒️ La defensa del servidor sigue creciendo trato a trato.",
  () => "⚒️ Los aldeanos ya visten al aventurero de este mundo.",
  () => "⚒️ La forja de armaduras es parte activa de la economía.",
  () => "⚒️ Un armorer cerró otro trato: el servidor está mejor equipado.",
  () => "⚒️ La protección también se compra en la plaza del pueblo.",
];

const WEAPONSMITH: readonly Variant[] = [
  () => "⚔️ El herrero de armas cerró otro trato.",
  () => "⚔️ El arsenal del servidor sigue creciendo.",
  () => "⚔️ Los aldeanos ya arman al aventurero.",
  () => "⚔️ El acero comerciado siempre construye una historia.",
  () => "⚔️ Un weaponsmith añadió otra hoja al mundo.",
  () => "⚔️ El comercio de armas ya forma parte del pulso del servidor.",
];

const VARIANTS: Readonly<Record<TradePool, readonly Variant[]>> = {
  enchanted_book: ENCHANTED_BOOK,
  ender_pearl: ENDER_PEARL,
  glowstone: GLOWSTONE,
  experience_bottle: EXPERIENCE_BOTTLE,
  diamond_gear: DIAMOND_GEAR,
  golden_carrot: GOLDEN_CARROT,
  librarian: LIBRARIAN,
  cleric: CLERIC,
  cartographer: CARTOGRAPHER,
  mason: MASON,
  armorer: ARMORER,
  weaponsmith: WEAPONSMITH,
};

// --------------------------------------------------------------------
// Clasificación de DOS NIVELES
// --------------------------------------------------------------------
//
// Nivel 1a: (profession + output) → pool específico.
//   Cada profesión tiene un sub-mapa opcional con los outputs que
//   disparan crónica específica.
//
// Nivel 1b: shortcut de diamond_gear.
//   Toolsmith/armorer/weaponsmith + cualquier output que empiece por
//   "minecraft:diamond_" → diamond_gear. Evita listar 10 pares
//   (diamond_pickaxe, diamond_hoe, diamond_sword, diamond_axe,
//   diamond_shovel, diamond_helmet, diamond_chestplate,
//   diamond_leggings, diamond_boots) manualmente.
//
// Nivel 2: profession → pool genérico de esa profesión.
//   Sólo profesiones cuyo comercio en general representa progreso
//   civil (librarian, cleric, cartographer, mason, armorer,
//   weaponsmith). Otras profesiones cotidianas (farmer, butcher,
//   fisherman, fletcher, leatherworker, shepherd, nitwit, none,
//   wandering_trader) devuelven null → no se publica.

const SPECIFIC_BY_PROFESSION: ReadonlyMap<
  string,
  ReadonlyMap<string, TradePool>
> = new Map<string, ReadonlyMap<string, TradePool>>([
  ["librarian", new Map<string, TradePool>([
    ["minecraft:enchanted_book", "enchanted_book"],
  ])],
  ["cleric", new Map<string, TradePool>([
    ["minecraft:ender_pearl", "ender_pearl"],
    ["minecraft:glowstone", "glowstone"],
    ["minecraft:experience_bottle", "experience_bottle"],
  ])],
  ["farmer", new Map<string, TradePool>([
    ["minecraft:golden_carrot", "golden_carrot"],
  ])],
]);

const DIAMOND_GEAR_PROFESSIONS: ReadonlySet<string> = new Set([
  "toolsmith",
  "armorer",
  "weaponsmith",
]);

const PROFESSION_TO_POOL: ReadonlyMap<string, TradePool> = new Map<
  string,
  TradePool
>([
  ["librarian", "librarian"],
  ["cleric", "cleric"],
  ["cartographer", "cartographer"],
  ["mason", "mason"],
  ["armorer", "armorer"],
  ["weaponsmith", "weaponsmith"],
]);

function classify(
  profession: string | null,
  output: string | null,
): TradePool | null {
  if (profession === null) return null;

  // Nivel 1a: match específico (profession + output).
  if (output !== null) {
    const specific = SPECIFIC_BY_PROFESSION.get(profession)?.get(output);
    if (specific !== undefined) return specific;

    // Nivel 1b: shortcut diamond_gear.
    if (
      DIAMOND_GEAR_PROFESSIONS.has(profession) &&
      output.startsWith("minecraft:diamond_")
    ) {
      return "diamond_gear";
    }
  }

  // Nivel 2: fallback a profession sola.
  return PROFESSION_TO_POOL.get(profession) ?? null;
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
 * Devuelve el body a publicar para un `villager.trade`, o `null` si
 * el intercambio no pertenece al catálogo (nivel 1 ni nivel 2). El
 * handler interpreta `null` como "no publicar" (spec T14). Nunca
 * lanza.
 *
 * Contrato:
 *   - `(profession, output)` con entrada específica → variante de
 *     pool específico (enchanted_book / ender_pearl / glowstone /
 *     experience_bottle / golden_carrot / diamond_gear).
 *   - `profession` con entrada de fallback → variante del pool
 *     genérico de esa profesión.
 *   - Cualquier otra combinación → `null`.
 */
export function narrateVillagerTrade(
  input: VillagerTradeInput,
): string | null {
  const pool = classify(input.profession, input.output);
  if (pool === null) return null;
  return pickVariant(VARIANTS[pool])();
}

// --------------------------------------------------------------------
// Introspección para tests
// --------------------------------------------------------------------

export const _INTERNAL = {
  VARIANTS,
  SPECIFIC_BY_PROFESSION,
  DIAMOND_GEAR_PROFESSIONS,
  PROFESSION_TO_POOL,
  classify,
} as const;
