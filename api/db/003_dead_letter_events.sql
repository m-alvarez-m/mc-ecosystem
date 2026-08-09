-- 003_dead_letter_events.sql — ADR-013 · Resiliencia del bot (DLQ)
--
-- Tabla auditable de eventos que fallaron el envío al downstream tras
-- agotar reintentos, o que llegaron durante circuit_open, o que no
-- pudieron parsearse. Preserva contexto suficiente para reproducirlos
-- manualmente vía POST /admin/dlq/replay cuando la causa raíz se cure.
--
-- Rol mc_dlq: least privilege para el path de escritura/replay
-- (mismo patrón que mc_pruner del ADR-012). mc_app conserva SELECT-only
-- para exposición futura por endpoints de sólo lectura.
--
-- Esta migración NO modifica la tabla `events`.

BEGIN;

-- ============ dead_letter_events (ADR-013 D5) ============
--
-- event_payload es un SNAPSHOT COMPLETO del evento (no una FK a events)
-- para proteger contra la purga programada del ADR-012: si un evento
-- va a DLQ hoy y su fila original se archiva/purga en 24 meses, el
-- replay posterior sigue funcionando sólo con lo que hay aquí.
CREATE TABLE dead_letter_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        TEXT        NOT NULL,           -- id::text del evento original
  event_uuid      UUID        NOT NULL,           -- correlation_id
  event_type      TEXT        NOT NULL,
  event_payload   JSONB       NOT NULL,           -- snapshot completo (ver arriba)
  reason          TEXT        NOT NULL,           -- ver CHECK más abajo
  error_type      TEXT        NOT NULL,           -- taxonomía del ADR-013 D4
  error_message   TEXT        NOT NULL,
  attempts        INT         NOT NULL,
  first_failed_at TIMESTAMPTZ NOT NULL,
  last_failed_at  TIMESTAMPTZ NOT NULL,
  replayed_at     TIMESTAMPTZ,                    -- NULL = pendiente
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reason IN ('max_retries', 'parse_error', 'circuit_open', 'replay_failed'))
);

-- Dedupe natural de re-entregas (ADR-013 · sección "Atomicidad
-- cursor + DLQ", opción b con UNIQUE). Un mismo (event_uuid, reason)
-- que llegue dos veces por crash entre "INSERT DLQ" y "cursor.save"
-- se neutraliza con ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX ux_dlq_event_reason ON dead_letter_events(event_uuid, reason);

-- Consulta operativa: "¿qué falta por resolver?" — parcial para que
-- el índice sea pequeño y siempre esté cache-caliente.
CREATE INDEX ix_dlq_pending ON dead_letter_events(created_at) WHERE replayed_at IS NULL;

-- ============ rol mc_dlq (ADR-013 D5 · least privilege) ============
-- SELECT + INSERT + UPDATE (para replayed_at, attempts, last_failed_at,
-- reason). NO DELETE — retención infinita del ADR-013 D7.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mc_dlq') THEN
    CREATE ROLE mc_dlq NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO mc_dlq;

GRANT SELECT, INSERT, UPDATE ON dead_letter_events TO mc_dlq;
GRANT USAGE, SELECT ON SEQUENCE dead_letter_events_id_seq TO mc_dlq;

-- mc_app: sólo lectura (por si algún endpoint futuro de /insight/* la
-- expone). Sin INSERT/UPDATE/DELETE — mc_dlq es el único write-path.
GRANT SELECT ON dead_letter_events TO mc_app;

COMMIT;
