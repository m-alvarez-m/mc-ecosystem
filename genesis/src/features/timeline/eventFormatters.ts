// Formatters textuales del Timeline (D5).
//
// Traducen `type` del catálogo (docs/event-catalog.md) a un TÍTULO
// humano corto en español. Regla:
//   - NO mostrar JSON.
//   - NO mostrar data / payloads / valores del evento.
//   - NO mostrar UUIDs completos.
//   - Fallback: si un `type` no tiene entrada, devolver el propio
//     `type` para que el operador entienda que existe pero aún no
//     tiene formatter.

// Cobertura de types conocidos hoy (2026-08). Mantener esta tabla en
// sync con `docs/event-catalog.md` — un tipo sin entrada aquí NO
// rompe la UI, sólo se pinta con su nombre técnico.
const EVENT_TITLES: Record<string, string> = {
  // Servidor
  "server.start": "Servidor iniciado",
  "server.stop": "Servidor detenido",
  "server.tps_sample": "Muestra de rendimiento",

  // Sesión
  "session.start": "Jugador se conectó",
  "session.end": "Jugador se desconectó",
  "session.afk_start": "Jugador en AFK",
  "session.afk_end": "Jugador volvió del AFK",

  // Mundo
  "chunk.first_load": "Nuevo chunk explorado",
  "dimension.enter": "Cambio de dimensión",
  "position.sample": "Muestreo de posición",

  // Bloques
  "block.break": "Bloque roto",
  "block.place": "Bloque colocado",

  // Combate
  "player.death": "Jugador murió",
  "player.kill": "Duelo PvP",
  "mob.kill": "Mob abatido",
  "damage.minute": "Actividad de combate",

  // Progreso e hitos
  "advancement.done": "Avance conseguido",
  "milestone.first": "Hito del servidor",
  "boss.kill": "Jefe derrotado",

  // Economía e ítems
  "villager.trade": "Comercio con aldeano",
  "item.craft": "Ítem crafteado",
  "item.enchant": "Ítem encantado",
  "fishing.catch": "Captura de pesca",

  // Social
  "chat.message": "Mensaje de chat",

  // Backup / infra
  "backup.done": "Respaldo completado",

  // Modo Evento
  "event.start": "Modo Evento iniciado",
  "event.end": "Modo Evento finalizado",
  "haunt.appearance": "Aparición fantasma",
  "haunt.sound": "Sonido fantasma",

  // Manuales
  "project.registered": "Proyecto registrado",
  "base.registered": "Base registrada",

  // Diagnóstico
  "test.ping": "Prueba de ingesta",
};

/**
 * Título humano de un evento. Si no hay entrada en la tabla,
 * devuelve el `type` crudo (mejor mostrar el nombre técnico que
 * inventar una traducción incorrecta).
 */
export function eventTitle(type: string): string {
  return EVENT_TITLES[type] ?? type;
}

// ------------------------------------------------------------------
// Categorías (para EventIcon)
// ------------------------------------------------------------------

/**
 * Categoría visual del evento — mapea prefijos del catálogo a un
 * grupo con icono propio. Regla intencionalmente simple: se lee el
 * dominio antes del punto y se agrupan variantes cercanas.
 */
export type EventCategory =
  | "server"
  | "session"
  | "world"
  | "block"
  | "combat"
  | "progress"
  | "economy"
  | "chat"
  | "backup"
  | "event"
  | "unknown";

export function eventCategory(type: string): EventCategory {
  const domain = type.split(".", 1)[0] ?? "";
  switch (domain) {
    case "server":
      return "server";
    case "session":
      return "session";
    case "player":
    case "mob":
    case "damage":
    case "boss":
      return "combat";
    case "block":
      return "block";
    case "chunk":
    case "dimension":
    case "position":
      return "world";
    case "advancement":
    case "milestone":
      return "progress";
    case "villager":
    case "item":
    case "fishing":
      return "economy";
    case "chat":
      return "chat";
    case "backup":
      return "backup";
    case "event":
    case "haunt":
    case "project":
    case "base":
      return "event";
    default:
      return "unknown";
  }
}

// ------------------------------------------------------------------
// Player id corto (subtítulo)
// ------------------------------------------------------------------

/**
 * Prefijo corto del UUID del jugador para el subtítulo. NO se
 * resuelve al nombre — D5 sólo puede consumir /timeline.
 * `null` si el evento no tiene `player_uuid` (server-level).
 */
export function shortPlayerId(playerUuid: string | null): string | null {
  if (playerUuid === null) return null;
  const stripped = playerUuid.replace(/-/g, "");
  if (stripped.length === 0) return null;
  return `#${stripped.slice(0, 8)}`;
}
