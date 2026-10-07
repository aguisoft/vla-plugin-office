/**
 * Horario de un permiso (fecha + desde/hasta del mismo día).
 *
 * El 6-oct-2026 Milady cargó a las 17:35 un permiso «de 05:35 a 06:30»: quiso
 * decir de la tarde. Se guardó a la mañana, ya había pasado, nunca se vio
 * activo y le descontó 55 minutos del mes. De ahí: arrancar en la hora actual,
 * y avisar (con sugerencia de la tarde) cuando el horario ya pasó.
 */

const dos = (n: number) => String(n).padStart(2, '0');

/** «YYYY-MM-DD» del día local. */
export function hoyLocal(ahora: Date): string {
  return `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`;
}

function aMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function aHora(min: number): string {
  return `${dos(Math.floor(min / 60))}:${dos(min % 60)}`;
}

/**
 * Valores iniciales: hoy, desde la hora actual (redondeada a 5 minutos hacia
 * arriba) y una hora de largo. Cerca de la medianoche, hasta 23:59.
 */
export function horarioInicial(ahora: Date): { fecha: string; desde: string; hasta: string } {
  const min = ahora.getHours() * 60 + ahora.getMinutes();
  const desde = Math.min(Math.ceil(min / 5) * 5, 23 * 60 + 55);
  return { fecha: hoyLocal(ahora), desde: aHora(desde), hasta: aHora(Math.min(desde + 60, 23 * 60 + 59)) };
}

/** ¿Ese horario ya terminó? Solo para hoy o días anteriores. */
export function yaPaso(fecha: string, hasta: string, ahora: Date): boolean {
  if (!fecha) return false;
  const hoy = hoyLocal(ahora);
  if (fecha < hoy) return true;
  if (fecha > hoy) return false;
  return aMin(hasta) <= ahora.getHours() * 60 + ahora.getMinutes();
}

/**
 * Si un horario de HOY ya pasó y es de la mañana, la misma hora de la tarde
 * (si todavía no terminó). Es lo que la persona casi siempre quiso decir.
 */
export function sugerirTarde(fecha: string, desde: string, hasta: string, ahora: Date): { desde: string; hasta: string } | null {
  if (fecha !== hoyLocal(ahora) || !yaPaso(fecha, hasta, ahora)) return null;
  const d = aMin(desde);
  const h = aMin(hasta);
  if (d >= 12 * 60 || h + 12 * 60 > 23 * 60 + 59) return null;
  const tarde = { desde: aHora(d + 12 * 60), hasta: aHora(h + 12 * 60) };
  return yaPaso(fecha, tarde.hasta, ahora) ? null : tarde;
}

/** Aviso de un estado que venció solo (lo guarda office al vencerlo). */
export interface AvisoVencido {
  status: string;
  /** Hora de fin que tenía el estado (ISO). */
  terminaba: string;
  vencioEn: string;
}

const NOMBRE_VENCIDO: Record<string, string> = {
  LUNCH: 'Tu almuerzo',
  BRB: 'Tu «vuelvo pronto»',
  FOCUS: 'Tu tiempo de concentración',
};

/** «Tu almuerzo terminó a las 13:49 y volviste a Disponible.» */
export function textoAvisoVencido(a: AvisoVencido, hora: (iso: string) => string): string {
  return `${NOMBRE_VENCIDO[a.status] ?? 'Tu estado'} terminó a las ${hora(a.terminaba)} y volviste a Disponible. Quedó registrado.`;
}
