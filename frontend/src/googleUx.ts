/**
 * Lo de Google Calendar que se puede probar sin navegador: cómo volvió la
 * persona de Google y el «ocupado» al invitar (14-oct-2026).
 */

export type ResultadoGoogle = 'listo' | 'error' | 'dominio' | 'cancelado' | 'sesion';

/** `?google=…` con el que vuelve de Google (en la URL del iframe o de la página). */
export function resultadoGoogle(...busquedas: Array<string | null | undefined>): ResultadoGoogle | null {
  for (const b of busquedas) {
    if (!b) continue;
    const v = new URLSearchParams(b).get('google');
    if (v === 'listo' || v === 'error' || v === 'dominio' || v === 'cancelado' || v === 'sesion') return v;
  }
  return null;
}

export function mensajeResultadoGoogle(r: ResultadoGoogle): { tono: 'ok' | 'error'; texto: string } {
  switch (r) {
    case 'listo': return { tono: 'ok', texto: 'Listo: tu Google Calendar quedó conectado.' };
    case 'dominio': return { tono: 'error', texto: 'Esa cuenta no es de VLA. Conectá la de @grupovla.com o @vlacademy.com.' };
    case 'cancelado': return { tono: 'error', texto: 'No se conectó: cancelaste el permiso en Google.' };
    case 'sesion': return { tono: 'error', texto: 'No se conectó: el enlace era de otra persona. Usá el botón «Conectar» desde tu propia sesión de la oficina.' };
    default: return { tono: 'error', texto: 'Google no completó la conexión. Volvé a intentarlo.' };
  }
}

/** «Ocupado en Google hasta las 10:30», en la hora de la oficina. */
export function textoOcupado(hastaIso: string): string {
  const hora = new Intl.DateTimeFormat('es', { timeZone: 'America/Costa_Rica', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(hastaIso));
  return `Ocupado en Google hasta las ${hora}`;
}
