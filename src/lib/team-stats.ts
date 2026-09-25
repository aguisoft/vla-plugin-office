import { clipSpan, splitByLocalDay, type Span } from './timesheet';
import { localDateString } from './local-date';

export interface SesionCruda { start: Date; end: Date }

export type EstadoRegistro = 'con-registro' | 'sin-registrar';

/**
 * Si la persona marcó o no en el período.
 *
 * Es la distinción más importante de toda la pantalla: en producción 9 de 22
 * personas activas no marcan entrada, y mostrarlas con "0m" las hace ver como si
 * no hubieran trabajado. `sin-registrar` significa "no hay dato", no "no hubo
 * trabajo", y la interfaz tiene que decirlo con esas palabras.
 *
 * Basta con que UNA sesión interseque el período. Una sesión degenerada
 * (inicio == fin) cuenta como registro —la persona marcó, aunque no aporte
 * minutos— salvo que caiga exactamente en un borde del período, donde manda la
 * regla de abajo y no cuenta.
 *
 * Los bordes son estrictos (`<` / `>`, no `<=` / `>=`) para concordar con
 * `clipSpan`, del que depende `diasConRegistro`: ahí un contacto exacto en el
 * borde no es intersección. Con bordes inclusivos aquí, una sesión que termina
 * justo en `within.start` saldría "con-registro" pero aportaría cero días en
 * `diasConRegistro` sobre la misma sesión — las dos funciones tienen que
 * coincidir en qué cuenta como tocar el período.
 */
export function estadoRegistro(sesiones: SesionCruda[], within: Span): EstadoRegistro {
  const hay = sesiones.some(s => s.start < within.end && s.end > within.start);
  return hay ? 'con-registro' : 'sin-registrar';
}

/**
 * Días LOCALES distintos con al menos un minuto de sesión dentro del período.
 *
 * Se cuenta el día y no la sesión: quien entra y sale tres veces en un día
 * trabajó un día, no tres. Y se parte por día local para que una sesión que
 * cruza medianoche cuente los dos días que de verdad tocó.
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
 * Si `fecha` (YYYY-MM-DD) cae de lunes a viernes.
 *
 * Se evalúa al mediodía UTC de esa fecha: a esa hora ningún desplazamiento de
 * zona horaria empuja la fecha a otro día, así que el día de la semana sale
 * estable sin importar la zona del servidor.
 */
function esDiaHabil(fecha: string): boolean {
  const dow = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5;
}

/**
 * Días de lunes a viernes dentro del período, en fechas locales.
 *
 * Es el denominador de "N de M días". Los feriados se descontarían acá cuando
 * RRHH los cargue -- hoy hay 0 en producción, así que el denominador es
 * simplemente los hábiles. No se inventan: un feriado no cargado no existe.
 */
export function diasHabiles(within: Span, tz: string): string[] {
  const ultima = localDateString(within.end, tz);
  // Se ancla al mediodía UTC del primer día LOCAL, no al día calendario UTC de
  // `within.start`: cuando el arranque local cae por la tarde, su día UTC va uno
  // adelante y el primer día hábil se perdía. El mediodía es seguro porque
  // ningún desplazamiento de zona horaria cambia el día a esa hora.
  const cursor = new Date(`${localDateString(within.start, tz)}T12:00:00Z`);
  const out: string[] = [];
  let fecha = localDateString(cursor, tz);
  while (fecha <= ultima) {
    if (esDiaHabil(fecha)) out.push(fecha);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    fecha = localDateString(cursor, tz);
  }
  return out;
}
