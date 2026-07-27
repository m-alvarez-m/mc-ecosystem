// Payload de publicacion — abstraccion del dominio.
//
// Diseno intencionalmente pobre: dos campos suficientes para el 90 %
// de mensajes previstos ("Vancorbus consiguio: Enter the Nether",
// "Torneo del Ki iniciado"). Crecer via campos OPCIONALES aqui
// preserva compatibilidad con handlers existentes.
//
// Sin referencias a Discord, embeds, canales, colores ni thumbnails.
// Una implementacion concreta futura mapea esto a lo que necesite
// (EmbedBuilder de Discord, block de Slack, evento estructurado, etc).

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
}
