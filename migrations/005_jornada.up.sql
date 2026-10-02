-- Jornada laboral (espejo del widget de Bitrix).
-- El informe diario se manda a Bitrix al cerrar (timeman.close REPORT) y se
-- guarda acá también, para armar los reportes semanal y mensual: Bitrix no
-- los expone por API.
CREATE TABLE IF NOT EXISTS office_reportes_diarios (
  user_id        text        NOT NULL,
  fecha          date        NOT NULL,
  inicio         timestamptz,
  fin            timestamptz,
  trabajado_seg  integer     NOT NULL DEFAULT 0,
  pausas_seg     integer     NOT NULL DEFAULT 0,
  reporte        text        NOT NULL,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, fecha)
);

-- Plan del día armado desde la oficina. El planificador de Bitrix no se puede
-- escribir por API (no hay task.planner.add), así que el plan es la unión de
-- los dos.
CREATE TABLE IF NOT EXISTS office_plan_dia (
  user_id   text        NOT NULL,
  fecha     date        NOT NULL,
  task_id   integer     NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, fecha, task_id)
);
