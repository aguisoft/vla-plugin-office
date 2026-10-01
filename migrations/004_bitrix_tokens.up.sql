-- Tokens de Bitrix de cada persona, para que la mensajería del widget hable
-- como ella y no como el token global de la app (que es de Carlos).
-- El core no los guarda: los entrega por el hook core.bitrix.user_authorized.
CREATE TABLE IF NOT EXISTS office_bitrix_tokens (
  user_id        text PRIMARY KEY,
  bitrix_user_id text,
  access_token   text        NOT NULL,
  refresh_token  text        NOT NULL,
  expires_at     timestamptz NOT NULL,
  conectado_at   timestamptz NOT NULL DEFAULT now()
);
