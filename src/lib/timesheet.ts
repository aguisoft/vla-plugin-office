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

export interface OfficeDay {
  date: string;
  minutes: number;
}

export interface OfficeAggregate {
  totalMinutes: number;
  byDay: OfficeDay[];
}

/**
 * Suma sesiones dentro de un período, partidas por día local.
 *
 * Recibe spans ya resueltos (la sesión abierta la cierra el llamador contra
 * `min(now, fin del período)`), así que acá no hay noción de "abierta": eso
 * mantiene la función pura y hace que el caso raro se pruebe en un solo lugar.
 */
export function aggregateSessions(sessions: Span[], within: Span, tz: string): OfficeAggregate {
  const byDate = new Map<string, number>();

  for (const s of sessions) {
    const clipped = clipSpan(s, within);
    if (!clipped) continue;
    for (const { date, minutes } of splitByLocalDay(clipped, tz)) {
      byDate.set(date, (byDate.get(date) ?? 0) + minutes);
    }
  }

  const byDay = [...byDate.entries()]
    .map(([date, minutes]) => ({ date, minutes }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { totalMinutes: byDay.reduce((acc, d) => acc + d.minutes, 0), byDay };
}

/**
 * Conjunto de personas que el viewer puede consultar, o `null` si no tiene
 * restricción (ADMIN).
 *
 * `null` y no "todos los ids" a propósito: el endpoint no siempre tiene la
 * lista completa a mano, y un `null` explícito obliga al llamador a decidir qué
 * significa, en vez de comparar contra un conjunto que podría estar incompleto
 * y negar acceso por accidente.
 */
export function resolveScope(
  viewerId: string,
  managedUserIds: Set<string>,
  isAdmin: boolean,
): Set<string> | null {
  if (isAdmin) return null;
  return new Set<string>([viewerId, ...managedUserIds]);
}

/** `scope === null` (ADMIN) ve a cualquiera; si no, solo a quien está adentro. */
export function canSee(scope: Set<string> | null, userId: string): boolean {
  return scope === null || scope.has(userId);
}

export interface StatusSlice {
  status: string;
  minutes: number;
}

/** Estados que no entran en el desglose ni en la base del porcentaje. */
const EXCLUIDOS = new Set(['OFFLINE']);

/**
 * Minutos por estado dentro del período.
 *
 * OFFLINE queda fuera: un fin de semana son 62 horas en ese estado y se come
 * todo el gráfico, dejando los porcentajes sin significado.
 */
export function aggregateIntervals(
  intervals: Array<Span & { status: string }>,
  within: Span,
  tz: string,
): StatusSlice[] {
  const porEstado = new Map<string, number>();

  for (const iv of intervals) {
    if (EXCLUIDOS.has(iv.status)) continue;
    const clipped = clipSpan({ start: iv.start, end: iv.end }, within);
    if (!clipped) continue;
    // Se parte por día y se vuelve a sumar: el recorte por día es lo que hace
    // que un intervalo que cruza medianoche no se cuente de más en la vista
    // diaria, y usar la misma función acá mantiene los dos totales coherentes.
    const minutes = splitByLocalDay(clipped, tz).reduce((a, x) => a + x.minutes, 0);
    if (minutes > 0) porEstado.set(iv.status, (porEstado.get(iv.status) ?? 0) + minutes);
  }

  return [...porEstado.entries()]
    .map(([status, minutes]) => ({ status, minutes }))
    .sort((a, b) => b.minutes - a.minutes || a.status.localeCompare(b.status));
}

/**
 * Ajusta el desglose contra el tiempo conectado real de `CheckInRecord`.
 *
 * `CheckInRecord` es la autoridad: es el dato que existe desde abril y el que la
 * gente reconoce como su jornada. El desglose es una subdivisión suya.
 *
 * La diferencia se devuelve como `unaccountedMinutes` y se muestra como «sin
 * registrar». Escondida en un redondeo, esa señal —que el registro está
 * perdiendo escrituras— no se vería nunca.
 */
export function reconcile(
  connectedMinutes: number,
  slices: StatusSlice[],
): { slices: StatusSlice[]; unaccountedMinutes: number } {
  const suma = slices.reduce((a, s) => a + s.minutes, 0);

  if (connectedMinutes <= 0) {
    return { slices: slices.map(s => ({ ...s, minutes: 0 })), unaccountedMinutes: 0 };
  }

  if (suma <= connectedMinutes) {
    return { slices, unaccountedMinutes: connectedMinutes - suma };
  }

  // Los tramos superan lo conectado: se recortan proporcionalmente. El último
  // absorbe el resto del redondeo para que la suma cierre exacta.
  const factor = connectedMinutes / suma;
  const ajustados = slices.map(s => ({ ...s, minutes: Math.floor(s.minutes * factor) }));
  const resto = connectedMinutes - ajustados.reduce((a, s) => a + s.minutes, 0);
  if (ajustados.length > 0) ajustados[ajustados.length - 1].minutes += resto;
  return { slices: ajustados, unaccountedMinutes: 0 };
}
