/**
 * El centro de avisos de la oficina: todo lo que se le avisa a una persona
 * (una solicitud de su equipo, la respuesta a la suya, un recordatorio) pasa
 * por un solo lugar que decide por dónde sale.
 *
 * Antes cada función elegía sus canales: el chat avisaba por la app de
 * escritorio y por el navegador a la vez (dos avisos de Windows por mensaje),
 * las solicitudes no llegaban al navegador, las invitaciones a reunión solo a
 * la app, y nada quedaba guardado: quien no estaba conectado se lo perdía.
 */

export interface AvisoNuevo {
  /** Para filtrar y para la app de escritorio: `solicitud.nueva`, `feriado.resuelto`… */
  tipo: string;
  titulo: string;
  cuerpo: string;
  /** Ruta interna que abre el aviso (`/dashboard/...`). Cualquier otra cosa se descarta. */
  url?: string | null;
  /** Queda en la campana. Por defecto sí. */
  guardar?: boolean;
  /**
   * Sale en vivo: aviso de Windows en la app de escritorio y cartel en la web.
   * Por defecto sí. En falso cuando la pantalla ya lo muestra por su cuenta
   * (el chat, las invitaciones a reunión).
   */
  emergente?: boolean;
  /** Mensaje para Bitrix (admite [URL=…]). Sin él, no va por Bitrix. */
  bitrix?: string | null;
}

export const MAX_TITULO = 140;
export const MAX_CUERPO = 500;
const MAX_DESTINOS = 200;

/** Solo rutas internas: el aviso abre esta url al tocarlo. */
export function rutaInterna(url: unknown): string | null {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && url.length <= 300 ? url : null;
}

export function recortar(texto: string, max: number): string {
  const t = texto.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Lo que manda otro plugin por el hook `office.avisar`, validado:
 * `{ userId | userIds, tipo, titulo, cuerpo?, url?, guardar?, emergente?, bitrix? }`.
 */
export function leerPedidoDeAviso(p: unknown): { userIds: string[]; aviso: AvisoNuevo } | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const crudos = Array.isArray(o.userIds) ? o.userIds : o.userId !== undefined ? [o.userId] : [];
  const userIds = [...new Set(crudos.filter((u): u is string => typeof u === 'string' && u.length > 0))].slice(0, MAX_DESTINOS);
  if (!userIds.length) return null;
  if (typeof o.tipo !== 'string' || !/^[\w.:-]{1,60}$/.test(o.tipo)) return null;
  if (typeof o.titulo !== 'string' || !o.titulo.trim()) return null;
  return {
    userIds,
    aviso: {
      tipo: o.tipo,
      titulo: recortar(o.titulo, MAX_TITULO),
      cuerpo: typeof o.cuerpo === 'string' ? recortar(o.cuerpo, MAX_CUERPO) : '',
      url: rutaInterna(o.url),
      guardar: o.guardar !== false,
      emergente: o.emergente !== false,
      bitrix: typeof o.bitrix === 'string' && o.bitrix.trim() ? o.bitrix : null,
    },
  };
}
