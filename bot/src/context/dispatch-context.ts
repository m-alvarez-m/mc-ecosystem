import type { Logger } from "pino";
import type { Publisher } from "../publisher";
import type { PlayerNameResolver } from "../players";
import type { LifecycleStateStore } from "../handlers/lifecycle-state";

// Contexto compartido que el dispatcher entrega a cada handler.
//
// Agrupa los servicios disponibles para la logica de un handler.
// Diseno para crecer sin romper:
// - Extender el contexto anadiendo campos NUEVOS (opcionales o
//   requeridos) es seguro: handlers existentes ignoran lo que no
//   consumen.
// - Cambiar el TIPO de un campo existente rompe handlers. Cuando
//   ocurra, tratarlo como cambio arquitectonico y documentar via
//   ADR + commit propio.
//
// Campos actuales:
// - `publisher`: sink de mensajes (Discord u otro).
// - `playerNameResolver`: unica via de resolucion UUID → nombre.
// - `logger`: sink de logs estructurados para decisiones editoriales
//   del handler (WARN al descartar un evento obsoleto, etc.). NO es
//   una excepcion — es una senal observable que el dispatcher no
//   necesita atrapar. Handlers historicos no lo consumen; handlers
//   de estado (BUG-02A) sí.
// - `freshnessThresholdMs`: umbral que los handlers de estado usan
//   para decidir si publicar. Configurado por env (default 120000 ms).
// - `lifecycleState`: maquina de estados en memoria server-wide
//   (unknown/up/down) que los handlers `ServerStartedHandler` y
//   `ServerStoppedHandler` consultan para no publicar duplicados
//   FRESCOS del mismo tipo (defense-in-depth sobre freshness).
//   Ver BUG-02C y handlers/lifecycle-state.ts.

export interface DispatchContext {
  publisher: Publisher;
  playerNameResolver: PlayerNameResolver;
  logger: Pick<Logger, "warn">;
  freshnessThresholdMs: number;
  lifecycleState: LifecycleStateStore;
}
