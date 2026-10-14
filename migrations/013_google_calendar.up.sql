-- Google Calendar de cada persona (14-oct-2026). Cada uno conecta su cuenta
-- (@grupovla.com o @vlacademy.com) y la oficina: pone sus ausencias y feriados
-- como «Fuera de la oficina», la pone «En reunión» cuando tiene una reunión en
-- Google, mira si está ocupada al invitarla, y crea en Google (con Meet) las
-- reuniones que se arman en la oficina.
CREATE TABLE IF NOT EXISTS office_google_tokens (
  user_id       text PRIMARY KEY,
  email         text NOT NULL,
  refresh_token text NOT NULL,
  access_token  text,
  expires_at    timestamptz,
  scope         text,
  conectado_en  timestamptz NOT NULL DEFAULT now()
);

-- Los eventos que creó la oficina en Google, para borrarlos o cerrarlos.
-- clave: 'ausencia:<id>' | 'feriado:<YYYY-MM-DD>' | 'reunion:<meetingId>'.
-- cerrada: la reunión ya se cerró en Google con la hora real.
CREATE TABLE IF NOT EXISTS office_google_eventos (
  user_id   text NOT NULL,
  clave     text NOT NULL,
  event_id  text NOT NULL,
  firma     text NOT NULL,
  inicio    timestamptz NOT NULL,
  fin       timestamptz NOT NULL,
  enlace    text,
  cerrada   boolean NOT NULL DEFAULT false,
  creado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, clave)
);

-- Quién está «En reunión» porque lo puso una reunión de Google: al terminar se
-- devuelve a Disponible solo si el estado sigue siendo ese. soltado: la persona
-- lo cambió a mano con la reunión corriendo; no se le vuelve a poner esa.
CREATE TABLE IF NOT EXISTS office_google_estado (
  user_id   text PRIMARY KEY,
  event_id  text NOT NULL,
  status    text NOT NULL,
  titulo    text NOT NULL,
  soltado   boolean NOT NULL DEFAULT false,
  puesto_en timestamptz NOT NULL DEFAULT now()
);
