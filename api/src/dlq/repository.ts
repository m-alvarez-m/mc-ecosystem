// Repositorio de dead_letter_events (ADR-013).
//
// Todas las queries usan el pool mc_dlq. El repo NO valida input
// (eso es del schema JSON de la ruta); NO decide política (eso es
// del ADR); NO se preocupa por la UNIQUE de dedupe (ON CONFLICT
// DO NOTHING en el INSERT lo cubre a nivel SQL).

import type { Pool } from "pg";

export type DlqReason =
  | "max_retries"
  | "parse_error"
  | "circuit_open"
  | "replay_failed";

export interface DlqRow {
  id: string;
  event_id: string;
  event_uuid: string;
  event_type: string;
  event_payload: Record<string, unknown>;
  reason: DlqReason;
  error_type: string;
  error_message: string;
  attempts: number;
  first_failed_at: string;
  last_failed_at: string;
  replayed_at: string | null;
  created_at: string;
}

export interface DlqInsertInput {
  event_id: string;
  event_uuid: string;
  event_type: string;
  event_payload: Record<string, unknown>;
  reason: DlqReason;
  error_type: string;
  error_message: string;
  attempts: number;
  first_failed_at: string;
  last_failed_at: string;
}

// Superficie mínima del pool que se usa. Aceptar `Pick<Pool, "query">`
// deja pasar fakes en tests.
export type QueryablePool = Pick<Pool, "query">;

export async function insertDlqRow(
  pool: QueryablePool,
  input: DlqInsertInput,
): Promise<{ inserted: boolean; id: string | null }> {
  const res = await pool.query(
    `INSERT INTO dead_letter_events
       (event_id, event_uuid, event_type, event_payload, reason,
        error_type, error_message, attempts,
        first_failed_at, last_failed_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz)
     ON CONFLICT (event_uuid, reason) DO NOTHING
     RETURNING id::text AS id`,
    [
      input.event_id,
      input.event_uuid,
      input.event_type,
      JSON.stringify(input.event_payload),
      input.reason,
      input.error_type,
      input.error_message,
      input.attempts,
      input.first_failed_at,
      input.last_failed_at,
    ],
  );
  const rows = res.rows as Array<{ id: string }>;
  if (rows.length === 0) return { inserted: false, id: null };
  return { inserted: true, id: rows[0]!.id };
}

export async function countPending(pool: QueryablePool): Promise<number> {
  const res = await pool.query(
    `SELECT count(*)::int AS n FROM dead_letter_events WHERE replayed_at IS NULL`,
  );
  const rows = res.rows as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

export interface FindPendingOptions {
  id?: number;
  reason?: DlqReason;
  limit?: number;
}

export async function findPending(
  pool: QueryablePool,
  opts: FindPendingOptions = {},
): Promise<DlqRow[]> {
  const clauses: string[] = ["replayed_at IS NULL"];
  const params: unknown[] = [];
  if (opts.id !== undefined) {
    params.push(opts.id);
    clauses.push(`id = $${params.length}::bigint`);
  }
  if (opts.reason !== undefined) {
    params.push(opts.reason);
    clauses.push(`reason = $${params.length}`);
  }
  const limit = Math.min(opts.limit ?? 100, 1000);
  params.push(limit);
  const res = await pool.query(
    `SELECT id::text AS id, event_id, event_uuid, event_type, event_payload,
            reason, error_type, error_message, attempts,
            first_failed_at, last_failed_at, replayed_at, created_at
       FROM dead_letter_events
      WHERE ${clauses.join(" AND ")}
      ORDER BY first_failed_at ASC
      LIMIT $${params.length}::int`,
    params,
  );
  return res.rows as DlqRow[];
}

export async function markReplayed(
  pool: QueryablePool,
  id: string,
): Promise<void> {
  await pool.query(
    `UPDATE dead_letter_events
        SET replayed_at = now()
      WHERE id = $1::bigint`,
    [id],
  );
}

export async function markReplayFailed(
  pool: QueryablePool,
  id: string,
  errorMessage: string,
): Promise<void> {
  await pool.query(
    `UPDATE dead_letter_events
        SET reason = 'replay_failed',
            error_message = $2,
            last_failed_at = now(),
            attempts = attempts + 1
      WHERE id = $1::bigint`,
    [id, errorMessage],
  );
}
