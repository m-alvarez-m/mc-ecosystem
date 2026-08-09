// Orquestación del archivado + purga (ADR-012).
//
// Flujo por mes vencido:
//   1. SELECT filas del mes candidato (created_at < NOW - 24m
//      && type NOT IN PERPETUAL_EVENT_TYPES).
//   2. Serialización a JSONL + gzip → sha256 local.
//   3. Si DRY_RUN: log + registrar en events_archive_log status='dry_run'
//      y salir. No hay upload ni DELETE.
//   4. Upload a B2. Descargar el objeto y recalcular sha256 remoto.
//   5. Sólo si coinciden: DELETE + INSERT log status='ok' en la MISMA
//      transacción. Cualquier fallo previo → status='upload_failed' o
//      'checksum_mismatch', DELETE no se ejecuta.
//
// La ruta DELETE + log corre en una transacción única para que la tabla
// de auditoría y la purga no puedan divergir.

import type { PoolClient } from "pg";
import { PERPETUAL_EVENT_TYPES } from "./perpetual-types.js";
import type { B2Uploader } from "./b2.js";

// Superficie mínima del pool que el módulo consume. Aceptar
// `Pick<..., "query" | "connect">` deja pasar cualquier fake de test
// que implemente sólo lo que se usa (mismo patrón que routes/events.ts).
export interface PrunePool {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
  connect: () => Promise<PruneClient>;
}
export interface PruneClient {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
  release: () => void;
}

export interface PruneRunOptions {
  now?: Date;
  /** Meses hacia atrás — default 24 (ADR-012 D1). */
  retentionMonths?: number;
  /** Fuerza un `YYYY-MM` concreto en vez de recorrer todos los vencidos. */
  period?: string;
  dryRun: boolean;
  b2: B2Uploader | null;
  b2Bucket: string;
  b2ArchivePrefix: string;
}

export interface PruneMonthResult {
  period: string;
  status: "ok" | "dry_run" | "no_rows" | "checksum_mismatch" | "upload_failed" | "skipped";
  rowCount: number;
  sizeBytes: number;
  sha256Local: string;
  sha256Remote?: string;
  b2ObjectKey: string;
  error?: string;
}

// Genera 'YYYY-MM' para un Date en UTC. Evita depender de librerías de
// formato: sólo dos campos, formato fijo, cero ambigüedad de locale.
function periodOf(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// Primer día del mes indicado (00:00 UTC). Se usa como límite inferior
// del rango del SELECT.
function firstOfMonthUTC(period: string): Date {
  const [y, m] = period.split("-").map((s) => Number.parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, 1));
}

// Primer día del MES SIGUIENTE al indicado (00:00 UTC). Usar el mes
// siguiente como límite superior estricto (`<`) simplifica la aritmética
// respecto a "último día del mes 23:59:59.999".
function firstOfNextMonthUTC(period: string): Date {
  const [y, m] = period.split("-").map((s) => Number.parseInt(s, 10));
  return new Date(Date.UTC(y, m, 1));
}

// Meses candidatos entre el primer evento vencido y el corte de retención,
// en orden cronológico (los más antiguos primero — si un mes falla, los
// que le siguen deben esperar al próximo ciclo para respetar el orden).
export async function listEligiblePeriods(
  pool: Pick<PrunePool, "query">,
  cutoff: Date
): Promise<string[]> {
  // MIN(received_at) sobre las filas vencidas. Si la tabla no tiene
  // nada vencido, el resultado es null → 0 meses.
  const res = await pool.query(
    `SELECT MIN(received_at) AS min_ts
       FROM events
      WHERE received_at < $1::timestamptz
        AND type NOT IN (${PERPETUAL_EVENT_TYPES.map((_, i) => `$${i + 2}`).join(", ")})`,
    [cutoff.toISOString(), ...PERPETUAL_EVENT_TYPES]
  );
  const rows = res.rows as Array<{ min_ts: Date | string | null }>;
  const minRaw = rows[0]?.min_ts;
  if (minRaw == null) return [];
  const min = new Date(minRaw);

  const periods: string[] = [];
  // Recorre mes a mes desde el primero vencido hasta el mes anterior al
  // cutoff (exclusive): un mes sólo entra si ya está COMPLETO por debajo
  // del cutoff — nunca se archiva un mes parcial.
  const cutoffPeriod = periodOf(cutoff);
  let cursor = new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), 1));
  while (periodOf(cursor) < cutoffPeriod) {
    periods.push(periodOf(cursor));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return periods;
}

