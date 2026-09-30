-- Plugin: office | Migration 003 — El feriado movido pasa por el jefe
-- Schema: plugin_office (aislado; el core fija el search_path, por eso no hay prefijo)
--
-- Hasta acá, mover un feriado a otra fecha del mismo mes era un HECHO: el
-- colaborador lo escribía y quedaba movido. La regla del negocio es otra —
-- puede pedirlo si tomarlo en la fecha real frena la producción, pero lo
-- aprueba su jefe directo—, así que deja de ser un hecho y pasa a ser una
-- SOLICITUD con estado.
--
-- Por qué la tabla vive en el esquema del plugin y no en `virtual_office`,
-- donde estaba `HolidayOverride`:
--
--   a. Es un rasgo de dominio, y el CLAUDE.md del repo dice que esos viven en
--      el plugin. El core solo hace auth, usuarios, hooks y registro.
--   b. `virtual_office` lo maneja Prisma, y el API de producción se COMPILA en
--      el servidor (`build: context: .`). Tocar el esquema del core obliga a
--      reconstruir la imagen entera; acá alcanza con el .vla.zip.
--   c. Se podía hacer sin costo: al momento de escribir esto había 0 filas en
--      `virtual_office."HolidayOverride"`. No hay nada que migrar, y esa tabla
--      queda vestigial.
--
-- Lo que se pierde al salir de `virtual_office` es la llave foránea contra
-- `Holiday`: un feriado borrado deja overrides huérfanos. No abre un agujero
-- nuevo — el huérfano YA estaba contemplado y probado del lado de la lectura
-- ("un override huérfano, sin su feriado en la lista, no concede nada"),
-- porque el país del colaborador podía cambiar y dejar overrides colgando de
-- feriados ajenos. Esa misma defensa cubre este caso.

CREATE TABLE IF NOT EXISTS office_holiday_overrides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text        NOT NULL,
  holiday_id    text        NOT NULL,
  new_date      date        NOT NULL,
  justification text        NOT NULL,
  status        text        NOT NULL DEFAULT 'PENDING',
  -- NULL en dos casos que NO son lo mismo, y por eso `decided_at` los separa:
  -- una solicitud todavía pendiente (decided_at NULL), y una aprobada sin
  -- jefe que la revisara (decided_at con fecha, decided_by NULL). La segunda
  -- tiene que poder leerse como lo que es: nadie la miró. Ponerle el propio
  -- user_id la disfrazaría de auto-aprobación deliberada.
  decided_by    text,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT office_holiday_overrides_status_chk
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),

  -- Una sola solicitud viva por persona y feriado. Volver a pedir el mismo
  -- feriado PISA la anterior y vuelve a PENDING: si a alguien le rechazaron
  -- el lunes, puede pedir el miércoles sin arrastrar el rechazo. El costo es
  -- que no queda historial de intentos, que no es lo que el negocio pide
  -- registrar — lo que pide es quién aprobó el movimiento que sí ocurrió.
  CONSTRAINT office_holiday_overrides_user_holiday_key UNIQUE (user_id, holiday_id)
);

-- La bandeja del jefe filtra por estado sobre los user_id de su gente: sin
-- este índice cada apertura recorre la tabla entera.
CREATE INDEX IF NOT EXISTS office_holiday_overrides_pendientes_idx
  ON office_holiday_overrides (status, user_id)
  WHERE status = 'PENDING';

-- `effectiveByUserId` corre en CADA GET /snapshot y solo le sirven los
-- aprobados; el índice parcial evita traer pendientes y rechazados.
CREATE INDEX IF NOT EXISTS office_holiday_overrides_aprobados_idx
  ON office_holiday_overrides (user_id, holiday_id)
  WHERE status = 'APPROVED';
