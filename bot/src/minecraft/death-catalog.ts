// Crónicas de Muerte (T8 v1.1).
//
// Convierte los eventos player.death en narraciones cortas con
// personalidad, seleccionando aleatoriamente una variante entre
// varias por categoría. Toda la lógica de mapeo (raw cause + killer
// mob → categoría) y de selección (random pick entre variantes)
// vive AQUÍ. Los handlers sólo llaman a `narrateDeath()`.
//
// Reglas del producto:
//   1. Fidelidad al evento: nunca inventa entidades, causas ni
//      jugadores. Sólo re-narra el hecho.
//   2. Claridad: cada variante describe el mismo hecho, sólo cambia
//      la forma.
//   3. Personalidad: humor moderado, tono de cronista.
//
// Extensibilidad: añadir una categoría nueva = (a) añadir un array
// de variantes; (b) mapear su(s) cause(s) o mob(s) en las tablas de
// clasificación. Sin ifs, sin switches.

/**
 * Entrada del narrador. Todos los campos son "lo que viene del
 * plugin" tras validación externa (handler); pueden faltar y la
 * función lo maneja con fallback.
 */
export interface DeathInput {
  /** Nombre canónico del jugador (resuelto por PlayerNameResolver). */
  readonly playerName: string;
  /**
   * DamageCause del último daño, minúsculas, como el plugin lo
   * emite (`"fall"`, `"lava"`, `"entity_attack"`, `"entity_explosion"`,
   * `"projectile"`, `"drowning"`, `"starvation"`, `"contact"`,
   * `"hot_floor"`, `"lightning"`, `"magic"`, `"void"`, `"fire"`,
   * `"fire_tick"`, `"block_explosion"`, ...). `null` si el plugin no
   * lo emitió.
   */
  readonly cause: string | null;
  /**
   * Identificador namespaced del mob que remató, si lo hubo
   * (`"minecraft:creeper"`, `"minecraft:skeleton"`, ...). `null` para
   * muertes de entorno o PvP.
   */
  readonly killerMob: string | null;
  /**
   * Mensaje vanilla de Minecraft (`event.deathMessage()`) que el
   * plugin transporta en `data.message`. Se usa como fallback cuando
   * la categoría no es conocida. `null` si ausente.
   */
  readonly vanillaMessage: string | null;
}

/**
 * Categorías reconocidas por el catálogo. Añadir una categoría =
 * añadir su clave aquí + su array en VARIANTS + entrada(s) en las
 * tablas de clasificación.
 */
type DeathCategory =
  | "fall"
  | "creeper"
  | "lava"
  | "fire"
  | "explosion"
  | "skeleton"
  | "drowning"
  | "zombie"
  | "spider"
  | "enderman"
  | "hunger"
  | "cactus"
  | "magma"
  | "lightning"
  | "potion";

/** Función que interpola el nombre en una plantilla concreta. */
type Variant = (playerName: string) => string;

// --------------------------------------------------------------------
// Catálogo narrativo
// --------------------------------------------------------------------

const FALL: readonly Variant[] = [
  (n) => `💀 ${n} descubrió que la gravedad sigue funcionando.`,
  (n) => `💀 ${n} perdió la discusión contra la gravedad.`,
  (n) => `💀 El suelo ganó otra vez con ${n}.`,
  (n) => `💀 ${n} aterrizó... técnicamente.`,
  (n) => `💀 La gravedad sigue invicta; ${n} sólo confirmó el marcador.`,
  (n) => `💀 ${n} descubrió que el aterrizaje era obligatorio.`,
  (n) => `💀 El suelo respondió con entusiasmo al saludo de ${n}.`,
  (n) => `💀 ${n} creyó que podía volar durante unos segundos.`,
];

