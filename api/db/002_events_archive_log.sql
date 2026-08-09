-- 002_events_archive_log.sql — ADR-012 · Política de retención de events
--
-- Añade la tabla de auditoría del archivado + un rol separado (mc_pruner)
-- que puede SELECT y DELETE sobre events. mc_app conserva el REVOKE de
-- DELETE (append-only intencional del ADR-009); el prune corre bajo
-- otra identidad para no derribar esa garantía.
--
-- Esta migración NO modifica el schema de la tabla `events`.

BEGIN;

-- ============ events_archive_log (ADR-012 D2) ============
-- Bitácora inmortal de cada intento de archivado mensual: qué se subió a
-- B2, qué checksum se verificó, cuántas filas se purgaron. Responde en
-- un solo SELECT "¿qué meses viven fuera de la base caliente y dónde?".
CREATE TABLE events_archive_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period        TEXT        NOT NULL,           -- 'YYYY-MM'
  b2_object_key TEXT        NOT NULL,
  sha256_local  TEXT        NOT NULL,
  sha256_remote TEXT        NOT NULL,
  row_count     BIGINT      NOT NULL,
  size_bytes    BIGINT      NOT NULL,
  archived_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  purged_at     TIMESTAMPTZ,                    -- NULL = subido pero no purgado
  status        TEXT        NOT NULL,           -- 'ok' | 'checksum_mismatch' | 'upload_failed' | 'dry_run'
  CHECK (status IN ('ok', 'checksum_mismatch', 'upload_failed', 'dry_run'))
);

-- Un mes puede tener múltiples intentos (fallos + reintento + éxito);
-- la unicidad efectiva "un ok por periodo" se consulta con:
--   SELECT ... WHERE period = 'YYYY-MM' AND status = 'ok' LIMIT 1
-- Se indexa (period, status) para que ese SELECT sea O(log n) sin
-- imponer una unique dura que impediría dry-runs repetidos.
CREATE INDEX ix_archive_log_period_status ON events_archive_log(period, status);

-- ============ rol mc_pruner (ADR-012 D2 · least privilege) ============
-- Rol dedicado al prune. Puede leer y borrar filas de events, y
-- registrarlas en events_archive_log. NO puede escribir en events
-- (INSERT queda para mc_app únicamente) ni tocar players/player_names.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mc_pruner') THEN
    CREATE ROLE mc_pruner NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO mc_pruner;

-- events: SELECT (leer para archivar) + DELETE (purgar tras verificar
-- checksum en B2). Sin INSERT ni UPDATE — el prune no fabrica eventos.
GRANT SELECT, DELETE ON events TO mc_pruner;

-- events_archive_log: escritura total (INSERT/UPDATE del status y
-- purged_at) + lectura para saber qué meses ya se procesaron.
GRANT SELECT, INSERT, UPDATE ON events_archive_log TO mc_pruner;
GRANT USAGE, SELECT ON SEQUENCE events_archive_log_id_seq TO mc_pruner;

-- mc_app puede leer la bitácora (útil si algún endpoint futuro la
-- expone en /insight/*), pero NO escribirla.
GRANT SELECT ON events_archive_log TO mc_app;

COMMIT;
