import type { SolicitudAusencia } from './types';

/**
 * Cómo se muestra una solicitud propia. «Vale» = la ausencia está aplicada
 * (permiso/cita/incapacidad pendiente, o cualquiera aprobada).
 */
export function etiquetaSolicitud(s: Pick<SolicitudAusencia, 'estado' | 'tipo' | 'startAt' | 'endAt'>, ahora: number, ajena = false): { texto: string; clase: string } {
  if (s.estado === 'rechazada') return { texto: 'No aprobada', clase: 'bg-rose-50 text-rose-700' };
  if (s.estado === 'cancelada') return { texto: 'Cancelada', clase: 'bg-gray-100 text-gray-500' };
  if (s.estado === 'pendiente') {
    return s.tipo === 'VACACIONES'
      ? { texto: ajena ? 'Esperando aprobación' : 'Esperando a tu jefe', clase: 'bg-amber-50 text-amber-700' }
      : { texto: 'Aplicada · falta aprobación', clase: 'bg-amber-50 text-amber-700' };
  }
  const inicio = new Date(s.startAt).getTime();
  const fin = new Date(s.endAt).getTime();
  if (ahora < inicio) return { texto: 'Aprobada', clase: 'bg-emerald-50 text-emerald-700' };
  if (ahora > fin) return { texto: 'Aprobada · terminada', clase: 'bg-gray-100 text-gray-500' };
  return { texto: 'Aprobada · en curso', clase: 'bg-emerald-50 text-emerald-700' };
}

/** La persona la puede cancelar: vigente y todavía no empezó (el servidor lo vuelve a verificar). */
export function cancelable(s: Pick<SolicitudAusencia, 'estado' | 'startAt'>, ahora: number): boolean {
  return (s.estado === 'pendiente' || s.estado === 'aprobada') && new Date(s.startAt).getTime() > ahora;
}

/**
 * RRHH la puede anular: pendiente o aprobada, aunque ya haya empezado (en ese
 * caso el servidor exige el motivo; la pantalla lo pide siempre, porque le
 * llega a la persona).
 */
export function anulable(s: Pick<SolicitudAusencia, 'estado'>): boolean {
  return s.estado === 'pendiente' || s.estado === 'aprobada';
}

/** Se oculta lo resuelto que terminó hace más de un mes (las pendientes siempre se ven). */
export function vigenteEnHistorial(s: Pick<SolicitudAusencia, 'estado' | 'endAt'>, ahora: number): boolean {
  if (s.estado === 'pendiente') return true;
  return new Date(s.endAt).getTime() >= ahora - 31 * 86_400_000;
}

/** Pantallas que se pueden abrir con un enlace (desde el aviso de Bitrix o la app de escritorio). */
export type PantallaInicial = 'solicitudes' | 'ausencias' | 'feriado';

/**
 * Qué pantalla abrir al entrar: ?solicitudes=1, ?ausencias=1 o ?feriado=1. Se
 * miran varias búsquedas porque el parámetro puede estar en la URL del iframe
 * o en la de la página que lo contiene.
 */
export function pantallaInicial(...busquedas: Array<string | null | undefined>): PantallaInicial | null {
  for (const b of busquedas) {
    if (!b) continue;
    const p = new URLSearchParams(b);
    for (const k of ['solicitudes', 'ausencias', 'feriado'] as const) if (p.get(k) === '1') return k;
  }
  return null;
}