const CREEPER: readonly Variant[] = [
  (n) => `💀 Un Creeper convenció a ${n} de convertirse en fuegos artificiales.`,
  (n) => `💀 ${n} aprendió que abrazar Creepers tiene consecuencias.`,
  (n) => `💀 El Creeper ganó la negociación con ${n}.`,
  (n) => `💀 El Creeper pidió espacio... violentamente. ${n} lo entendió tarde.`,
  (n) => `💀 ${n} descubrió el radio exacto de explosión.`,
  (n) => `💀 El Creeper tenía otros planes para ${n}.`,
  (n) => `💀 La conversación entre ${n} y el Creeper terminó de forma explosiva.`,
  (n) => `💀 El Creeper aportó los efectos especiales; ${n} puso el resto.`,
];

const LAVA: readonly Variant[] = [
  (n) => `💀 ${n} confundió la lava con un spa extremadamente exclusivo.`,
  (n) => `💀 El plan de ${n} de nadar en lava tuvo resultados predecibles.`,
  (n) => `💀 La lava no aceptó nuevos visitantes; ${n} insistió igual.`,
  (n) => `💀 ${n} eligió el líquido equivocado.`,
  (n) => `💀 El Nether aprobó la decisión de ${n} con calor sobrado.`,
  (n) => `💀 El baño de ${n} terminó antes de empezar.`,
  (n) => `💀 La temperatura estaba ligeramente por encima de lo recomendado para ${n}.`,
  (n) => `💀 La lava hizo lo que mejor sabe hacer con ${n}.`,
];

const FIRE: readonly Variant[] = [
  (n) => `💀 ${n} comprobó personalmente que el fuego sí quema.`,
  (n) => `💀 El fuego insistió demasiado con ${n}.`,
  (n) => `💀 ${n} salió demasiado bien cocinado.`,
  (n) => `💀 Las llamas ganaron la discusión con ${n}.`,
  (n) => `💀 La temperatura dejó de ser agradable para ${n}.`,
  (n) => `💀 El fuego nunca tuvo buenas intenciones con ${n}.`,
];

const EXPLOSION: readonly Variant[] = [
  (n) => `💀 ${n} descubrió que la pólvora tiene opinión propia.`,
  (n) => `💀 La explosión reorganizó a ${n} en varias direcciones.`,
  (n) => `💀 ${n} presenció la detonación desde el peor asiento.`,
  (n) => `💀 El plan de ingeniería de ${n} tenía un pequeño fallo.`,
  (n) => `💀 La onda expansiva no consultó a ${n}.`,
  (n) => `💀 ${n} entendió tarde que ese bloque era TNT.`,
];

const SKELETON: readonly Variant[] = [
  (n) => `💀 Un esqueleto demostró que todavía tiene buena puntería con ${n}.`,
  (n) => `💀 ${n} subestimó el curso de tiro con arco para esqueletos.`,
  (n) => `💀 La flecha encontró exactamente a quién buscaba: ${n}.`,
  (n) => `💀 El arquero no falló; ${n} tampoco esquivó.`,
  (n) => `💀 El esqueleto llevaba horas practicando y ${n} pasó por ahí.`,
  (n) => `💀 ${n} fue el blanco perfecto.`,
];

const DROWNING: readonly Variant[] = [
  (n) => `💀 ${n} olvidó un pequeño detalle: respirar.`,
  (n) => `💀 El agua ganó por abandono a ${n}.`,
  (n) => `💀 Respirar bajo el agua sigue siendo experimental, según ${n}.`,
  (n) => `💀 Los pulmones de ${n} presentaron una queja formal.`,
  (n) => `💀 El océano no negoció con ${n}.`,
  (n) => `💀 El agua tuvo la última palabra en la disputa con ${n}.`,
];

const ZOMBIE: readonly Variant[] = [
  (n) => `💀 Un zombie tuvo una opinión muy fuerte sobre la existencia de ${n}.`,
  (n) => `💀 ${n} perdió la discusión contra un cadáver ambulante.`,
  (n) => `💀 El zombie se quedó con la última palabra frente a ${n}.`,
  (n) => `💀 La inteligencia no siempre gana; ${n} lo confirma.`,
  (n) => `💀 El zombie insistió demasiado; ${n} no aguantó.`,
  (n) => `💀 ${n} encontró al fan menos amigable del servidor.`,
];

