-- 001_init.sql — Esquema inicial v1
-- Fuente de verdad: docs/event-catalog.md
-- events es append-only: el rol de aplicación (mc_app) solo puede SELECT e INSERT.

BEGIN;

-- ============ events (v1) ============
CREATE TABLE events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_uuid   UUID        NOT NULL,            -- generado por el plugin (idempotencia)
  type         TEXT        NOT NULL,
  v            SMALLINT    NOT NULL DEFAULT 1,  -- versión del esquema del tipo de evento
  ts           TIMESTAMPTZ NOT NULL,            -- cuándo ocurrió (lo pone el plugin)
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(), -- cuándo llegó a la DB
  player_uuid  UUID,                            -- NULL en eventos de servidor
  world        TEXT,
  x INT, y INT, z INT,
  data         JSONB       NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX ux_events_uuid   ON events(event_uuid);
CREATE INDEX ix_events_type_ts       ON events(type, ts);
CREATE INDEX ix_events_player_ts     ON events(player_uuid, ts);

-- ============ tablas satélite (v1) ============
CREATE TABLE players (
  uuid        UUID PRIMARY KEY,
  name        TEXT NOT NULL,          -- nombre actual
  first_seen  TIMESTAMPTZ NOT NULL,
  last_seen   TIMESTAMPTZ NOT NULL
);

CREATE TABLE player_names (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_uuid UUID NOT NULL REFERENCES players(uuid),
  name        TEXT NOT NULL,
  seen_at     TIMESTAMPTZ NOT NULL
);

-- ============ rol de aplicación: append-only sobre events ============
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mc_app') THEN
    CREATE ROLE mc_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO mc_app;

-- events: solo lectura e inserción. Jamás UPDATE/DELETE (catálogo, regla append-only).
GRANT SELECT, INSERT ON events TO mc_app;
REVOKE UPDATE, DELETE, TRUNCATE ON events FROM mc_app;

-- players sí se actualiza (name, last_seen); player_names es histórico, solo se añade.
GRANT SELECT, INSERT, UPDATE ON players TO mc_app;
GRANT SELECT, INSERT ON player_names TO mc_app;

-- Las columnas IDENTITY usan secuencias internas; INSERT las necesita.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mc_app;

COMMIT;
