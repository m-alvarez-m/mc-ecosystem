// Barrel del módulo insight.
//
// Consumidores dentro de la API importan desde aquí:
//
//   import * as insight from "../insight";
//
// Sin efectos secundarios. Sólo re-exports.

export * as repository from "./repository";
export * as schemas from "./schemas";
export type {
  EventCount,
  PlayerEventReference,
  PlayerInsight,
  PlayersSummary,
  ServerEventReference,
  ServerInsight,
  TimelineEvent,
} from "./types";
