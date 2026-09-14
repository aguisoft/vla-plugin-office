export const DEFAULT_TZ = 'America/Costa_Rica';

interface Parts { y: number; m: number; d: number; h: number; mi: number; s: number }

/** Descompone un instante en las partes de reloj de la zona dada. */
function zonedParts(instant: Date, tz: string): Parts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    // 'en-US' con hour12:false devuelve 24 para la medianoche; se normaliza a 0
    h: Number(p.hour) % 24,
    mi: Number(p.minute),
    s: Number(p.second),
  };
}

/** Desfase de la zona respecto a UTC, en ms, para ese instante. */
function zoneOffsetMs(instant: Date, tz: string): number {
  const { y, m, d, h, mi, s } = zonedParts(instant, tz);
  const asIfUtc = Date.UTC(y, m - 1, d, h, mi, s);
  // instant.getTime() lleva milisegundos; asIfUtc solo hasta segundos
  return asIfUtc - (instant.getTime() - instant.getMilliseconds());
}

export function zonedTimeToUtc(
  y: number, m: number, d: number, h: number, mi: number, s: number, tz: string,
): Date {
  // Primera aproximación: tratar la hora local como si fuera UTC.
  const guess = new Date(Date.UTC(y, m - 1, d, h, mi, s));
  // Corregir con el desfase vigente en ese momento, y volver a medir en caso de
  // que la corrección haya cruzado un cambio de horario de verano.
  const once = new Date(guess.getTime() - zoneOffsetMs(guess, tz));
  return new Date(guess.getTime() - zoneOffsetMs(once, tz));
}

export function localDateString(instant: Date, tz: string): string {
  const { y, m, d } = zonedParts(instant, tz);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function localDayStart(instant: Date, tz: string): Date {
  const { y, m, d } = zonedParts(instant, tz);
  return zonedTimeToUtc(y, m, d, 0, 0, 0, tz);
}

export function localDayEnd(instant: Date, tz: string): Date {
  const { y, m, d } = zonedParts(instant, tz);
  const startOfNext = zonedTimeToUtc(y, m, d + 1, 0, 0, 0, tz);
  return new Date(startOfNext.getTime() - 1);
}

export function sameLocalMonth(a: Date, b: Date, tz: string): boolean {
  const pa = zonedParts(a, tz);
  const pb = zonedParts(b, tz);
  return pa.y === pb.y && pa.m === pb.m;
}
