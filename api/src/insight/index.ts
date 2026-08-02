// Barrel del módulo insight.
//
// Consumidores dentro de la API importan desde aquí:
//
//   import * as insight from "../insight";
//
// Sin efectos secundarios. Sólo re-exports.

export * as insights from "./insights";
export * as repository from "./repository";
export * as schemas from "./schemas";
export * as signals from "./signals";
export type {
  EventCount,
  PlayerEventReference,
  PlayerInsight,
  PlayersSummary,
  ServerEventReference,
  ServerInsight,
  TimelineEvent,
} from "./types";
