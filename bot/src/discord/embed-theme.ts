import type { MessageKind } from "../publisher";

// Tema visual único de Pulso para embeds de Discord.
//
// Centraliza:
//   - paleta de colores por MessageKind;
//   - footer uniforme del proyecto;
//   - cualquier constante compartida futura (iconos, thumbnails,
//     imágenes, campos por defecto…).
//
// Racional: los handlers NO deciden colores. Sólo declaran `kind` en
// su PublishPayload; la capa Discord (DiscordPublisher) consulta este
// tema y aplica el color correspondiente. Cambiar la paleta es un
// commit puramente cosmético a un único archivo.
//
// Extensibilidad futura sin tocar handlers:
//   - `KIND_ICONS: Record<MessageKind, string>` para emojis / paths.
//   - `KIND_THUMBNAILS: Record<MessageKind, string>` para URLs.
//   - `EmbedDecoration` con campos opcionales agrupados por kind.
//   - Componentes interactivos (botones, menús) por kind.
// La firma de PublishPayload y de Publisher no necesita cambiar para
// nada de esto — sólo el tema y el publisher.

/**
 * Texto del footer aplicado a TODOS los embeds del bot. Da identidad
 * consistente al canal ("Pulso · mc-ecosystem") sin invadir el
 * contenido.
 */
export const FOOTER_TEXT = "Pulso · mc-ecosystem";

/**
 * Paleta de colores por tipo de mensaje. Enteros hex — el formato
 * que `EmbedBuilder.setColor` de discord.js acepta directamente sin
 * conversión.
 *
 * La paleta se acordó como parte de la identidad visual de v1.1
 * (T6 del backlog). Cambiar un color = cambiar una línea aquí, cero
 * refactor de handlers ni tests.
 */
export const KIND_COLORS: Readonly<Record<MessageKind, number>> = {
  server_started: 0x2ecc71, // verde
  server_stopped: 0xe74c3c, // rojo
  player_joined: 0x9be7a4, // verde claro
  player_left: 0x95a5a6, // gris
  player_death: 0x8b0000, // rojo oscuro
  advancement: 0x9b59b6, // morado
  chat: 0x3498db, // azul
  tps_degraded: 0xf1c40f, // amarillo
  backup: 0x808080, // gris
  dimension_first_enter: 0x1abc9c, // turquesa (exploración / nuevo mundo)
  server_milestone: 0xf39c12, // dorado (hito histórico del servidor)
  boss_kill: 0xc0392b, // rojo profundo (batalla contra un boss)
  player_kill: 0xe74c3c, // rojo (duelo PvP)
};

/**
 * Color para payloads sin `kind` declarado (retrocompatibilidad).
 * Gris azulado neutral — legible pero deliberadamente no destaca.
 */
export const NEUTRAL_COLOR = 0x546e7a;

/**
 * Resuelve el color de un `MessageKind`. Si el kind no está definido
 * en la paleta o el payload no incluye kind, devuelve NEUTRAL_COLOR.
 * Cero excepciones: la paleta nunca es motivo para NO publicar.
 */
export function colorForKind(kind: MessageKind | undefined): number {
  if (kind === undefined) return NEUTRAL_COLOR;
  return KIND_COLORS[kind];
}
