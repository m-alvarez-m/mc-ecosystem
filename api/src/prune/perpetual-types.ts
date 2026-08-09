// Tipos de evento perpetuos (ADR-012 D4): jamás se archivan, jamás se
// purgan. Fuente única — el módulo de prune, el endpoint y los tests
// importan de aquí para que la lista viva en un solo sitio auditable.
export const PERPETUAL_EVENT_TYPES = [
  "player.first_join",
  "player.death",
  "player.kill",
  "boss.kill",
  "milestone.first",
  "achievement.unlock",
  "server.start",
  "server.stop",
] as const;

export type PerpetualEventType = (typeof PERPETUAL_EVENT_TYPES)[number];
