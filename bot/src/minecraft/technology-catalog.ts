// Crónicas de Tecnología del Servidor (T16 v1.1).
//
// Consume el evento `block.place` — pero SÓLO publica cuando el
// bloque colocado pertenece a una de las categorías tecnológicas
// curadas. Todo lo demás (dirt, cobblestone, planks, wool, dust
// redstone, rieles ordinarios…) se ignora silenciosamente.
//
// Distinción semántica frente a T13 (Craft Chronicle):
//   - T13 dispara cuando alguien FABRICA un item hito.
//   - T16 dispara cuando alguien COLOCA un bloque tecnológico en
//     el mundo.
// Son dos momentos distintos del mismo objeto: se pueden craftear
// 20 hoppers y no colocar ninguno, o colocar un comparator que
// venía en un cofre sin haberlo crafteado.
//
// Contrato consumido (verificado en plugin/.../WorldListener.java:30-39):
//   - data.block: namespaced key del Material colocado
//     ("minecraft:hopper", "minecraft:sculk_sensor", ...).
//   - player_uuid, world, x, y, z: no usados (narrativa impersonal;
//     el hito es del servidor, no del constructor).
//
// Filosofía: narrativas atemporales, impersonales, que describen
// cómo el mundo del servidor se sofistica. Materia prima
// reutilizable por Insight, Memoria, Legacy y Genesis en el
// roadmap futuro.
//
// Extensibilidad: añadir una categoría = añadirla a
// `TechnologyCategory` + a VARIANTS. Añadir un bloque nuevo a una
// categoría existente = una fila más en BLOCK_TO_CATEGORY.

/**
 * Entrada del narrador. Todos los campos ya vienen extraídos por
 * el handler; el catálogo no toca el evento crudo.
 */
export interface TechnologyInput {
  /**
   * Namespaced key del bloque colocado ("minecraft:hopper", ...).
   * `null` si el payload lo omitió — el catálogo devuelve `null`
   * y el handler termina en silencio.
   */
  readonly block: string | null;
}

/**
 * Categorías narrativas. Cada una agrupa una familia de bloques
 * que representan un mismo salto tecnológico en la infraestructura
 * del servidor.
 */
type TechnologyCategory =
  | "redstone"
  | "piston"
  | "automation"
  | "rail"
  | "industry"
  | "sculk"
  | "knowledge"
  | "defense";

/** Función de variante — narración pura, sin datos externos. */
type Variant = () => string;

// --------------------------------------------------------------------
// Catálogo narrativo
// --------------------------------------------------------------------

const REDSTONE: readonly Variant[] = [
  () => "⚡ El servidor acaba de descubrir la ingeniería redstone.",
  () => "⚡ Los circuitos ya forman parte del paisaje del servidor.",
  () => "⚡ La lógica llegó al mundo: hay señal donde antes había piedra.",
  () => "⚡ Alguien decidió que el mundo respondiera solo. El servidor se ajusta.",
  () => "⚡ El servidor acaba de sumar una pieza a su cerebro colectivo.",
  () => "⚡ Los cables invisibles ya se dibujan bajo el suelo del mundo.",
  () => "⚡ La era de los circuitos ya comenzó en el servidor.",
];

const PISTON: readonly Variant[] = [
  () => "🔧 El servidor aprendió a mover bloques a voluntad.",
  () => "🔧 Los mecanismos móviles ya son parte del mundo.",
  () => "🔧 La materia dejó de ser estática en el servidor.",
  () => "🔧 Un pistón siempre significa que algo mayor está por venir.",
  () => "🔧 El movimiento programado ya existe en el mundo.",
  () => "🔧 El servidor descubrió que las paredes pueden moverse.",
  () => "🔧 La mecánica avanzada llegó oficialmente al servidor.",
];

