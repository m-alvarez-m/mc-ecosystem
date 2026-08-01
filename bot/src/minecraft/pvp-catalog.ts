// Crónicas de PvP (T12 v1.1).
//
// Convierte los eventos `player.kill` (que emite CombatListener
// cuando en `PlayerDeathEvent` el killer es otro Player) en
// crónicas cortas del duelo. Tono: divertido, irónico, elegante,
// nunca ofensivo ni humillante.
//
// Payload consumido por el handler y que llega aquí traducido:
//   - killer name (resuelto de root player_uuid)
//   - victim name (resuelto de data.victim_uuid)
//   - weapon (namespaced key del item en mano principal del killer;
//     puede ser "minecraft:air" si iba a puño desnudo)
//
// El catálogo clasifica por WEAPON. La categoría es la mejor
// aproximación que el evento nos permite; el plugin actual no
// emite `cause`, así que ciertos escenarios (empujar al Void
// desde el borde) NO se pueden distinguir de un melee normal. La
// pool `void` existe para extensibilidad futura si el plugin
// añade señales suficientes.
//
// Extensibilidad: añadir una categoría = (a) añadirla a
// `PvpCategory` y a VARIANTS; (b) añadir entradas a
// WEAPON_TO_CATEGORY (o al helper de sufijo si aplica).

/**
 * Entrada del narrador. Todos los nombres ya vienen resueltos por
 * el handler; el catálogo no toca IO ni conoce UUIDs.
 */
export interface PvpKillInput {
  /** Nombre canónico del asesino (resuelto por PlayerNameResolver). */
  readonly killer: string;
  /** Nombre canónico de la víctima (resuelto por PlayerNameResolver). */
  readonly victim: string;
  /**
   * Namespaced key del item en la mano principal del killer en el
   * momento del kill, tal como lo emite el plugin (`weaponOf` de
   * `CombatListener.java`). Puede ser `"minecraft:air"` (puño) o
   * cualquier item que el jugador tuviera equipado. `null` si el
   * campo no llegó (defensivo).
   */
  readonly weapon: string | null;
}

/**
 * Categorías reconocidas por el catálogo. Cubren el mínimo pedido
 * por T12; añadir una nueva = añadirla aquí + array en VARIANTS +
 * entradas en WEAPON_TO_CATEGORY (o al helper de sufijo).
 */
type PvpCategory =
  | "melee"
  | "projectile"
  | "explosion"
  | "fire"
  | "void"
  | "magic"
  | "unknown";

/** Función de variante — interpola killer y victim. */
type Variant = (killer: string, victim: string) => string;

// --------------------------------------------------------------------
// Catálogo narrativo
// --------------------------------------------------------------------

const MELEE: readonly Variant[] = [
  (k, v) => `⚔️ ${k} convenció a ${v} de volver al punto de respawn.`,
  (k, v) => `⚔️ ${v} perdió la discusión contra la espada de ${k}.`,
  (k, v) => `⚔️ ${k} ganó el duelo. ${v} tendrá tiempo para replantear su estrategia.`,
  (k, v) => `⚔️ ${v} descubrió que desafiar a ${k} tenía consecuencias.`,
  (k, v) => `⚔️ ${k} reclamó la victoria. ${v} deberá esperar la próxima oportunidad.`,
  (k, v) => `⚔️ El duelo terminó con ${k} como vencedor. ${v} lo asimila.`,
];

const PROJECTILE: readonly Variant[] = [
  (k, v) => `🏹 ${k} demostró que la distancia no era un problema para ${v}.`,
  (k, v) => `🏹 La flecha de ${k} encontró a ${v} sin margen para negociar.`,
  (k, v) => `🏹 ${v} confirmó que ${k} tiene buena puntería.`,
  (k, v) => `🏹 Desde lejos, ${k} zanjó el asunto con ${v}.`,
  (k, v) => `🏹 ${k} eligió no acercarse. ${v} recibió el mensaje igualmente.`,
  (k, v) => `🏹 La puntería de ${k} resultó definitiva para ${v}.`,
];

const EXPLOSION: readonly Variant[] = [
  (k, v) => `💥 ${k} decidió que la sutileza no era necesaria; ${v} lo notó.`,
  (k, v) => `💥 La explosión de ${k} incluyó a ${v} entre sus planes.`,
  (k, v) => `💥 ${v} descubrió el gusto de ${k} por la pirotecnia.`,
  (k, v) => `💥 ${k} organizó una despedida ruidosa para ${v}.`,
  (k, v) => `💥 El plan de ${k} funcionó — para ${v}, no tanto.`,
  (k, v) => `💥 Todos oyeron la respuesta de ${k} a ${v}.`,
];

const FIRE: readonly Variant[] = [
  (k, v) => `🔥 ${k} calentó la conversación con ${v} de forma definitiva.`,
  (k, v) => `🔥 ${v} descubrió que ${k} traía fuego cargado.`,
  (k, v) => `🔥 Las llamas de ${k} tenían el nombre de ${v}.`,
  (k, v) => `🔥 ${k} eligió el elemento; ${v} eligió mal el momento.`,
  (k, v) => `🔥 ${v} entró al alcance del fuego de ${k}.`,
  (k, v) => `🔥 El calor decidió el duelo entre ${k} y ${v}.`,
];