// Comprueba si un periodo ya tiene un archivado real exitoso. Los
// dry-runs NO cuentan como archivado — un mismo periodo se re-ejercita
// mes a mes mientras dry-run esté ON.
export async function periodAlreadyArchived(
  pool: Pick<PrunePool, "query">,
  period: string
): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM events_archive_log
      WHERE period = $1 AND status = 'ok'
      LIMIT 1`,
    [period]
  );
  return res.rows.length > 0;
}

// Extrae las filas candidatas de un mes concreto. Devuelve un array de
// registros ya listos para serializar (todas las columnas de `events`
// menos las de metadatos internos de pg).
export async function selectMonthRows(
  pool: Pick<PrunePool, "query">,
  period: string
): Promise<Record<string, unknown>[]> {
  const from = firstOfMonthUTC(period);
  const to = firstOfNextMonthUTC(period);
  const res = await pool.query(
    `SELECT id::text AS id, event_uuid, type, v,
            ts, received_at, player_uuid, world, x, y, z, data
       FROM events
      WHERE received_at >= $1::timestamptz
        AND received_at <  $2::timestamptz
        AND type NOT IN (${PERPETUAL_EVENT_TYPES.map((_, i) => `$${i + 3}`).join(", ")})
      ORDER BY id ASC`,
    [from.toISOString(), to.toISOString(), ...PERPETUAL_EVENT_TYPES]
  );
  return res.rows as Record<string, unknown>[];
}

// Serializa el batch a JSONL + gzip. Se hace en memoria: los volúmenes
// esperados (~10⁵ filas/mes) generan MB, no GB.
export async function serializeAndCompress(
  rows: Record<string, unknown>[]
): Promise<{ payload: Buffer; sha256: string }> {
  const { createHash } = await import("node:crypto");
  const { gzipSync } = await import("node:zlib");
  const jsonl = rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length > 0 ? "\n" : "");
  const gz = gzipSync(Buffer.from(jsonl, "utf-8"));
  const sha256 = createHash("sha256").update(gz).digest("hex");
  return { payload: gz, sha256 };
}

// Delegación reutilizable para calcular sha256 hex.
async function sha256Hex(data: Buffer): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(data).digest("hex");
}

// Registra un intento en events_archive_log. Se llama tanto para
// dry_run como para status finales (ok/checksum_mismatch/upload_failed).
async function logAttempt(
  q: Pick<PrunePool, "query">,
  data: {
    period: string;
    b2ObjectKey: string;
    sha256Local: string;
    sha256Remote: string;
    rowCount: number;
    sizeBytes: number;
    status: "ok" | "dry_run" | "checksum_mismatch" | "upload_failed";
    purged: boolean;
  }
): Promise<void> {
  await q.query(
    `INSERT INTO events_archive_log
       (period, b2_object_key, sha256_local, sha256_remote,
        row_count, size_bytes, status, purged_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      data.period,
      data.b2ObjectKey,
      data.sha256Local,
      data.sha256Remote,
      data.rowCount,
      data.sizeBytes,
      data.status,
      data.purged ? new Date().toISOString() : null,
    ]
  );
}

