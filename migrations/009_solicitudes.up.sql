-- Plugin office | 009 — Solicitudes de ausencia con aprobación del jefe.
-- Ver docs/superpowers/specs/2026-10-07-solicitudes-ausencias-design.md.
-- AbsenceRecord es del core (Prisma): el ciclo vive acá. Nada se borra:
-- cancelar o rechazar cambia el estado y queda el evento.
CREATE TABLE IF NOT EXISTS office_solicitudes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL,
  tipo              text NOT NULL,              -- PERMISO | CITA_MEDICA | VACACIONES | INCAPACIDAD
  start_at          timestamptz NOT NULL,
  end_at            timestamptz NOT NULL,
  justificacion     text,
  estado            text NOT NULL DEFAULT 'pendiente', -- pendiente | aprobada | rechazada | cancelada
  absence_id        text,                       -- la AbsenceRecord que la hace valer (si vale)
  resuelta_por      text,
  resuelta_en       timestamptz,
  motivo_resolucion text,
  creada_por        text NOT NULL,
  creada_en         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS office_solicitudes_user ON office_solicitudes (user_id);
CREATE INDEX IF NOT EXISTS office_solicitudes_pendientes ON office_solicitudes (estado) WHERE estado = 'pendiente';
CREATE UNIQUE INDEX IF NOT EXISTS office_solicitudes_absence ON office_solicitudes (absence_id) WHERE absence_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS office_solicitud_eventos (
  id           bigserial PRIMARY KEY,
  solicitud_id uuid NOT NULL,
  accion       text NOT NULL,                  -- creada | aprobada | rechazada | cancelada | migrada
  user_id      text NOT NULL,
  detalle      jsonb,
  creado_en    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS office_solicitud_eventos_sol ON office_solicitud_eventos (solicitud_id);

-- Las ausencias que ya existían pasan como aprobadas (se registraron antes del ciclo).
WITH nuevas AS (
  INSERT INTO office_solicitudes (user_id, tipo, start_at, end_at, justificacion, estado, absence_id,
                                  resuelta_en, motivo_resolucion, creada_por, creada_en)
  SELECT a."userId", a.type::text, a."startAt", a."endAt", a.justification, 'aprobada', a.id,
         now(), 'Registrada antes de las aprobaciones', coalesce(a."createdBy", a."userId"), a."createdAt"
    FROM virtual_office."AbsenceRecord" a
   WHERE NOT EXISTS (SELECT 1 FROM office_solicitudes s WHERE s.absence_id = a.id)
  RETURNING id, user_id
)
INSERT INTO office_solicitud_eventos (solicitud_id, accion, user_id, detalle)
SELECT id, 'migrada', user_id, '{"motivo": "ausencia anterior al ciclo de aprobación"}'::jsonb FROM nuevas;