const SPIDER: readonly Variant[] = [
  (n) => `💀 Una araña recordó a ${n} por qué existen las antorchas.`,
  (n) => `💀 ${n} descubrió las ventajas defensivas de tener ocho ojos.`,
  (n) => `💀 La araña saltó más rápido de lo que ${n} razonó.`,
  (n) => `💀 Ocho patas contra dos: la matemática no favoreció a ${n}.`,
  (n) => `💀 ${n} entró en la cueva equivocada.`,
];

const ENDERMAN: readonly Variant[] = [
  (n) => `💀 ${n} miró donde no debía.`,
  (n) => `💀 Un Enderman le enseñó a ${n} modales de manera contundente.`,
  (n) => `💀 El teletransporte del Enderman fue más rápido que la huida de ${n}.`,
  (n) => `💀 ${n} descubrió que el contacto visual es opcional... por poco tiempo.`,
  (n) => `💀 El Enderman no aceptó las miradas indiscretas de ${n}.`,
];

const HUNGER: readonly Variant[] = [
  (n) => `💀 ${n} llevó el ayuno intermitente demasiado lejos.`,
  (n) => `💀 El refrigerador nunca llegó a tiempo para ${n}.`,
  (n) => `💀 El hambre terminó ganando la partida a ${n}.`,
  (n) => `💀 Comer era una excelente idea... hace cinco minutos, ${n}.`,
  (n) => `💀 El estómago de ${n} presentó su renuncia formal.`,
];

const CACTUS: readonly Variant[] = [
  (n) => `💀 ${n} descubrió que los cactus no son para abrazar.`,
  (n) => `💀 El cactus dejó su firma en ${n}.`,
  (n) => `💀 ${n} eligió el peor atajo del desierto.`,
  (n) => `💀 El cactus estaba justo donde ${n} iba.`,
];

const MAGMA: readonly Variant[] = [
  (n) => `💀 ${n} comprobó que el bloque brillante no era decorativo.`,
  (n) => `💀 Las suelas de ${n} no resistieron el pavimento del Nether.`,
  (n) => `💀 El magma quemaba, sorprendió a ${n}.`,
  (n) => `💀 ${n} caminó por donde no debía caminar.`,
];

const LIGHTNING: readonly Variant[] = [
  (n) => `💀 Un rayo cayó exactamente sobre ${n}. Excelente puntería.`,
  (n) => `💀 El cielo eligió a ${n} entre todos los blancos posibles.`,
  (n) => `💀 La probabilidad estaba en contra de ${n} justo hoy.`,
  (n) => `💀 ${n} sirvió como pararrayos improvisado.`,
];

const POTION: readonly Variant[] = [
  (n) => `💀 La poción no era para lo que ${n} pensaba.`,
  (n) => `💀 La química le jugó una mala pasada a ${n}.`,
  (n) => `💀 El efecto duró más de lo que ${n} sobrevivió.`,
  (n) => `💀 ${n} bebió sin leer la etiqueta.`,
];

const VARIANTS: Readonly<Record<DeathCategory, readonly Variant[]>> = {
  fall: FALL,
  creeper: CREEPER,
  lava: LAVA,
  fire: FIRE,
  explosion: EXPLOSION,
  skeleton: SKELETON,
  drowning: DROWNING,
  zombie: ZOMBIE,
  spider: SPIDER,
  enderman: ENDERMAN,
  hunger: HUNGER,
  cactus: CACTUS,
  magma: MAGMA,
  lightning: LIGHTNING,
  potion: POTION,
};

// --------------------------------------------------------------------
// Clasificación: raw cause + killer mob → categoría
// --------------------------------------------------------------------
//
// Tablas de lookup (Maps). Preferimos el mob (más específico:
// distingue Creeper vs. TNT, Skeleton vs. Dispenser, etc.) sobre la
// cause genérica. Añadir un mob nuevo = añadir una fila.
//
// Fuente: nombres canónicos de Bukkit (`entity.getType().getKey()`)
// y valores de `EntityDamageEvent.DamageCause` en minúsculas —
// exactamente lo que el plugin emite (ver
// `plugin/src/main/java/com/mcecosystem/eventcollector/CombatListener.java`).