// Procesa un único mes.
export async function pruneMonth(
  pool: PrunePool,
  period: string,
  opts: PruneRunOptions
): Promise<PruneMonthResult> {
  const b2ObjectKey = `${opts.b2ArchivePrefix}/events-${period}.jsonl.gz`;

  if (await periodAlreadyArchived(pool, period)) {
    return {
      period,
      status: "skipped",
      rowCount: 0,
      sizeBytes: 0,
      sha256Local: "",
      b2ObjectKey,
    };
  }

  const rows = await selectMonthRows(pool, period);
  const { payload, sha256 } = await serializeAndCompress(rows);

  if (rows.length === 0) {
    // Nada que archivar este mes — no se registra bitácora ni se
    // sube nada. Devuelve resultado informativo.
    return {
      period,
      status: "no_rows",
      rowCount: 0,
      sizeBytes: 0,
      sha256Local: sha256,
      b2ObjectKey,
    };
  }

  if (opts.dryRun) {
    await logAttempt(pool, {
      period,
      b2ObjectKey,
      sha256Local: sha256,
      sha256Remote: "", // no se descarga nada en dry-run
      rowCount: rows.length,
      sizeBytes: payload.byteLength,
      status: "dry_run",
      purged: false,
    });
    return {
      period,
      status: "dry_run",
      rowCount: rows.length,
      sizeBytes: payload.byteLength,
      sha256Local: sha256,
      b2ObjectKey,
    };
  }

  if (opts.b2 === null) {
    throw new Error("B2 client no configurado: falta B2_ACCOUNT_ID/B2_ACCOUNT_KEY/B2_BUCKET");
  }

  // Upload. Un fallo aquí NO borra nada de events.
  try {
    await opts.b2.upload(b2ObjectKey, payload, "application/gzip");
  } catch (err) {
    await logAttempt(pool, {
      period,
      b2ObjectKey,
      sha256Local: sha256,
      sha256Remote: "",
      rowCount: rows.length,
      sizeBytes: payload.byteLength,
      status: "upload_failed",
      purged: false,
    });
    return {
      period,
      status: "upload_failed",
      rowCount: rows.length,
      sizeBytes: payload.byteLength,
      sha256Local: sha256,
      b2ObjectKey,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Verificación de integridad: descargar y recalcular sha256.
  const remoteBuf = await opts.b2.download(b2ObjectKey);
  const sha256Remote = await sha256Hex(remoteBuf);
  if (sha256Remote !== sha256) {
    await logAttempt(pool, {
      period,
      b2ObjectKey,
      sha256Local: sha256,
      sha256Remote,
      rowCount: rows.length,
      sizeBytes: payload.byteLength,
      status: "checksum_mismatch",
      purged: false,
    });
    return {
      period,
      status: "checksum_mismatch",
      rowCount: rows.length,
      sizeBytes: payload.byteLength,
      sha256Local: sha256,
      sha256Remote,
      b2ObjectKey,
    };
  }

  // Checksum OK: purge + log en la misma transacción.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const del = await client.query(
      `DELETE FROM events
        WHERE received_at >= $1::timestamptz
          AND received_at <  $2::timestamptz
          AND type NOT IN (${PERPETUAL_EVENT_TYPES.map((_, i) => `$${i + 3}`).join(", ")})`,
      [
        firstOfMonthUTC(period).toISOString(),
        firstOfNextMonthUTC(period).toISOString(),
        ...PERPETUAL_EVENT_TYPES,
      ]
    );
    await logAttempt(client, {
      period,
      b2ObjectKey,
      sha256Local: sha256,
      sha256Remote,
      rowCount: rows.length,
      sizeBytes: payload.byteLength,
      status: "ok",
      purged: true,
    });
    await client.query("COMMIT");
    return {
      period,
      status: "ok",
      rowCount: (del as unknown as { rowCount: number }).rowCount ?? rows.length,
      sizeBytes: payload.byteLength,
      sha256Local: sha256,
      sha256Remote,
      b2ObjectKey,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// Punto de entrada de alto nivel: recorre todos los meses vencidos (o
// procesa `opts.period` si viene fijado) y devuelve un resultado por
// mes. Un fallo en un mes no aborta el resto — cada mes es atómico.
export async function runPrune(
  pool: PrunePool,
  opts: PruneRunOptions
): Promise<PruneMonthResult[]> {
  const now = opts.now ?? new Date();
  const retentionMonths = opts.retentionMonths ?? 24;
  const cutoff = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - retentionMonths,
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds()
    )
  );

  const periods = opts.period ? [opts.period] : await listEligiblePeriods(pool, cutoff);
  const results: PruneMonthResult[] = [];
  for (const p of periods) {
    try {
      results.push(await pruneMonth(pool, p, opts));
    } catch (err) {
      results.push({
        period: p,
        status: "upload_failed",
        rowCount: 0,
        sizeBytes: 0,
        sha256Local: "",
        b2ObjectKey: `${opts.b2ArchivePrefix}/events-${p}.jsonl.gz`,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
