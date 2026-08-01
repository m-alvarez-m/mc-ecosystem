// Crónicas de Craft (T13 v1.1).
//
// Convierte los eventos `item.craft` (que emite EconomyListener.onCraft
// tras un CraftItemEvent en workbench) en crónicas de progreso
// tecnológico del servidor — pero SÓLO cuando el item resultado es
// uno de los hitos curados. Todo lo demás (palos, antorchas, hornos,
// paneles de valla, comida...) se ignora silenciosamente.
//
// Contrato consumido (verificado en plugin/.../EconomyListener.java:52-66):
//   - `data.item`: namespaced key del ItemStack RESULTADO
//     (`result.getType().getKey().toString()`), p. ej.
//     `"minecraft:beacon"`, `"minecraft:white_shulker_box"`.
//   - `data.count`: cantidad crafteada. Este catálogo no lo usa
//     (una crónica es una crónica, independientemente del stack).
//
// Nota sobre smithing: en Paper 1.20+ el smithing table NO dispara
// `CraftItemEvent`; sus upgrades pasan por eventos distintos que el
// plugin no reenvía. Por tanto NINGÚN item netherite_pickaxe/sword/
// armor llega aquí. El único milestone del ecosistema netherite que
// sí llega vía `item.craft` es la fabricación del propio
// `minecraft:netherite_ingot` (4 scraps + 4 gold en workbench),
// que se mapea al bucket "netherite_upgrade".
//
// Reglas del producto:
//   1. Fidelidad al evento: nunca inventa items.
//   2. Tono elegante, optimista, ligeramente épico, con humor sutil.
//   3. Sin sarcasmo agresivo, sin humillación.
//   4. Narración IMPERSONAL: el hito es del servidor. Handlers no
//      resuelven nombres.
//
// Extensibilidad: añadir un hito nuevo = (a) añadir su clave a
// `CraftCategory` y a VARIANTS; (b) añadir entradas a
// ITEM_TO_CATEGORY (o al helper de sufijo si aplica).

/** Entrada del narrador — sólo el item resultado, ya trimeado. */
export interface CraftInput {
  /** Namespaced key del item resultado, o `null` si el payload lo omitió. */
  readonly item: string | null;
}

/**
 * Categorías reconocidas por el catálogo (T13 initial roster).
 * Cada una agrupa una familia de items del vanilla en un único
 * hito narrativo del servidor.
 */
type CraftCategory =
  | "beacon"
  | "enchanting_table"
  | "ender_chest"
  | "shulker_box"
  | "smithing_table"
  | "anvil"
  | "lodestone"
  | "netherite_upgrade";

/** Función de variante — narración pura sin datos externos. */
type Variant = () => string;

// --------------------------------------------------------------------
// Catálogo narrativo
// --------------------------------------------------------------------

const BEACON: readonly Variant[] = [
  () => "✨ El primer Beacon ya ilumina una nueva etapa del servidor.",
  () => "✨ Un nuevo faro marca el progreso de esta historia.",
  () => "✨ La tecnología acaba de dar un gran salto.",
  () => "✨ La primera luz permanente ya está encendida.",
  () => "✨ El horizonte acaba de cambiar.",
  () => "✨ Un Beacon siempre significa que el servidor avanzó.",
];

const ENCHANTING_TABLE: readonly Variant[] = [
  () => "📖 La magia acaba de instalarse oficialmente.",
  () => "📖 El conocimiento ya tiene un hogar.",
  () => "📖 El primer encantamiento importante está más cerca.",
  () => "📖 El servidor acaba de descubrir un nuevo poder.",
  () => "📖 Comienza una nueva etapa para las herramientas.",
  () => "📖 La experiencia ahora vale todavía más.",
];

const ENDER_CHEST: readonly Variant[] = [
  () => "📦 La logística del servidor acaba de evolucionar.",
  () => "📦 El primer Ender Chest ya conecta dos mundos.",
  () => "📦 Los viajes ahora pesan mucho menos.",
  () => "📦 El almacenamiento acaba de cambiar para siempre.",
  () => "📦 El primer cofre imposible ya existe.",
  () => "📦 La distancia dejó de importar.",
];

const SHULKER_BOX: readonly Variant[] = [
  () => "🎒 La organización acaba de subir de nivel.",
  () => "🎒 El primer Shulker Box ya está entre nosotros.",
  () => "🎒 Llevar una base completa ahora es posible.",
  () => "🎒 El inventario acaba de hacerse mucho más grande.",
  () => "🎒 La logística encontró un nuevo aliado.",
  () => "🎒 El caos acaba de perder una batalla.",
];

