/**
 * Reglas del chat ampliado del widget (responder, reaccionar, borrar, archivos).
 * Lo que se pide a Bitrix está probado contra el portal el 1-oct-2026:
 *
 *  - Responder enlazado: `im.v2.Chat.Message.send` con `replyId`. El
 *    `REPLY_ID` de `im.message.add` se IGNORA (el mensaje sale suelto).
 *  - Reacciones: `im.v2.Chat.Message.Reaction.add/delete`; se leen en
 *    `im.v2.Chat.Message.list`, que además trae archivos y respuestas.
 *  - Archivos: `im.disk.folder.get` → `disk.folder.uploadfile` (base64) →
 *    `im.disk.file.commit`. Las URLs de Bitrix piden sesión del navegador: la
 *    descarga pasa por office con `disk.file.get` y el token de la persona.
 */

/** Las reacciones de Bitrix. */
export const REACCIONES = ['like', 'kiss', 'laugh', 'wonder', 'cry', 'angry', 'facepalm'] as const;
export type Reaccion = (typeof REACCIONES)[number];

export function reaccionValida(r: unknown): r is Reaccion {
  return typeof r === 'string' && (REACCIONES as readonly string[]).includes(r);
}

export function idMensajeValido(id: unknown): boolean {
  return typeof id === 'string' ? /^\d{1,12}$/.test(id) : Number.isInteger(id) && (id as number) > 0;
}

/** 15 MB por archivo: la API acepta 25 MB de cuerpo y el base64 suma un tercio. */
export const MAX_ARCHIVO_BYTES = 15 * 1024 * 1024;

/** Bytes reales de un base64 (sin decodificarlo). `null` si no es base64. */
export function bytesDeBase64(b64: unknown): number | null {
  if (typeof b64 !== 'string' || b64.length === 0 || b64.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const relleno = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return (b64.length / 4) * 3 - relleno;
}

/** Nombre de archivo sin rutas ni caracteres que Windows o Bitrix rechazan. */
export function nombreArchivoSeguro(nombre: unknown): string | null {
  if (typeof nombre !== 'string') return null;
  const base = nombre.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f<>:"|?*]/g, '').trim();
  if (!base || base === '.' || base === '..') return null;
  return base.length > 120 ? base.slice(base.length - 120) : base;
}

/** ¿La URL es del portal de Bitrix? Para no mandarle el token de nadie a otro dominio. */
export function urlDeBitrix(u: unknown): boolean {
  if (typeof u !== 'string') return false;
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && /(^|\.)bitrix24\.[a-z.]{2,10}$/i.test(x.hostname);
  } catch {
    return false;
  }
}
