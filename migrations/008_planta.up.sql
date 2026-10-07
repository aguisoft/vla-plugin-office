-- La planta de la oficina. Solo se guardan los riegos: el estado (feliz, con
-- sed, marchita, seca) se deriva del último, así no hace falta un proceso que
-- la vaya marchitando ni hay nada que se desincronice si el servidor se cae.
CREATE TABLE IF NOT EXISTS office_planta_riegos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text        NOT NULL,
  regado_en   timestamptz NOT NULL DEFAULT now(),
  fue_rescate boolean     NOT NULL DEFAULT false
);

-- El último riego se consulta en cada carga de la oficina.
CREATE INDEX IF NOT EXISTS idx_planta_riegos_fecha ON office_planta_riegos(regado_en DESC);
CREATE INDEX IF NOT EXISTS idx_planta_riegos_user ON office_planta_riegos(user_id);
