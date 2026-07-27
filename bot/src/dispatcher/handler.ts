import type { EventRecord } from "../eventstore";
import type { DispatchContext } from "../context";

// Contrato de todo handler concreto que se registre en el dispatcher.
//
// Diseno minimalista: un handler declara que tipo(s) sabe procesar y
// como procesarlos. La rutina de dispatch usa un Map<tipo, handler>
// para resolucion O(1); `supports()` es una validacion defensiva en
// tiempo de registro para evitar registrar un handler bajo un tipo
// que no maneja (bug facil de introducir con typos).
//
// `handle` recibe SIEMPRE un DispatchContext ademas del evento. Es la
// capa que aisla a los handlers concretos de dependencias
// especificas del sistema (Discord.js, base de datos, http clients).
// Cuanto mas se apoyen los handlers en `context` en lugar de imports
// directos, mas facil sera testearlos y sustituir infraestructura.
//
// Los handlers concretos NO viven en este modulo: los aportan
// sesiones posteriores del roadmap Pulso.

export interface EventHandler {
  /**
   * true si el handler puede procesar el `eventType` dado. El
   * dispatcher lo consulta al registrar para asegurarse de que el
   * handler y el tipo bajo el que se registra son coherentes.
   */
  supports(eventType: string): boolean;

  /**
   * Procesa un evento con acceso a los servicios del contexto. El
   * dispatcher solo lo invoca sobre eventos cuyo `type` esta
   * registrado bajo este handler. Debe ser idempotente: en caso de
   * error del cursor o del consumidor, el mismo evento puede llegar
   * dos veces (ADR-010 principio 4).
   */
  handle(context: DispatchContext, event: EventRecord): Promise<void>;
}
