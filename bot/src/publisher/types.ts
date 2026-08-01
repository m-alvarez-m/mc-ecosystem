// Payload de publicacion — abstraccion del dominio.
//
// Diseno intencionalmente pobre: campos sencillos suficientes para el
// 90 % de mensajes previstos ("Vancorbus consiguio: Enter the Nether",
// "Torneo del Ki iniciado"). Crecer via campos OPCIONALES aqui
// preserva compatibilidad con handlers existentes.
//
// Sin referencias a Discord, embeds, canales, colores ni thumbnails.
// Una implementacion concreta futura mapea esto a lo que necesite
// (EmbedBuilder de Discord, block de Slack, evento estructurado, etc).

/**
 * Etiqueta semantica que categoriza un mensaje. La implementacion
 * concreta (DiscordPublisher en v1.1) la mapea a su representacion
 * visual — color del embed, iconos futuros, etc. Los handlers la
 * establecen para declarar QUE tipo de evento estan publicando; NO
 * conocen ni deciden como se muestra.
 *
 * Cambiar / anadir valores requiere actualizar `KIND_COLORS` en
 * `bot/src/discord/embed-theme.ts` (TypeScript falla el build si falta).
 */
export type MessageKind =
  | "server_started"
  | "server_stopped"
  | "player_joined"
  | "player_left"
  | "player_death"
  | "advancement"
  | "chat"
  | "tps_degraded"
  | "backup"
  | "dimension_first_enter"
  | "server_milestone"
  | "boss_kill"
  | "player_kill";

export interface PublishPayload {
  /**
   * Titulo o asunto corto. Opcional: no toda publicacion lo necesita
   * (una linea unica se pone en `body`).
   */
  title?: string;

  /**
   * Cuerpo del mensaje. Obligatorio: publicar sin contenido carece
   * de sentido semantico.
   */
  body: string;

  /**
   * Etiqueta semantica opcional para presentacion. Ausente = el
   * publisher usa su default neutral (preserva compatibilidad hacia
   * atras). Los 13 handlers de v1.1 la declaran siempre para que la
   * capa de embeds pueda colorear consistentemente.
   */
  kind?: MessageKind;
}
