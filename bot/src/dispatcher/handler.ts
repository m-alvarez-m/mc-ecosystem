import type { EventRecord } from "../eventstore";

// Contrato de todo handler concreto que se registre en el dispatcher.
//
// Diseno minimalista: un handler declara que tipo(s) sabe procesar y
// como procesarlos. La rutina de dispatch usa un Map<tipo, handler>
// para resolucion O(1); `supports()` es una validacion defensiva en
// tiempo de registro para evitar registrar un handler bajo un tipo
// que no maneja (bug facil de introducir con typos).
//
// Los handlers concretos NO viven en este modulo: los aportan sesiones
// posteriores del roadmap Pulso (uno por dominio de evento, o uno
// generico segun convenga). Este modulo solo enruta.

export interface EventHandler {
  /**
   * true si el handler puede procesar el `eventType` dado. El
   * dispatcher lo consulta al registrar para asegurarse de que el
   * handler y el tipo bajo el que se registra son coherentes.
   */
  supports(eventType: string): boolean;

  /**
   * Procesa un evento. El dispatcher solo lo invoca sobre eventos
   * cuyo `type` esta registrado bajo este handler. Debe ser
   * idempotente: en caso de error del cursor o del consumidor,
   * el mismo evento puede llegar dos veces (ADR-010 principio 4).
   */
  handle(event: EventRecord): Promise<void>;
}
