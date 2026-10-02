-- Quién tiene la app de escritorio y con qué versión: la app avisa cada tanto
-- (POST /escritorio/latido). La oficina ofrece la descarga a quien no la tiene.
CREATE TABLE IF NOT EXISTS office_escritorio_uso (
  user_id     text        PRIMARY KEY,
  version     text        NOT NULL,
  primera_vez timestamptz NOT NULL DEFAULT now(),
  ultima_vez  timestamptz NOT NULL DEFAULT now()
);