const VOID: readonly Variant[] = [
  (k, v) => `🕳️ ${v} recorrió un camino muy largo cortesía de ${k}.`,
  (k, v) => `🕳️ ${k} le mostró a ${v} lo que hay más allá del borde.`,
  (k, v) => `🕳️ El empujón de ${k} resultó definitivo para ${v}.`,
  (k, v) => `🕳️ ${v} descubrió que el suelo no era un compromiso de ${k}.`,
  (k, v) => `🕳️ ${k} eligió el atajo más corto para ${v}.`,
  (k, v) => `🕳️ La caída de ${v} vino firmada por ${k}.`,
];

const MAGIC: readonly Variant[] = [
  (k, v) => `✨ ${k} aplicó su formulario mágico a ${v}.`,
  (k, v) => `✨ La poción de ${k} no era para lo que ${v} esperaba.`,
  (k, v) => `✨ ${v} recibió la etiqueta de ${k}: efecto letal.`,
  (k, v) => `✨ ${k} eligió química fina para despedir a ${v}.`,
  (k, v) => `✨ El hechizo de ${k} tenía el nombre de ${v} escrito.`,
  (k, v) => `✨ ${v} probó el trabajo de laboratorio de ${k}.`,
];

const UNKNOWN: readonly Variant[] = [
  // El primer variante coincide con el fallback textual de la spec:
  // predecible con Math.random=0 y siempre legible.
  (k, v) => `⚔️ ${k} derrotó a ${v}.`,
  (k, v) => `⚔️ El enfrentamiento entre ${k} y ${v} terminó a favor de ${k}.`,
  (k, v) => `⚔️ ${k} zanjó cuentas pendientes con ${v}.`,
  (k, v) => `⚔️ ${v} no consiguió remontar frente a ${k}.`,
  (k, v) => `⚔️ El duelo entre ${k} y ${v} tuvo un único desenlace posible.`,
  (k, v) => `⚔️ ${k} tomó ventaja definitiva sobre ${v}.`,
];

const VARIANTS: Readonly<Record<PvpCategory, readonly Variant[]>> = {
  melee: MELEE,
  projectile: PROJECTILE,
  explosion: EXPLOSION,
  fire: FIRE,
  void: VOID,
  magic: MAGIC,
  unknown: UNKNOWN,
};

// --------------------------------------------------------------------
// Clasificación: weapon (namespaced key) → categoría
// --------------------------------------------------------------------
//
// Tabla de lookup para items específicos. Los sufijos genéricos
// ("_sword" / "_axe") se resuelven en `classify` con un check
// puntual — cubre las 6 tiers (wood/stone/iron/gold/diamond/
// netherite) sin listar 12 filas.

const WEAPON_TO_CATEGORY: ReadonlyMap<string, PvpCategory> = new Map<
  string,
  PvpCategory
>([
  // Puño desnudo y armas melee no cubiertas por sufijo.
  ["minecraft:air", "melee"],
  ["minecraft:stick", "melee"],
  ["minecraft:mace", "melee"],

  // Proyectiles.
  ["minecraft:bow", "projectile"],
  ["minecraft:crossbow", "projectile"],
  ["minecraft:trident", "projectile"],

  // Explosivos que un jugador puede activar con item en mano.
  ["minecraft:tnt", "explosion"],
  ["minecraft:end_crystal", "explosion"],
  ["minecraft:respawn_anchor", "explosion"],

  // Fuego.
  ["minecraft:flint_and_steel", "fire"],
  ["minecraft:lava_bucket", "fire"],
  ["minecraft:fire_charge", "fire"],

  // Magia (pociones y afines).
  ["minecraft:potion", "magic"],
  ["minecraft:splash_potion", "magic"],
  ["minecraft:lingering_potion", "magic"],
  ["minecraft:tipped_arrow", "magic"],
]);

function classifyByWeapon(weapon: string | null): PvpCategory {
  if (weapon === null) return "unknown";
  const explicit = WEAPON_TO_CATEGORY.get(weapon);
  if (explicit !== undefined) return explicit;
  // Sufijos que cubren todas las tiers de espadas y hachas
  // (wooden/stone/iron/golden/diamond/netherite) sin listar 12
  // filas explícitas. NO es una cascada de ifs: son dos casos
  // regulares con la misma respuesta.
  if (weapon.endsWith("_sword") || weapon.endsWith("_axe")) {
    return "melee";
  }
  return "unknown";
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
 * Devuelve el body a publicar como embed de un `player.kill`.
 * Contrato:
 *
 *   - `weapon` clasificable → variante aleatoria del pool
 *     correspondiente (melee, projectile, explosion, fire, magic).
 *   - `weapon` no clasificable (item raro o `null`) → variante del
 *     pool `unknown`. El primer variante de `unknown` es
 *     `⚔️ <killer> derrotó a <victim>.` (fallback textual del spec).
 *   - La pool `void` existe pero no es alcanzable desde `weapon`
 *     alone (el plugin no emite `cause` para `player.kill`); se
 *     reserva para cuando el evento gane información suficiente.
 *
 * Nunca falla; nunca pierde información.
 */
export function narratePvpKill(input: PvpKillInput): string {
  const category = classifyByWeapon(input.weapon);
  return pickVariant(VARIANTS[category])(input.killer, input.victim);
}

// --------------------------------------------------------------------
// Introspección para tests
// --------------------------------------------------------------------

export const _INTERNAL = {
  VARIANTS,
  WEAPON_TO_CATEGORY,
  classifyByWeapon,
} as const;
