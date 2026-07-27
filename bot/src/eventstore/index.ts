// Barrel export del modulo Event Store.
// Un solo punto de import para consumidores dentro del bot:
//   import { EventStoreClient, TimeoutError, EventRecord } from "../eventstore";

export { EventStoreClient } from "./client";
export type { EventStoreClientOptions } from "./client";

export {
  EventStoreError,
  TimeoutError,
  NetworkError,
  HttpError,
  InvalidJsonError,
  UnexpectedResponseError,
} from "./errors";

export type {
  EventId,
  EventType,
  EventRecord,
  GetEventsParams,
  GetEventsResponse,
} from "./types";