const AUTOMATION: readonly Variant[] = [
  () => "🏭 La automatización llegó al servidor.",
  () => "🏭 El mundo empieza a hacer trabajo por sí mismo.",
  () => "🏭 Los items ya viajan solos en el servidor.",
  () => "🏭 Alguien delegó una tarea al mundo. El servidor lo acepta.",
  () => "🏭 La era de las máquinas silenciosas acaba de comenzar.",
  () => "🏭 El servidor ganó un mecanismo que trabaja mientras nadie mira.",
  () => "🏭 La logística automática ya forma parte del mundo.",
];

const RAIL: readonly Variant[] = [
  () => "🛤️ El transporte del servidor entró en su fase mecánica.",
  () => "🛤️ Los raíles ya trazan destinos concretos en el mundo.",
  () => "🛤️ El servidor acaba de acortar sus distancias.",
  () => "🛤️ Un carril propulsado siempre anuncia un proyecto mayor.",
  () => "🛤️ El movimiento por rieles ya es parte del servidor.",
  () => "🛤️ La red de transporte del mundo dio otro paso.",
  () => "🛤️ Los viajes largos del servidor acaban de volverse más fáciles.",
];

const INDUSTRY: readonly Variant[] = [
  () => "⚙️ La industria del servidor se especializó.",
  () => "⚙️ Las herramientas de producción del mundo se refinaron.",
  () => "⚙️ El servidor acaba de sumar una pieza a su cadena productiva.",
  () => "⚙️ El procesamiento avanzado ya tiene un hogar en el mundo.",
  () => "⚙️ La cocina y la forja del servidor entraron en su fase madura.",
  () => "⚙️ El servidor descubrió el valor de la especialización.",
  () => "⚙️ Una nueva estación de trabajo cambió el ritmo del mundo.",
];

const SCULK: readonly Variant[] = [
  () => "🔊 El mundo aprendió a escuchar.",
  () => "🔊 El sculk llegó al servidor: los pasos ya no son anónimos.",
  () => "🔊 La biotecnología oscura ya forma parte del mundo.",
  () => "🔊 El servidor entró en una fase más silenciosa — y más atenta.",
  () => "🔊 Alguien decidió que el mundo tuviera oído propio.",
  () => "🔊 Las vibraciones ya se registran en el servidor.",
  () => "🔊 El sculk acaba de sumar un sentido al mundo.",
];

const KNOWLEDGE: readonly Variant[] = [
  () => "📚 El servidor descubrió que el conocimiento necesita un hogar.",
  () => "📚 La biblioteca del mundo ya tiene su primera estantería.",
  () => "📚 El sonido y los libros ya son parte del paisaje del servidor.",
  () => "📚 Alguien decidió preservar algo en el mundo. El servidor lo permite.",
  () => "📚 El servidor sumó otro rincón donde guardar la historia.",
  () => "📚 La cultura del mundo entró en su fase archivística.",
  () => "📚 Los espacios de estudio del servidor siguen creciendo.",
];

const DEFENSE: readonly Variant[] = [
  () => "🔒 La fortificación del servidor avanzó otro paso.",
  () => "🔒 Las bases del mundo ganaron una capa nueva de defensa.",
  () => "🔒 El servidor descubrió el valor del hierro bien colocado.",
  () => "🔒 Alguien decidió que el mundo tuviera puertas de verdad.",
  () => "🔒 La seguridad del servidor entró en su fase deliberada.",
  () => "🔒 El perímetro de las bases del mundo se sofisticó.",
  () => "🔒 Los accesos controlados ya forman parte del servidor.",
];

const VARIANTS: Readonly<Record<TechnologyCategory, readonly Variant[]>> = {
  redstone: REDSTONE,
  piston: PISTON,
  automation: AUTOMATION,
  rail: RAIL,
  industry: INDUSTRY,
  sculk: SCULK,
  knowledge: KNOWLEDGE,
  defense: DEFENSE,
};

