// Clasificador de errores (ADR-013 D4 · campo error_type).
//
// Convierte un `unknown` (típicamente lanzado por el handler o por el
// SDK de Discord) en uno de los ErrorType canónicos. La clasificación
// aparece en dos sitios: en la línea de log del D4 y en la fila de
// dead_letter_events. Centralizar aquí evita divergencias.

import type { ErrorType } from "./types.js";

interface DiscordAPIErrorLike {
  code?: number | string;
  status?: number;
  httpStatus?: number;
  message?: string;
}

/**
 * Clasifica un error arbitrario. Reglas:
 *   - 50013 (Discord "Missing Permissions") → discord_missing_permissions
 *   - HTTP 429 → discord_rate_limit
 *   - HTTP 5xx → discord_5xx
 *   - Error de parseo/JSON → parse_error
 *   - resto → unknown
 *
 * Recorre `err.cause` recursivamente (max 5 niveles) para atrapar
 * excepciones envueltas por PublishError → HandlerExecutionError →
 * ConsumerError, sin depender de las clases concretas.
 */
export function classifyError(err: unknown): ErrorType {
  const chain = unwrap(err, 5);

  for (const e of chain) {
    // Discord SDK: código numérico interno + HTTP status.
    const discordCode = (e as DiscordAPIErrorLike).code;
    if (discordCode === 50013 || discordCode === "50013") {
      return "discord_missing_permissions";
    }
    const status =
      (e as DiscordAPIErrorLike).status ??
      (e as DiscordAPIErrorLike).httpStatus;
    if (typeof status === "number") {
      if (status === 429) return "discord_rate_limit";
      if (status >= 500 && status <= 599) return "discord_5xx";
    }

    if (e instanceof SyntaxError) return "parse_error";

    // Heurística leve por nombre — cubre errores custom cuyos códigos
    // no seguimos aún pero cuyo mensaje contiene señal clara.
    if (e instanceof Error) {
      const name = (e.constructor?.name ?? e.name ?? "").toLowerCase();
      if (name.includes("parse")) return "parse_error";
    }
  }

  return "unknown";
}

function unwrap(err: unknown, maxDepth: number): unknown[] {
  const out: unknown[] = [];
  let cur: unknown = err;
  let d = 0;
  while (cur != null && d < maxDepth) {
    out.push(cur);
    cur = (cur as { cause?: unknown }).cause;
    d++;
  }
  return out;
}

/**
 * Mensaje humano truncado (max 500 chars) para logging + DLQ.
 * Traversa la cadena `.cause` y concatena mensajes distintos con "→".
 */
export function summarizeErrorMessage(err: unknown, maxLen = 500): string {
  const messages: string[] = [];
  let cur: unknown = err;
  const seen = new Set<unknown>();
  let d = 0;
  while (cur != null && d < 5 && !seen.has(cur)) {
    seen.add(cur);
    const m =
      cur instanceof Error
        ? cur.message
        : typeof cur === "string"
          ? cur
          : String(cur);
    if (m.length > 0 && !messages.includes(m)) messages.push(m);
    cur = (cur as { cause?: unknown }).cause;
    d++;
  }
  const joined = messages.join(" → ");
  return joined.length > maxLen ? joined.slice(0, maxLen - 1) + "…" : joined;
}
