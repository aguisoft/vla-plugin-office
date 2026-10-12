-- La campana de la oficina: lo que se le avisó a cada persona (una solicitud
-- nueva, la respuesta a la suya, un feriado movido). Antes los avisos solo
-- viajaban en vivo y, si la persona no estaba conectada en ese momento, se
-- perdían. Los mensajes del chat NO se guardan acá: tienen su propio contador.
CREATE TABLE IF NOT EXISTS office_avisos (
  id         bigserial PRIMARY KEY,
  user_id    text NOT NULL,
  tipo       text NOT NULL,
  titulo     text NOT NULL,
  cuerpo     text NOT NULL DEFAULT '',
  url        text,
  creado_en  timestamptz NOT NULL DEFAULT now(),
  leido_en   timestamptz
);

CREATE INDEX IF NOT EXISTS office_avisos_user_idx ON office_avisos (user_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS office_avisos_sin_leer_idx ON office_avisos (user_id) WHERE leido_en IS NULL;
