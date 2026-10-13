-- El saldo de vacaciones que carga RRHH (13-oct-2026). Cada carga es una fila:
-- los días que la persona tenía el día `corte`, sin contar las vacaciones ya
-- aprobadas en la oficina de ahí en adelante. Manda la última carga; las de
-- antes quedan como historial (quién, cuándo y por qué). El resto del saldo
-- (devengo de 1,25 por mes, lo tomado, lo apartado) se calcula, no se guarda.
CREATE TABLE IF NOT EXISTS office_vacaciones_saldo (
  id          bigserial PRIMARY KEY,
  user_id     text NOT NULL,
  inicial     numeric(6,2) NOT NULL,
  corte       date NOT NULL,
  motivo      text,
  cargado_por text NOT NULL,
  cargado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS office_vacaciones_saldo_user ON office_vacaciones_saldo (user_id, cargado_en DESC);
