-- Quién trabaja los sábados y cuánto (medio día o completo). Sin fila = no
-- trabaja el sábado, que es lo de casi todos. Lo usan las vacaciones: para
-- quien trabaja medio día el sábado, ese día cuenta como ½ y puede ser el día
-- en que se reintegra.
CREATE TABLE IF NOT EXISTS office_sabados (
  user_id     text PRIMARY KEY,
  fraccion    numeric(2,1) NOT NULL CHECK (fraccion IN (0.5, 1)),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);
