/**
 * Textos y reglas de la pantalla «Escritorio»: conectar Bitrix y vincular la
 * app de escritorio. Separado del componente para probarlo sin navegador.
 */

/** Mismo alfabeto que el core (sin 0/O, 1/I/L): se dicta y se copia a mano. */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Lo que la persona escribe, normalizado: mayúsculas, sin espacios ni guiones. */
export function normalizarCodigo(entrada: string): string {
  return entrada.toUpperCase().replace(/[\s-]/g, '');
}

/** Por qué todavía no se puede enviar, o `null` si el código tiene buena forma. */
export function problemaDelCodigo(entrada: string): string | null {
  const c = normalizarCodigo(entrada);
  if (c.length === 0) return 'Escribí el código que muestra la app de escritorio.';
  if (c.length !== 6) return 'El código tiene 6 caracteres.';
  const raro = [...c].find(ch => !ALFABETO.includes(ch));
  if (raro) {
    if ('0O'.includes(raro)) return 'El código no usa 0 ni O: revisá si es otra letra o número.';
    if ('1IL'.includes(raro)) return 'El código no usa 1, I ni L: revisá si es otra letra o número.';
    return 'El código solo tiene letras y números.';
  }
  return null;
}

/** Mensaje para un fallo al confirmar, según lo que respondió el core. */
export function mensajeDeVinculacion(status: number, detalle?: unknown): string {
  if (status === 404) return 'Ese código venció o no existe. Pedí uno nuevo en la app de escritorio: duran 5 minutos.';
  if (status === 403) {
    const m = (detalle as { message?: string } | undefined)?.message;
    return m || 'No tenés permiso para vincular un dispositivo.';
  }
  if (status === 400) return 'El código tiene 6 caracteres, letras y números.';
  if (status === 401) return 'Tu sesión venció. Recargá la página e intentá de nuevo.';
  return 'No se pudo vincular. Intentá de nuevo en un momento.';
}

export type ResultadoBitrix = 'listo' | 'error';

/**
 * Al volver de Bitrix el core redirige a `/dashboard/office?bitrix=listo|error`.
 * Esta pantalla vive en un iframe, así que el parámetro puede estar en su
 * propia URL o en la de la página que la contiene.
 */
export function resultadoBitrix(...busquedas: Array<string | null | undefined>): ResultadoBitrix | null {
  for (const b of busquedas) {
    if (!b) continue;
    const v = new URLSearchParams(b).get('bitrix');
    if (v === 'listo' || v === 'error') return v;
  }
  return null;
}

/** Qué decir del estado de conexión, en una línea. */
export function textoEstadoBitrix(estado: { conectado: boolean; desde?: string; rechazo?: string } | null): string {
  if (!estado) return 'Consultando…';
  if (estado.conectado) {
    const desde = estado.desde ? new Date(estado.desde).toLocaleDateString('es-CR', { day: 'numeric', month: 'long' }) : null;
    return desde ? `Conectado desde el ${desde}.` : 'Conectado.';
  }
  if (estado.rechazo === 'otra_cuenta') {
    return 'El último intento se hizo con otra cuenta de Bitrix abierta en este navegador. Cerrá esa sesión de Bitrix y volvé a conectar.';
  }
  if (estado.rechazo === 'sin_mapeo') {
    return 'Tu usuario todavía no está enlazado con Bitrix. Pedile a RRHH que sincronice el organigrama.';
  }
  return 'No conectado. Sin esto, el widget no puede mostrar ni mandar tus mensajes.';
}

export type EnlaceEscritorio = { tipo: 'codigo'; codigo: string } | { tipo: 'bitrix' };

/**
 * Lo que pide el widget al abrir la oficina: `?escritorio=K7P3QX` (vincular con
 * ese código ya escrito) o `?escritorio=bitrix` (ir directo a conectar Bitrix).
 *
 * El código solo se PRECARGA: vincular sigue pidiendo tocar «Vincular». Si se
 * confirmara solo, cualquiera podría mandarle a otra persona un enlace con SU
 * código y quedarse con una sesión de esa persona con un clic.
 */
export function enlaceEscritorio(...busquedas: Array<string | null | undefined>): EnlaceEscritorio | null {
  for (const b of busquedas) {
    if (!b) continue;
    const v = new URLSearchParams(b).get('escritorio');
    if (!v) continue;
    if (v.toLowerCase() === 'bitrix') return { tipo: 'bitrix' };
    if (!problemaDelCodigo(v)) return { tipo: 'codigo', codigo: normalizarCodigo(v) };
  }
  return null;
}

// ── Ofrecer la app a quien no la tiene ──────────────────────────────────────

export interface UsoEscritorio {
  instalada: boolean;
  version: string | null;
  ultimaVez: string | null;
  alDia: boolean;
  companeros: number;
  publicada: Publicada | null;
  /** El AppImage de Linux, si está publicado (20-oct-2026). */
  publicadaLinux?: Publicada | null;
}

export interface Publicada { version: string; tamano: number; tamanoTexto: string; fecha: string }

export type SistemaPc = 'win' | 'linux';

/** El sistema de esta computadora según el navegador. Android también dice «Linux»: no cuenta. */
export function sistemaDelNavegador(userAgent: string): SistemaPc {
  return /Linux/i.test(userAgent) && !/Android/i.test(userAgent) ? 'linux' : 'win';
}

/** Lo publicado para ese sistema. */
export function publicadaPara(uso: UsoEscritorio | null, sistema: SistemaPc): Publicada | null {
  return (sistema === 'linux' ? uso?.publicadaLinux : uso?.publicada) ?? null;
}

export const CLAVE_POSPONER = 'vla-escritorio-posponer';
export const DIAS_POSPONER = 3;

/**
 * Se ofrece si hay una versión publicada, la persona no la tiene, y no dijo
 * «Ahora no» hace menos de `DIAS_POSPONER` días.
 */
export function debeOfrecer(uso: UsoEscritorio | null, pospuestoHasta: number | null, ahora: number, sistema: SistemaPc = 'win'): boolean {
  if (!publicadaPara(uso, sistema) || uso?.instalada) return false;
  return !pospuestoHasta || ahora >= pospuestoHasta;
}

/** Hasta cuándo se pospone al tocar «Ahora no». */
export function posponerHasta(ahora: number): number {
  return ahora + DIAS_POSPONER * 86_400_000;
}

/** Lo guardado en localStorage → marca de tiempo o null. */
export function leerPospuesto(crudo: string | null): number | null {
  const n = Number(crudo);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** «Ya la usan 5 compañeros», o nada si todavía nadie (no se inventa urgencia). */
export function textoCompaneros(n: number): string | null {
  if (!(n > 0)) return null;
  return n === 1 ? 'Ya la usa 1 compañero' : `Ya la usan ${n} compañeros`;
}

/**
 * `?ver-oferta` en la URL (la del iframe o la de la página): muestra el aviso
 * aunque la persona ya tenga la app, para revisarlo o mostrarlo.
 */
export function ofertaForzada(...busquedas: Array<string | null | undefined>): boolean {
  return busquedas.some(b => !!b && new URLSearchParams(b).has('ver-oferta'));
}