const SMITHING_TABLE: readonly Variant[] = [
  () => "🛠️ El primer Smithing Table ya está listo para la próxima era.",
  () => "🛠️ El taller del servidor acaba de expandirse.",
  () => "🛠️ La forja avanzada tiene su primer hogar.",
  () => "🛠️ Un nuevo banco de trabajo prepara el terreno para el Netherite.",
  () => "🛠️ El servidor acaba de instalar su primer smithing table.",
  () => "🛠️ Las mejoras finas ya son posibles.",
];

const ANVIL: readonly Variant[] = [
  () => "🔨 El acero acaba de encontrar su taller.",
  () => "🔨 Reparar ya forma parte del futuro del servidor.",
  () => "🔨 Una nueva herramienta para construir historia.",
  () => "🔨 El primer yunque ya está en funcionamiento.",
  () => "🔨 El trabajo fino acaba de comenzar.",
  () => "🔨 El mantenimiento deja de ser un lujo.",
];

const LODESTONE: readonly Variant[] = [
  () => "🧭 La exploración acaba de ganar un nuevo punto de referencia.",
  () => "🧭 Ya existe un lugar que siempre podrá encontrarse.",
  () => "🧭 Perderse será un poco más difícil.",
  () => "🧭 El mundo acaba de ganar un nuevo destino.",
  () => "🧭 La brújula ya tiene un propósito.",
  () => "🧭 Todo viaje necesita un punto de regreso.",
];

const NETHERITE_UPGRADE: readonly Variant[] = [
  () => "⚒️ La era del Netherite acaba de comenzar.",
  () => "⚒️ La mejor tecnología del servidor ya está disponible.",
  () => "⚒️ El futuro acaba de desbloquearse.",
  () => "⚒️ El primer paso hacia el equipo definitivo ya ocurrió.",
  () => "⚒️ Una nueva generación de herramientas acaba de nacer.",
  () => "⚒️ El progreso nunca se detiene.",
];

const VARIANTS: Readonly<Record<CraftCategory, readonly Variant[]>> = {
  beacon: BEACON,
  enchanting_table: ENCHANTING_TABLE,
  ender_chest: ENDER_CHEST,
  shulker_box: SHULKER_BOX,
  smithing_table: SMITHING_TABLE,
  anvil: ANVIL,
  lodestone: LODESTONE,
  netherite_upgrade: NETHERITE_UPGRADE,
};

// --------------------------------------------------------------------
// Clasificación: raw item key del plugin → categoría
// --------------------------------------------------------------------
//
// Tabla de lookup explícita para items concretos + un check de
// sufijo para la familia shulker box (17 variantes de color en el
// vanilla). Añadir un hito nuevo = añadir una fila aquí.

const ITEM_TO_CATEGORY: ReadonlyMap<string, CraftCategory> = new Map<
  string,
  CraftCategory
>([
  ["minecraft:beacon", "beacon"],
  ["minecraft:enchanting_table", "enchanting_table"],
  ["minecraft:ender_chest", "ender_chest"],
  ["minecraft:shulker_box", "shulker_box"], // variante base sin teñir
  ["minecraft:smithing_table", "smithing_table"],
  ["minecraft:anvil", "anvil"],
  ["minecraft:lodestone", "lodestone"],
  // El único milestone del ecosistema Netherite que el plugin puede
  // reportar vía `item.craft`. Ver docstring del módulo.
  ["minecraft:netherite_ingot", "netherite_upgrade"],
]);

function classify(item: string): CraftCategory | null {
  const explicit = ITEM_TO_CATEGORY.get(item);
  if (explicit !== undefined) return explicit;
  // Familia de shulker box coloreados: 16 variantes
  // (minecraft:{color}_shulker_box). No listamos 16 filas —
  // un único check de sufijo cubre todas.
  if (item.endsWith("_shulker_box")) return "shulker_box";
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
 * Devuelve el body a publicar para un `item.craft`, o `null` si el
 * item resultado no pertenece al catálogo (el handler debe entonces
 * ignorar el evento silenciosamente — no es un error).
 *
 * Contrato:
 *   - `input.item` reconocido → variante aleatoria del pool
 *     correspondiente.
 *   - `input.item` no reconocido o `null` → `null` (no publicar).
 */
export function narrateCraft(input: CraftInput): string | null {
  if (input.item === null) return null;
  const category = classify(input.item);
  if (category === null) return null;
  return pickVariant(VARIANTS[category])();
}

// --------------------------------------------------------------------
// Introspección para tests
// --------------------------------------------------------------------

export const _INTERNAL = {
  VARIANTS,
  ITEM_TO_CATEGORY,
  classify,
} as const;
