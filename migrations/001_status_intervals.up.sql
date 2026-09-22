-- Plugin: office | Migration 001 — Historial de estados
-- Schema: plugin_office (aislado; el core fija el search_path, por eso no hay prefijo)
--
-- Existe porque PresenceStatus guarda UNA fila por persona y se sobreescribe en
-- cada cambio: el estado anterior se pierde. Sin esta tabla no hay forma de
-- responder "cuanto tiempo estuvo en Concentrado".

CREATE TABLE IF NOT EXISTS office_status_intervals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text        NOT NULL,
  status        text        NOT NULL,
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz,
  justification text,
  source        text        NOT NULL DEFAULT 'WEB'
);

CREATE INDEX IF NOT EXISTS office_status_intervals_user_time_idx
  ON office_status_intervals (user_id, started_at);

CREATE INDEX IF NOT EXISTS office_status_intervals_time_idx
  ON office_status_intervals (started_at);

-- La invariante que impide contar doble: como maximo UN intervalo abierto por
-- persona. La garantiza Postgres, no el cuidado del programador.
CREATE UNIQUE INDEX IF NOT EXISTS office_status_intervals_one_open_per_user
  ON office_status_intervals (user_id) WHERE ended_at IS NULL;

-- Siembra: sin esto nadie aparece hasta su siguiente transicion, y quien este
-- sentado en Concentrado hoy no se contabiliza por horas. El tiempo anterior no
-- se inventa (no existe), pero desde este minuto todos quedan contados.
INSERT INTO office_status_intervals (user_id, status, started_at, justification, source)
SELECT p."userId", p.status::text, now(), p.justification, 'SEED'
  FROM virtual_office."PresenceStatus" p
 WHERE NOT EXISTS (
   SELECT 1 FROM office_status_intervals i
    WHERE i.user_id = p."userId" AND i.ended_at IS NULL
 );
