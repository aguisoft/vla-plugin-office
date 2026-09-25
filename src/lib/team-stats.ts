import { clipSpan, splitByLocalDay, type Span } from './timesheet';
import { localDateString } from './local-date';

export interface SesionCruda { start: Date; end: Date }

export type EstadoRegistro = 'con-registro' | 'sin-registrar';

/**
 * Si la persona marco o no en el periodo.
 *
 * Es la distincion mas importante de toda la pantalla: en produccion 9 de 22
 * personas activas no marcan entrada, y mostrarlas con "0m" las hace ver como si
 * no hubieran trabajado. `sin-registrar` significa "no hay dato", no "no hubo
 * trabajo", y la interfaz tiene que decirlo con esas palabras.
 *
 * Basta con que UNA sesion interseque el periodo. Una sesion degenerada
 * (inicio == fin) cuenta como registro: la persona marco, aunque no aporte
 * minutos.
 */
export function estadoRegistro(sesiones: SesionCruda[], within: Span): EstadoRegistro {
  const hay = sesiones.some(s => s.start <= within.end && s.end >= within.start);
  return hay ? 'con-registro' : 'sin-registrar';
}

/**
 * Dias LOCALES distintos con al menos un minuto de sesion dentro del periodo.
 *
 * Se cuenta el dia y no la sesion: quien entra y sale tres veces en un dia
 * trabajo un dia, no tres. Y se parte por dia local para que una sesion que
 * cruza medianoche cuente los dos dias que de verdad toco.
 */
export function diasConRegistro(sesiones: SesionCruda[], within: Span, tz: string): string[] {
  const dias = new Set<string>();
  for (const s of sesiones) {
    const clipped = clipSpan(s, within);
    if (!clipped) continue;
    for (const tramo of splitByLocalDay(clipped, tz)) {
      if (tramo.minutes > 0) dias.add(tramo.date);
    }
  }
  return [...dias].sort();
}

/**
 * Dias de lunes a viernes dentro del periodo, en fechas locales.
 *
 * Es el denominador de "N de M dias". Los feriados se descontarian aca cuando
 * RRHH los cargue -- hoy hay 0 en produccion, asi que el denominador es
 * simplemente los habiles. No se inventan: un feriado no cargado no existe.
 */
export function diasHabiles(within: Span, tz: string): string[] {
  const out: string[] = [];
  // Se avanza de 12:00 UTC en 12:00 UTC y no de medianoche: a mediodia ningun
  // desplazamiento de zona horaria cambia el dia local, asi que el mismo
  // YYYY-MM-DD sale estable en UTC-6 sin depender de la hora del servidor.
  const cursor = new Date(within.start);
  cursor.setUTCHours(12, 0, 0, 0);
  while (cursor <= within.end) {
    const fecha = localDateString(cursor, tz);
    // getUTCDay sobre el mediodia del dia local ya representa ese dia.
    const dow = new Date(`${fecha}T12:00:00Z`).getUTCDay();
    if (dow >= 1 && dow <= 5 && fecha >= localDateString(within.start, tz)) out.push(fecha);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return [...new Set(out)].filter(d => d <= localDateString(within.end, tz));
}
