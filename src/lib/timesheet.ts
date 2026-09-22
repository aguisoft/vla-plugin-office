import { localDayStart, localDayEnd, localDateString, zonedTimeToUtc } from './local-date';

export type Period = 'day' | 'week' | 'month';

export interface Span {
  start: Date;
  end: Date;
}

/**
 * Límites del período que contiene `anchor`, en zona local.
 *
 * La semana arranca LUNES, como los calendarios de acá. `getDay()` pone el
 * domingo en 0, así que un ancla en domingo saltaría a la semana siguiente sin
 * el ajuste — el caso que la prueba fija.
 */
export function periodBounds(anchor: Date, period: Period, tz: string): Span {
  if (period === 'day') {
    return { start: localDayStart(anchor, tz), end: localDayEnd(anchor, tz) };
  }

  const dayStart = localDayStart(anchor, tz);
  const localDate = localDateString(anchor, tz);
  const [y, m, d] = localDate.split('-').map(Number);

  if (period === 'week') {
    // Día de la semana leído a mediodía local para que ningún desfase de zona
    // lo corra de día.
    const noon = zonedTimeToUtc(y, m, d, 12, 0, 0, tz);
    const mondayFirst = (noon.getUTCDay() + 6) % 7;
    const start = new Date(dayStart.getTime() - mondayFirst * 86_400_000);
    const lastDay = new Date(start.getTime() + 6 * 86_400_000);
    return { start, end: localDayEnd(lastDay, tz) };
  }

  const start = zonedTimeToUtc(y, m, 1, 0, 0, 0, tz);
  const nextMonth = zonedTimeToUtc(y, m + 1, 1, 0, 0, 0, tz);
  return { start, end: new Date(nextMonth.getTime() - 1) };
}

/**
 * Intersección de `span` con `within`, o `null` si no se tocan.
 *
 * Un contacto de borde exacto devuelve `null` y no un rango de duración cero:
 * un tramo de 0 minutos en el reporte es ruido que no aporta nada.
 */
export function clipSpan(span: Span, within: Span): Span | null {
  const start = span.start > within.start ? span.start : within.start;
  const end = span.end < within.end ? span.end : within.end;
  return start < end ? { start, end } : null;
}

/** Minutos del span, redondeados. Un span invertido da 0, nunca negativo. */
export function spanMinutes(span: Span): number {
  const ms = span.end.getTime() - span.start.getTime();
  return ms <= 0 ? 0 : Math.round(ms / 60_000);
}

/**
 * Parte un span en tramos por día local. Un Concentrado de lunes 23:00 a martes
 * 01:00 aporta 60 minutos a cada día, no 120 a uno solo.
 */
export function splitByLocalDay(span: Span, tz: string): Array<{ date: string; minutes: number }> {
  const out: Array<{ date: string; minutes: number }> = [];
  if (span.end <= span.start) return out;

  let cursor = span.start;
  // Cota de seguridad: un span corrupto de años no debe colgar el proceso.
  for (let guard = 0; guard < 400 && cursor < span.end; guard++) {
    const dayEnd = localDayEnd(cursor, tz);
    const chunkEnd = dayEnd < span.end ? dayEnd : span.end;
    const minutes = spanMinutes({ start: cursor, end: chunkEnd });
    if (minutes > 0) out.push({ date: localDateString(cursor, tz), minutes });
    cursor = new Date(chunkEnd.getTime() + 1);
  }
  return out;
}
