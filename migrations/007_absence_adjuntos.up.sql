-- Documentos de respaldo de las solicitudes con justificación (permiso, cita
-- médica, incapacidad): la boleta, la constancia médica.
--
-- El archivo NO va en la base ni dentro de la carpeta del plugin: vive en una
-- carpeta hermana del volumen, igual que los instaladores del escritorio,
-- porque reinstalar el plugin borra su carpeta entera. Acá queda solo el
-- apunte y el control de acceso lo aplica office al servirlo.
CREATE TABLE IF NOT EXISTS office_absence_adjuntos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  absence_id  text        NOT NULL,
  user_id     text        NOT NULL,   -- dueño de la ausencia: define quién puede verlo
  nombre      text        NOT NULL,   -- el que ve la persona
  archivo     text        NOT NULL,   -- nombre en disco, único
  tipo        text        NOT NULL,
  bytes       integer     NOT NULL,
  subido_por  text        NOT NULL,
  creado_en   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_absence_adjuntos_absence ON office_absence_adjuntos(absence_id);
CREATE INDEX IF NOT EXISTS idx_absence_adjuntos_user ON office_absence_adjuntos(user_id);
