import { clipSpan, splitByLocalDay, type Period, type Span } from './timesheet';
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
 *
 * Exportada: I6 la necesita para separar, de la lista que ya arma
 * `diasConRegistro`, cuáles de esos días cayeron en fin de semana.
 */
export function esDiaHabil(fecha: string): boolean {
  const dow = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5;
}

/**
 * Días de lunes a viernes dentro del período, en fechas locales, menos los
 * feriados de `feriados` (fechas `YYYY-MM-DD`) que caigan en ese rango.
 *
 * Es el denominador de "N de M días". `feriados` es opcional para no romper
 * llamadores que todavía no resuelven el país de cada persona -- sin el
 * argumento, el denominador es simplemente los hábiles (I5): un feriado no
 * cargado no existe y no se inventa.
 */
export function diasHabiles(within: Span, tz: string, feriados?: ReadonlySet<string>): string[] {
  const ultima = localDateString(within.end, tz);
  // Se ancla al mediodía UTC del primer día LOCAL, no al día calendario UTC de
  // `within.start`: cuando el arranque local cae por la tarde, su día UTC va uno
  // adelante y el primer día hábil se perdía. El mediodía es seguro porque
  // ningún desplazamiento de zona horaria cambia el día a esa hora.
  const cursor = new Date(`${localDateString(within.start, tz)}T12:00:00Z`);
  const out: string[] = [];
  let fecha = localDateString(cursor, tz);
  while (fecha <= ultima) {
    if (esDiaHabil(fecha) && !feriados?.has(fecha)) out.push(fecha);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    fecha = localDateString(cursor, tz);
  }
  return out;
}

/**
 * Cuántas de estas fechas (`YYYY-MM-DD`, la salida de `diasConRegistro`)
 * caen fuera de lunes-viernes (I6).
 *
 * `diasConRegistro` sigue contando TODOS los días con sesión a propósito --
 * es el dato correcto, "¿trabajó ese día?" -- pero compararlo tal cual
 * contra `diasHabiles` produce fracciones como "7/5" para quien trabajó un
 * sábado: el numerador y el denominador miden universos distintos. Esta
 * función no cambia `diasConRegistro`; separa el fin de semana para que la
 * interfaz lo reporte aparte en vez de esconderlo O de dejar que infle la
 * fracción.
 */
export function diasFinDeSemana(dias: string[]): number {
  return dias.filter(f => !esDiaHabil(f)).length;
}

/** Cuántos períodos anteriores entran en la norma, por tipo de período. */
export const PERIODOS_NORMA: Record<Period, number> = { day: 20, week: 8, month: 6 };

export interface Norma { promedioMinutos: number; periodosUsados: number }

/**
 * Promedio de los períodos anteriores, ignorando los que no tuvieron actividad.
 *
 * Los ceros se excluyen a propósito: unas vacaciones o una racha sin marcar
 * arrastrarían la norma hacia abajo y después cualquier semana normal se vería
 * como un récord. La norma tiene que describir cómo trabaja la persona cuando
 * trabaja.
 */
export function computeNorm(totalesPrevios: number[]): Norma {
  // Number.isFinite descarta tanto NaN como Infinity. Hace falta pedir las dos
  // cosas: NaN > 0 ya da false y se excluiría solo, pero Infinity > 0 da true
  // y se colaría en la suma arrastrando el promedio a Infinity. Que NaN e
  // Infinity se comporten distinto entre sí es peor que cualquiera de los dos
  // por separado.
  const conActividad = totalesPrevios.filter(m => Number.isFinite(m) && m > 0);
  if (conActividad.length === 0) return { promedioMinutos: 0, periodosUsados: 0 };
  const suma = conActividad.reduce((a, b) => a + b, 0);
  return {
    promedioMinutos: Math.round(suma / conActividad.length),
    periodosUsados: conActividad.length,
  };
}

export type Variacion =
  | { tipo: 'sin-base' }
  | { tipo: 'calculada'; pct: number; destacar: boolean };

/** Debajo de esto es fluctuación normal y no se señala. */
const UMBRAL_DESTACAR = 15;

/** Menos de esto no alcanza para hablar de una norma. */
const MINIMO_PERIODOS = 3;

/**
 * Variación del período actual contra la norma de la persona.
 *
 * Siempre contra uno mismo y nunca contra el equipo: comparar entre
 * compañeros premia a quien más horas aguanta, no a quien mejor trabaja.
 *
 * `destacar` existe para que la interfaz no ponga una flecha en cada fila. Si
 * todo se señala, nada se lee.
 */
export function variacion(actual: number, norma: Norma): Variacion {
  if (norma.periodosUsados < MINIMO_PERIODOS || norma.promedioMinutos <= 0) {
    return { tipo: 'sin-base' };
  }
  const crudo = Math.round(((actual - norma.promedioMinutos) / norma.promedioMinutos) * 100);
  // Un porcentaje que no se puede calcular (norma.promedioMinutos en Infinity,
  // por ejemplo) no es un porcentaje: no hay nada que mostrar ni que destacar.
  if (!Number.isFinite(crudo)) return { tipo: 'sin-base' };
  // Normaliza -0 a 0: Object.is(-0, 0) es false y un consumidor que compare en
  // proceso (no vía JSON) lo notaría. No se usa `crudo || 0` porque eso
  // también reescribiría un NaN a 0 y taparía el caso de arriba.
  const pct = crudo === 0 ? 0 : crudo;
  return { tipo: 'calculada', pct, destacar: Math.abs(pct) > UMBRAL_DESTACAR };
}

/** Mínimo de días para hablar de un hábito. */
const MINIMO_DIAS_HABITO = 3;

/** Minutos desde la medianoche LOCAL. */
function minutosLocales(d: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const partes = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  // Intl devuelve "24" para la medianoche en algunos entornos; se normaliza.
  const h = Number(partes.hour) % 24;
  return h * 60 + Number(partes.minute);
}

/**
 * Hora local a la que la persona suele entrar, como "HH:MM".
 *
 * Mediana y no promedio: el día que alguien entró a las 4am para una entrega
 * correría el promedio media hora y el número dejaría de describir su rutina.
 * La mediana lo ignora.
 *
 * Recibe UNA entrada por día (la primera de cada día); pasarle todas las
 * sesiones sesgaría el resultado hacia quien entra y sale varias veces.
 *
 * Una fecha inválida (p. ej. `new Date('basura')`) no tiene hora local que
 * extraer: `Intl.DateTimeFormat` lanza una excepción sobre un instante NaN,
 * así que dejarla pasar tumbaría toda la función por un solo dato sucio. Se
 * descarta antes de calcular, igual que `computeNorm` excluye los períodos no
 * finitos: un dato que no se puede ubicar en el tiempo no cuenta ni a favor
 * ni en contra del hábito, y si al filtrar quedan menos de las muestras
 * mínimas, el resultado es `null`, nunca una hora inventada sobre datos
 * parciales.
 */
export function entradaHabitual(primerasEntradas: Date[], tz: string): string | null {
  const validas = primerasEntradas.filter(d => Number.isFinite(d.getTime()));
  if (validas.length < MINIMO_DIAS_HABITO) return null;

  const mins = validas.map(d => minutosLocales(d, tz)).sort((a, b) => a - b);
  const medio = Math.floor(mins.length / 2);
  const mediana = mins.length % 2 === 1
    ? mins[medio]
    : Math.round((mins[medio - 1] + mins[medio]) / 2);

  const hh = String(Math.floor(mediana / 60)).padStart(2, '0');
  const mm = String(mediana % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
