import { describe, it, expect, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import {
  listEligiblePeriods,
  periodAlreadyArchived,
  pruneMonth,
  runPrune,
  serializeAndCompress,
} from "../src/prune/prune";
import { PERPETUAL_EVENT_TYPES } from "../src/prune/perpetual-types";
import type { B2Uploader } from "../src/prune/b2";

// Suite de retención (ADR-012). Filas sintéticas con received_at
// forzado a > 24 meses atrás; se verifica: dry-run no toca B2 ni
// borra, real path sube y purga sólo si el checksum coincide,
// checksum_mismatch aborta la purga, tipos perpetuos jamás salen.

// ============ Helpers de fake pool ============

// Fake pool en memoria. Interpreta 3 shapes de SQL que usa el módulo:
//   - listEligiblePeriods: MIN(received_at)
//   - periodAlreadyArchived: SELECT 1 FROM events_archive_log ...
//   - selectMonthRows / DELETE FROM events ...
//   - INSERT INTO events_archive_log ...
// No se pretende un motor SQL — sólo devolver lo mínimo para que el
// flujo del módulo se ejerza extremo a extremo.
interface FakeRow {
  id: string;
  type: string;
  received_at: string;
  data: Record<string, unknown>;
}

function makeFakePool(initialRows: FakeRow[]) {
  const rows = [...initialRows];
  const archiveLog: Array<Record<string, unknown>> = [];
  let inTx = false;
  let txDeletes: FakeRow[][] = [];
  let txLog: Array<Record<string, unknown>> = [];

  async function query(text: string, values: unknown[] = []) {
    if (/^BEGIN/i.test(text)) {
      inTx = true;
      txDeletes = [];
      txLog = [];
      return { rows: [] };
    }
    if (/^COMMIT/i.test(text)) {
      for (const del of txDeletes) {
        for (const r of del) {
          const idx = rows.indexOf(r);
          if (idx >= 0) rows.splice(idx, 1);
        }
      }
      for (const l of txLog) archiveLog.push(l);
      inTx = false;
      return { rows: [] };
    }
    if (/^ROLLBACK/i.test(text)) {
      inTx = false;
      txDeletes = [];
      txLog = [];
      return { rows: [] };
    }
    if (/MIN\(received_at\)/.test(text)) {
      const cutoff = new Date(String(values[0]));
      const perpetual = new Set(values.slice(1));
      const eligible = rows.filter(
        (r) => new Date(r.received_at) < cutoff && !perpetual.has(r.type)
      );
      if (eligible.length === 0) return { rows: [{ min_ts: null }] };
      const min = eligible.reduce((a, b) =>
        new Date(a.received_at) < new Date(b.received_at) ? a : b
      );
      return { rows: [{ min_ts: min.received_at }] };
    }
    if (/FROM events_archive_log/.test(text) && /status = 'ok'/.test(text)) {
      const period = String(values[0]);
      const hit = archiveLog.find((r) => r.period === period && r.status === "ok");
      return { rows: hit ? [{ "?column?": 1 }] : [] };
    }
    if (/SELECT id::text AS id/.test(text)) {
      const from = new Date(String(values[0]));
      const to = new Date(String(values[1]));
      const perpetual = new Set(values.slice(2));
      const out = rows.filter(
        (r) =>
          new Date(r.received_at) >= from &&
          new Date(r.received_at) < to &&
          !perpetual.has(r.type)
      );
      return { rows: out.map((r) => ({ ...r })) };
    }
    if (/^\s*DELETE FROM events/i.test(text)) {
      const from = new Date(String(values[0]));
      const to = new Date(String(values[1]));
      const perpetual = new Set(values.slice(2));
      const matched = rows.filter(
        (r) =>
          new Date(r.received_at) >= from &&
          new Date(r.received_at) < to &&
          !perpetual.has(r.type)
      );
      if (inTx) {
        txDeletes.push(matched);
      } else {
        for (const r of matched) {
          const idx = rows.indexOf(r);
          if (idx >= 0) rows.splice(idx, 1);
        }
      }
      return { rows: [], rowCount: matched.length } as unknown as { rows: unknown[] };
    }
    if (/INSERT INTO events_archive_log/.test(text)) {
      const record = {
        period: values[0],
        b2_object_key: values[1],
        sha256_local: values[2],
        sha256_remote: values[3],
        row_count: values[4],
        size_bytes: values[5],
        status: values[6],
        purged_at: values[7],
      };
      if (inTx) txLog.push(record);
      else archiveLog.push(record);
      return { rows: [] };
    }
    throw new Error(`fake pool: SQL no soportado: ${text.slice(0, 80)}`);
  }

  const pool = {
    query,
    connect: vi.fn().mockImplementation(async () => ({
      query,
      release: () => undefined,
    })),
  };
  return { pool, rows, archiveLog };
}

// Fake B2 uploader con almacenamiento en memoria. Opción `corrupt`
// devuelve bytes distintos en la descarga → provoca checksum_mismatch.
function makeFakeB2(opts: { corrupt?: boolean } = {}): B2Uploader & {
  uploads: Map<string, Buffer>;
} {
  const uploads = new Map<string, Buffer>();
  return {
    uploads,
    upload: vi
      .fn()
      .mockImplementation(async (fileName: string, data: Buffer) => {
        uploads.set(fileName, data);
        return { fileId: `fake-${fileName}`, fileName };
      }),
    download: vi.fn().mockImplementation(async (fileName: string) => {
      const buf = uploads.get(fileName);
      if (!buf) throw new Error(`fake B2: ${fileName} no encontrado`);
      return opts.corrupt ? Buffer.concat([buf, Buffer.from("X")]) : buf;
    }),
  };
}

function mkRow(id: string, type: string, receivedAt: string): FakeRow {
  return { id, type, received_at: receivedAt, data: { i: Number(id) } };
}

// Ancla temporal única para todos los tests: NOW = 2026-08-08 UTC.
// Cutoff = NOW - 24m = 2024-08-08. Todos los received_at < esa fecha
// entran al candidato. Períodos completos < 2026-08 califican.
const NOW = new Date("2026-08-08T00:00:00.000Z");

describe("ADR-012 · serialización JSONL + gzip + sha256", () => {
  it("gzip descomprimido devuelve una línea JSON por fila", async () => {
    const rows = [
      { id: "1", type: "chat.message", data: {} },
      { id: "2", type: "block.place", data: {} },
    ];
    const { payload, sha256 } = await serializeAndCompress(rows);
    const raw = gunzipSync(payload).toString("utf-8");
    expect(raw.split("\n").filter((l) => l.length > 0)).toHaveLength(2);
    // sha256 es determinístico contra el mismo gzip payload.
    expect(sha256).toBe(createHash("sha256").update(payload).digest("hex"));
  });
});

describe("ADR-012 · listEligiblePeriods", () => {
  it("devuelve meses completos entre la fila más antigua y el cutoff", async () => {
    const { pool } = makeFakePool([
      mkRow("1", "chat.message", "2024-05-15T00:00:00Z"), // < cutoff
      mkRow("2", "chat.message", "2024-11-15T00:00:00Z"), // < cutoff pero periodo completo termina antes de NOW
      mkRow("3", "chat.message", "2026-08-01T00:00:00Z"), // >= cutoff (dentro de la ventana)
    ]);
    const cutoff = new Date("2024-08-08T00:00:00Z");
    const periods = await listEligiblePeriods(pool, cutoff);
    // Fila más antigua = mayo 2024. Periodos completos < 2024-08:
    // sólo 2024-05, 2024-06, 2024-07 (2024-08 es el mes del cutoff,
    // aún parcial).
    expect(periods).toEqual(["2024-05", "2024-06", "2024-07"]);
  });

  it("tabla sin filas vencidas → array vacío", async () => {
    const { pool } = makeFakePool([mkRow("1", "chat.message", "2026-07-01T00:00:00Z")]);
    const periods = await listEligiblePeriods(pool, new Date("2024-08-08T00:00:00Z"));
    expect(periods).toEqual([]);
  });
});

describe("ADR-012 · pruneMonth · dry-run", () => {
  it("no llama B2, no borra filas, registra status='dry_run'", async () => {
    const { pool, rows, archiveLog } = makeFakePool([
      mkRow("1", "chat.message", "2024-05-10T00:00:00Z"),
      mkRow("2", "block.place", "2024-05-11T00:00:00Z"),
      mkRow("3", "player.death", "2024-05-12T00:00:00Z"), // perpetuo — no cuenta
    ]);
    const b2 = makeFakeB2();
    const result = await pruneMonth(pool, "2024-05", {
      dryRun: true,
      b2,
      b2Bucket: "test",
      b2ArchivePrefix: "archive/events",
      now: NOW,
    });

    expect(result.status).toBe("dry_run");
    expect(result.rowCount).toBe(2); // player.death excluido
    expect(b2.upload).not.toHaveBeenCalled();
    expect(b2.download).not.toHaveBeenCalled();
    expect(rows).toHaveLength(3); // nada purgado
    expect(archiveLog).toHaveLength(1);
    expect(archiveLog[0]!.status).toBe("dry_run");
    expect(archiveLog[0]!.purged_at).toBeNull();
  });
});

describe("ADR-012 · pruneMonth · real path", () => {
  it("upload OK + checksum coincide → DELETE + status='ok' con purged_at", async () => {
    const { pool, rows, archiveLog } = makeFakePool([
      mkRow("1", "chat.message", "2024-05-10T00:00:00Z"),
      mkRow("2", "block.place", "2024-05-11T00:00:00Z"),
      mkRow("3", "player.death", "2024-05-12T00:00:00Z"),
      mkRow("4", "chat.message", "2026-08-01T00:00:00Z"),
    ]);
    const b2 = makeFakeB2();
    const result = await pruneMonth(pool, "2024-05", {
      dryRun: false,
      b2,
      b2Bucket: "test",
      b2ArchivePrefix: "archive/events",
      now: NOW,
    });

    expect(result.status).toBe("ok");
    expect(result.rowCount).toBe(2);
    expect(b2.upload).toHaveBeenCalledOnce();
    expect(b2.download).toHaveBeenCalledOnce();
    expect(result.sha256Remote).toBe(result.sha256Local);
    // Filas vivas: player.death (perpetuo) + chat.message de 2026-08.
    expect(rows.map((r) => r.id).sort()).toEqual(["3", "4"]);
    expect(archiveLog).toHaveLength(1);
    expect(archiveLog[0]!.status).toBe("ok");
    expect(archiveLog[0]!.purged_at).not.toBeNull();
  });

  it("checksum remoto NO coincide → status='checksum_mismatch' y CERO purga", async () => {
    const { pool, rows, archiveLog } = makeFakePool([
      mkRow("1", "chat.message", "2024-05-10T00:00:00Z"),
      mkRow("2", "block.place", "2024-05-11T00:00:00Z"),
    ]);
    const b2 = makeFakeB2({ corrupt: true });
    const result = await pruneMonth(pool, "2024-05", {
      dryRun: false,
      b2,
      b2Bucket: "test",
      b2ArchivePrefix: "archive/events",
      now: NOW,
    });

    expect(result.status).toBe("checksum_mismatch");
    expect(rows).toHaveLength(2); // ninguna filas borrada
    expect(archiveLog[0]!.status).toBe("checksum_mismatch");
    expect(archiveLog[0]!.purged_at).toBeNull();
  });

  it("upload falla → status='upload_failed' y CERO purga", async () => {
    const { pool, rows, archiveLog } = makeFakePool([
      mkRow("1", "chat.message", "2024-05-10T00:00:00Z"),
    ]);
    const b2: B2Uploader = {
      upload: vi.fn().mockRejectedValue(new Error("B2 caído")),
      download: vi.fn(),
    };
    const result = await pruneMonth(pool, "2024-05", {
      dryRun: false,
      b2,
      b2Bucket: "test",
      b2ArchivePrefix: "archive/events",
      now: NOW,
    });

    expect(result.status).toBe("upload_failed");
    expect(rows).toHaveLength(1);
    expect(archiveLog[0]!.status).toBe("upload_failed");
    expect(archiveLog[0]!.purged_at).toBeNull();
  });

  it("período ya archivado (ok) → skipped, no re-sube ni re-borra", async () => {
    const { pool, archiveLog } = makeFakePool([
      mkRow("1", "chat.message", "2024-05-10T00:00:00Z"),
    ]);
    // Preseed el archivo log con un 'ok' previo.
    await pool.query(
      `INSERT INTO events_archive_log
         (period, b2_object_key, sha256_local, sha256_remote,
          row_count, size_bytes, status, purged_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ["2024-05", "k", "s", "s", 1, 1, "ok", new Date().toISOString()]
    );
    const b2 = makeFakeB2();
    const result = await pruneMonth(pool, "2024-05", {
      dryRun: false,
      b2,
      b2Bucket: "test",
      b2ArchivePrefix: "archive/events",
      now: NOW,
    });

    expect(result.status).toBe("skipped");
    expect(b2.upload).not.toHaveBeenCalled();
    // El log no gana una nueva fila.
    expect(archiveLog).toHaveLength(1);
  });

  it("mes sin filas candidatas → status='no_rows', no toca B2 ni log", async () => {
    const { pool, archiveLog } = makeFakePool([
      mkRow("1", "player.death", "2024-05-10T00:00:00Z"), // perpetuo
    ]);
    const b2 = makeFakeB2();
    const result = await pruneMonth(pool, "2024-05", {
      dryRun: false,
      b2,
      b2Bucket: "test",
      b2ArchivePrefix: "archive/events",
      now: NOW,
    });
    expect(result.status).toBe("no_rows");
    expect(b2.upload).not.toHaveBeenCalled();
    expect(archiveLog).toHaveLength(0);
  });
});

describe("ADR-012 · tipos perpetuos", () => {
  it("PERPETUAL_EVENT_TYPES incluye los 8 del ADR-012 D4", () => {
    expect(new Set(PERPETUAL_EVENT_TYPES)).toEqual(
      new Set([
        "player.first_join",
        "player.death",
        "player.kill",
        "boss.kill",
        "milestone.first",
        "achievement.unlock",
        "server.start",
        "server.stop",
      ])
    );
  });
});

describe("ADR-012 · runPrune end-to-end", () => {
  it("dry-run sobre múltiples meses vencidos: registra dry_run por cada uno", async () => {
    const { pool, rows, archiveLog } = makeFakePool([
      mkRow("1", "chat.message", "2024-05-10T00:00:00Z"),
      mkRow("2", "block.place", "2024-06-15T00:00:00Z"),
      mkRow("3", "chat.message", "2024-07-20T00:00:00Z"),
      mkRow("4", "player.death", "2024-05-10T00:00:00Z"),
    ]);
    const b2 = makeFakeB2();
    const results = await runPrune(pool, {
      now: NOW,
      dryRun: true,
      b2,
      b2Bucket: "test",
      b2ArchivePrefix: "archive/events",
    });

    expect(results.map((r) => r.status)).toEqual(["dry_run", "dry_run", "dry_run"]);
    expect(results.map((r) => r.period)).toEqual(["2024-05", "2024-06", "2024-07"]);
    expect(b2.upload).not.toHaveBeenCalled();
    // Ninguna fila purgada; el perpetuo player.death sigue vivo también.
    expect(rows).toHaveLength(4);
    expect(archiveLog).toHaveLength(3);
    expect(archiveLog.every((r) => r.status === "dry_run")).toBe(true);
  });
});

describe("ADR-012 · periodAlreadyArchived", () => {
  it("devuelve true sólo cuando existe una fila status='ok' para el periodo", async () => {
    const { pool } = makeFakePool([]);
    await pool.query(
      `INSERT INTO events_archive_log
         (period, b2_object_key, sha256_local, sha256_remote,
          row_count, size_bytes, status, purged_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ["2024-05", "k", "s", "s", 1, 1, "dry_run", null]
    );
    // dry_run NO cuenta como archivado.
    expect(await periodAlreadyArchived(pool, "2024-05")).toBe(false);

    await pool.query(
      `INSERT INTO events_archive_log
         (period, b2_object_key, sha256_local, sha256_remote,
          row_count, size_bytes, status, purged_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ["2024-05", "k", "s", "s", 1, 1, "ok", new Date().toISOString()]
    );
    expect(await periodAlreadyArchived(pool, "2024-05")).toBe(true);
    expect(await periodAlreadyArchived(pool, "2024-06")).toBe(false);
  });
});
