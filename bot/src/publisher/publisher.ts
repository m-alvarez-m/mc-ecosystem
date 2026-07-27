import type { PublishPayload } from "./types";

// Interfaz abstracta de publicacion.
//
// El Publisher representa la capacidad de "hacer visible" informacion
// hacia el exterior del servicio. No asume canal, formato ni sistema
// concreto de destino: implementaciones futuras pueden apuntar a
// Discord (via EmbedBuilder), Slack, un log estructurado, un webhook
// arbitrario, o combinaciones (fan-out a varios destinos).
//
// Los handlers dependen SOLO de esta interfaz. Cambiar el sistema de
// publicacion (o anadir uno paralelo) no requiere modificar handlers.
// Esa es toda la razon de ser de esta abstraccion.
//
// Este modulo NO incluye ninguna implementacion concreta. Los
// publishers vivos (DiscordPublisher, etc.) llegan en sesiones
// posteriores del roadmap Pulso.

export interface Publisher {
  /**
   * Publica `payload` al destino del publisher. Async: la
   * implementacion tipicamente hace IO (HTTP, socket, disco). El
   * handler llamante puede await o disparar-y-olvidar segun su
   * necesidad, pero cualquier excepcion del publisher se propaga al
   * dispatcher, que la envuelve en HandlerExecutionError.
   */
  publish(payload: PublishPayload): Promise<void>;
}
