// Barrel export del modulo dispatcher.

export type { EventHandler } from "./handler";
export type {
  OnUnknownEventCallback,
  OnHandledEventCallback,
  OnHandlerFailedCallback,
} from "./types";

export { EventDispatcher } from "./dispatcher";
export type { EventDispatcherOptions } from "./dispatcher";

export { HandlerRegistry } from "./registry";

export {
  DispatcherError,
  DuplicateHandlerError,
  InvalidHandlerError,
  HandlerExecutionError,
} from "./errors";