const MOB_TO_CATEGORY: ReadonlyMap<string, DeathCategory> = new Map<
  string,
  DeathCategory
>([
  ["minecraft:creeper", "creeper"],
  ["minecraft:skeleton", "skeleton"],
  ["minecraft:stray", "skeleton"],
  ["minecraft:wither_skeleton", "skeleton"],
  ["minecraft:zombie", "zombie"],
  ["minecraft:husk", "zombie"],
  ["minecraft:drowned", "zombie"],
  ["minecraft:zombie_villager", "zombie"],
  ["minecraft:zombified_piglin", "zombie"],
  ["minecraft:spider", "spider"],
  ["minecraft:cave_spider", "spider"],
  ["minecraft:enderman", "enderman"],
]);

const CAUSE_TO_CATEGORY: ReadonlyMap<string, DeathCategory> = new Map<
  string,
  DeathCategory
>([
  ["fall", "fall"],
  ["void", "fall"],
  ["fly_into_wall", "fall"],
  ["lava", "lava"],
  ["fire", "fire"],
  ["fire_tick", "fire"],
  ["entity_explosion", "explosion"],
  ["block_explosion", "explosion"],
  ["drowning", "drowning"],
  ["starvation", "hunger"],
  ["contact", "cactus"],
  ["hot_floor", "magma"],
  ["lightning", "lightning"],
  ["magic", "potion"],
]);

function classify(
  cause: string | null,
  killerMob: string | null,
): DeathCategory | null {
  if (killerMob !== null) {
    const byMob = MOB_TO_CATEGORY.get(killerMob);
    if (byMob !== undefined) return byMob;
  }
  if (cause !== null) {
    return CAUSE_TO_CATEGORY.get(cause) ?? null;
  }
  return null;
}

// --------------------------------------------------------------------
// Selección aleatoria de variante
// --------------------------------------------------------------------

function pickVariant(variants: readonly Variant[]): Variant {
  // `Math.random()` es la fuente de entropía por defecto. Los tests
  // que necesitan determinismo hacen `vi.spyOn(Math, "random")`.
  const idx = Math.floor(Math.random() * variants.length);
  return variants[idx]!;
}

// --------------------------------------------------------------------
// API pública
// --------------------------------------------------------------------

/**
 * Devuelve la línea final a publicar en Discord como body del embed
 * de player.death. Contrato:
 *
 *   - Si la categoría se reconoce → una variante narrada al azar,
 *     con el nombre del jugador interpolado.
 *   - Si NO → se usa la descripción vanilla del evento
 *     (`vanillaMessage`) con prefijo 💀.
 *   - Si tampoco hay vanillaMessage → fallback genérico
 *     "💀 <nombre> ha muerto." (nunca vacío).
 *
 * Nunca inventa mobs, causas ni jugadores: sólo re-narra el hecho.
 */
export function narrateDeath(input: DeathInput): string {
  const category = classify(input.cause, input.killerMob);
  if (category !== null) {
    return pickVariant(VARIANTS[category])(input.playerName);
  }
  if (
    input.vanillaMessage !== null &&
    input.vanillaMessage.trim().length > 0
  ) {
    return `💀 ${input.vanillaMessage.trim()}`;
  }
  return `💀 ${input.playerName} ha muerto.`;
}

// --------------------------------------------------------------------
// Introspección para tests
// --------------------------------------------------------------------
//
// Se exportan las estructuras crudas SOLO para tests estructurales
// (todo variant devuelve string no vacío, cada categoría tiene ≥ N
// variantes, todos los mobs mapean a una categoría existente, etc.).
// Consumidores en producción sólo usan `narrateDeath`.

export const _INTERNAL = {
  VARIANTS,
  MOB_TO_CATEGORY,
  CAUSE_TO_CATEGORY,
} as const;