// --------------------------------------------------------------------
// Clasificación: raw block key → categoría
// --------------------------------------------------------------------
//
// Filtro deliberadamente ESTRICTO: block.place es de alto volumen
// (miles/día en un servidor activo). Sin filtro este handler sería
// spam. Se incluyen SÓLO bloques que:
//   (a) representan una decisión constructiva deliberada, y
//   (b) marcan un salto real de infraestructura, no relleno.
//
// Exclusiones intencionadas:
//   - minecraft:redstone (dust): demasiado frecuente en circuitos
//     grandes (30+ por minuto). Los torches/blocks/lamps sí cuentan.
//   - minecraft:rail (rail ordinario): tan común como la tierra.
//     Los rieles mecánicos (powered/detector/activator) sí cuentan.
//   - Bloques puramente estéticos (planks, wool, terracotta,
//     concrete, glazed, glass, ...): no son tecnología.
//   - Bloques de tierra/piedra/madera: relleno, no infraestructura.
//   - Furnace ordinario: demasiado común y básico. Blast furnace y
//     smoker sí cuentan (especialización).

const BLOCK_TO_CATEGORY: ReadonlyMap<string, TechnologyCategory> = new Map<
  string,
  TechnologyCategory
>([
  // Redstone deliberado — señalización, no cableado suelto.
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

  // Movimiento mecánico.
  ["minecraft:piston", "piston"],
  ["minecraft:sticky_piston", "piston"],
  ["minecraft:observer", "piston"],

  // Logística automática de items.
  ["minecraft:hopper", "automation"],
  ["minecraft:dropper", "automation"],
  ["minecraft:dispenser", "automation"],

  // Transporte por rieles mecánicos (rail ordinario se excluye).
  ["minecraft:powered_rail", "rail"],
  ["minecraft:detector_rail", "rail"],
  ["minecraft:activator_rail", "rail"],

  // Producción especializada (furnace ordinario se excluye).
  ["minecraft:blast_furnace", "industry"],
  ["minecraft:smoker", "industry"],
  ["minecraft:composter", "industry"],
  ["minecraft:campfire", "industry"],
  ["minecraft:soul_campfire", "industry"],
  ["minecraft:cauldron", "industry"],

  // Sculk (bio-tech moderno de 1.19+).
  ["minecraft:sculk_sensor", "sculk"],
  ["minecraft:calibrated_sculk_sensor", "sculk"],
  ["minecraft:sculk_shrieker", "sculk"],
  ["minecraft:sculk_catalyst", "sculk"],

  // Conocimiento y cultura material.
  ["minecraft:bookshelf", "knowledge"],
  ["minecraft:chiseled_bookshelf", "knowledge"],
  ["minecraft:jukebox", "knowledge"],
  ["minecraft:note_block", "knowledge"],

  // Defensa deliberada.
  ["minecraft:iron_bars", "defense"],
  ["minecraft:iron_door", "defense"],
  ["minecraft:iron_trapdoor", "defense"],
]);

function classify(block: string): TechnologyCategory | null {
  return BLOCK_TO_CATEGORY.get(block) ?? null;
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
 * Devuelve el body a publicar para un `block.place`, o `null` si
 * el bloque no pertenece al catálogo (el handler debe ignorar el
 * evento silenciosamente — no es un error).
 *
 * Contrato:
 *   - `input.block` reconocido → variante aleatoria del pool
 *     correspondiente.
 *   - `input.block` no reconocido o `null` → `null` (no publicar).
 */
export function narrateTechnology(input: TechnologyInput): string | null {
  if (input.block === null) return null;
  const category = classify(input.block);
  if (category === null) return null;
  return pickVariant(VARIANTS[category])();
}

// --------------------------------------------------------------------
// Introspección para tests
// --------------------------------------------------------------------

export const _INTERNAL = {
  VARIANTS,
  BLOCK_TO_CATEGORY,
  classify,
} as const;
