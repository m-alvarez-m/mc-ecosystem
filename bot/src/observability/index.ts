// Barrel del modulo observability.
//
// Consumers: compose.ts (crea la instancia y cablea callbacks) y el
// futuro Health Server (T7 — lee snapshot() y lo expone en /health).
// Nadie mas.

export { RuntimeState } from "./runtime-state";
export type {
  RuntimeSnapshot,
  LastErrorRecord,
  LastEventProcessedRecord,
  ErrorScope,
} from "./metrics";
