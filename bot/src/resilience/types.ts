// Tipos compartidos del subsistema de resiliencia (ADR-013).

/**
 * Taxonomía de errores del D4. Se emite en cada línea JSON de log
 * fallida y se guarda en dead_letter_events.error_type.
 */
export type ErrorType =
  | "discord_5xx"
  | "discord_rate_limit"
  | "discord_missing_permissions"
  | "parse_error"
  | "circuit_open"
  | "unknown";

/**
 * Estado del circuit breaker (ADR-013 D2). Se emite en cada línea
 * JSON de log fallida.
 */
export type CircuitState = "closed" | "open" | "half_open";

/**
 * Razones por las que un evento acaba en dead_letter_events (ADR-013 D6).
 */
export type DlqReason = "max_retries" | "parse_error" | "circuit_open" | "replay_failed";
