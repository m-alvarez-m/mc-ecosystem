// Barrel export del modulo Polling.

export type { PollingConsumer, EventFetcher } from "./types";

export { PollingEngine } from "./polling-engine";
export type { PollingEngineOptions } from "./polling-engine";

export {
  PollingEngineError,
  AlreadyRunningError,
  CursorAccessError,
  EventFetchError,
  ConsumerError,
  UnexpectedStopError,
} from "./errors";
