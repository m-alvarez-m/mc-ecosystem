// Esquemas AJV para validar entradas de las rutas GET /insight/*.
//
// Mismo estilo que routes/events.ts y routes/players.ts:
//   - `format: "date-time"` habilitado por ajv-formats (registrado en
//     api/src/index.ts).
//   - `limit` como string numérico validado por regex — Fastify
//     entrega los query params como string, se parsea en el handler.
//   - `additionalProperties: false` para rechazar params inesperados.
//
// Los esquemas son `as const` para preservar el literal-type y evitar
// el `readonly`/`never[]` que introduce Fastify si detecta mutabilidad.

export const countQuerySchema = {
  type: "object",
  required: ["from", "to"],
  additionalProperties: false,
  properties: {
    from: { type: "string", format: "date-time" },
    to: { type: "string", format: "date-time" },
    type: { type: "string", minLength: 1 },
  },
} as const;

export const timelineQuerySchema = {
  type: "object",
  required: ["from", "to"],
  additionalProperties: false,
  properties: {
    from: { type: "string", format: "date-time" },
    to: { type: "string", format: "date-time" },
    limit: { type: "string", pattern: "^[1-9]\\d*$" },
  },
} as const;

export const playersQuerySchema = {
  type: "object",
  required: ["from"],
  additionalProperties: false,
  properties: {
    from: { type: "string", format: "date-time" },
  },
} as const;

export const playerParamsSchema = {
  type: "object",
  required: ["uuid"],
  additionalProperties: false,
  properties: {
    uuid: { type: "string", format: "uuid" },
  },
} as const;

// -------------------------------------------------------------------
// I2 · Schemas de agregados
// -------------------------------------------------------------------

/**
 * Rango temporal obligatorio. Compartido por hourly y daily —
 * ambos reciben exactamente los mismos params.
 */
export const activityQuerySchema = {
  type: "object",
  required: ["from", "to"],
  additionalProperties: false,
  properties: {
    from: { type: "string", format: "date-time" },
    to: { type: "string", format: "date-time" },
  },
} as const;

/**
 * Rango temporal + limit opcional. Compartido por top players y
 * top event types — mismo shape porque son dos rankings del mismo
 * tipo estructural, sólo cambia la dimensión agrupada.
 */
export const topRankingQuerySchema = {
  type: "object",
  required: ["from", "to"],
  additionalProperties: false,
  properties: {
    from: { type: "string", format: "date-time" },
    to: { type: "string", format: "date-time" },
    limit: { type: "string", pattern: "^[1-9]\\d*$" },
  },
} as const;

// -------------------------------------------------------------------
// I3 · Schemas de patrones
// -------------------------------------------------------------------

/** Compartido por /insight/patterns/activity, /growth y /streaks. */
export const patternsRangeQuerySchema = {
  type: "object",
  required: ["from", "to"],
  additionalProperties: false,
  properties: {
    from: { type: "string", format: "date-time" },
    to: { type: "string", format: "date-time" },
  },
} as const;

/**
 * /insight/patterns/players acepta dos umbrales opcionales:
 *   - minActiveDays: recurrencia mínima (default en router).
 *   - idleThresholdDays: días desde `to` para considerar idle.
 * Ambos como string entero positivo (patrón de `limit` en I2).
 */
export const patternsPlayersQuerySchema = {
  type: "object",
  required: ["from", "to"],
  additionalProperties: false,
  properties: {
    from: { type: "string", format: "date-time" },
    to: { type: "string", format: "date-time" },
    minActiveDays: { type: "string", pattern: "^[1-9]\\d*$" },
    idleThresholdDays: { type: "string", pattern: "^[1-9]\\d*$" },
  },
} as const;

// -------------------------------------------------------------------
// I5 · Schemas de insights
// -------------------------------------------------------------------

/**
 * /insight/insights y /insight/insights/:id comparten querystring
 * (rango temporal obligatorio). El param `id` se valida sólo por
 * formato mínimo; la existencia se resuelve en el handler
 * (unknown → 404, no 400 — 404 comunica mejor "resource not found").
 */
export const insightsQuerySchema = {
  type: "object",
  required: ["from", "to"],
  additionalProperties: false,
  properties: {
    from: { type: "string", format: "date-time" },
    to: { type: "string", format: "date-time" },
  },
} as const;

export const insightIdParamsSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
  },
} as const;
