/**
 * El correo de un aviso (solicitudes y sus respuestas, ver lib/avisos.ts).
 * Sale por el mismo Amazon SES de cobros, con su propio remitente.
 */

export interface ConfigCorreo {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  /** «VLA Oficina <oficina@grupovla.com>». */
  from: string;
}

export const REMITENTE_POR_DEFECTO = 'VLA Oficina <oficina@grupovla.com>';

/** La configuración del panel; null si falta algo y el correo no puede salir. */
export function configCorreo(c: Record<string, unknown>): ConfigCorreo | null {
  const host = String(c.CORREO_HOST ?? '').trim();
  const user = String(c.CORREO_USUARIO ?? '').trim();
  const pass = String(c.CORREO_CLAVE ?? '');
  if (!host || !user || !pass) return null;
  const port = Number(c.CORREO_PUERTO ?? 465) || 465;
  // SES: 465 es SSL directo; 587 es STARTTLS (secure en falso).
  const secure = c.CORREO_SSL === undefined || c.CORREO_SSL === '' ? port === 465 : c.CORREO_SSL !== false && c.CORREO_SSL !== 'false';
  const from = String(c.CORREO_REMITENTE ?? '').trim() || REMITENTE_POR_DEFECTO;
  return { host, port, secure, user, pass, from };
}

const escapar = (t: string) => t.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

/** Direcciones para la copia: válidas, sin repetir y sin el destinatario principal. */
export function direccionesCopia(para: string, copia: Array<string | null | undefined> = []): string[] {
  const p = para.trim().toLowerCase();
  const out: string[] = [];
  for (const c of copia) {
    const d = (c ?? '').trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d) && d !== p && !out.includes(d)) out.push(d);
  }
  return out;
}

/**
 * Asunto, texto y HTML del correo. `base` es la URL pública del sistema; la
 * ruta del aviso se pega a ella para el botón. La `ficha` (los datos de la
 * solicitud) va como tabla; con ella, el asunto dice de quién es, porque el
 * correo también le llega en copia a RRHH y a quien aprobó.
 */
export function armarCorreo(
  a: { titulo: string; cuerpo: string; url?: string | null; ficha?: Array<[string, string]> | null },
  base: string,
): { asunto: string; texto: string; html: string } {
  const enlace = `${base.replace(/\/+$/, '')}${a.url ?? '/dashboard/office'}`;
  const ficha = a.ficha ?? [];
  const campo = (k: string) => ficha.find(f => f[0] === k)?.[1];
  const quien = campo('Colaborador');
  const asunto = quien ? `${a.titulo} · ${campo('Tipo') ?? 'Solicitud'} de ${quien}` : a.titulo;
  const texto = [
    a.cuerpo || a.titulo,
    ficha.length ? ficha.map(([k, v]) => `${k}: ${v}`).join('\n') : null,
    `Abrir en la oficina: ${enlace}`,
    '— VLA Oficina',
  ].filter(Boolean).join('\n\n');
  const tabla = ficha.length
    ? `<tr><td style="padding-bottom:18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eef0f3">${
        ficha.map(([k, v]) => `<tr><td style="font-size:12px;color:#6b7280;padding:7px 12px 7px 0;border-bottom:1px solid #eef0f3;white-space:nowrap;vertical-align:top">${escapar(k)}</td><td style="font-size:13px;color:#1f2937;padding:7px 0;border-bottom:1px solid #eef0f3">${escapar(v)}</td></tr>`).join('')
      }</table></td></tr>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6f8;font-family:Segoe UI,Arial,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:14px;padding:24px" cellpadding="0" cellspacing="0">
<tr><td style="font-size:12px;color:#6b7280;padding-bottom:6px">VLA Oficina</td></tr>
<tr><td style="font-size:17px;font-weight:600;padding-bottom:10px">${escapar(a.titulo)}</td></tr>
${a.cuerpo ? `<tr><td style="font-size:14px;line-height:1.5;padding-bottom:18px">${escapar(a.cuerpo)}</td></tr>` : ''}
${tabla}
<tr><td><a href="${escapar(enlace)}" style="display:inline-block;background:#0369a1;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:9px 16px;border-radius:9px">Abrir en la oficina</a></td></tr>
</table>
<p style="font-size:11px;color:#9ca3af;margin-top:14px">Enviado por la Oficina Virtual de VLA.</p>
</td></tr></table></body></html>`;
  return { asunto, texto, html };
}
