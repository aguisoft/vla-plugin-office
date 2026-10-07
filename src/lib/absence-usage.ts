import type { AbsenceType } from './status-rules';

/**
 * Topes de tiempo de las ausencias que se piden dentro del día.
 *
 * PERMISO es un tope MENSUAL y acumulable: la hora se puede partir (30 + 30).
 * CITA_MEDICA es un tope POR CITA: tres horas para una consulta, no un saldo
 * que se reparte en el mes — alguien puede tener dos citas en el mismo mes sin
 * que la segunda sea una falta.
 *
 * Fuente única: el frontend pinta el semáforo con estos mismos números a
 * través de `GET /absences/usage`, para que no haya dos verdades.
 */
export const TOPE_PERMISO_MES_MIN = 60;
export const TOPE_CITA_MEDICA_MIN = 180;

/** Minutos de colchón en ámbar antes de marcar el exceso en rojo. */
export const COLCHON_AMBAR_MIN = 5;

export interface VentanaAusencia {
  type: AbsenceType;
  startAt: Date | string;
  endAt: Date | string;
}

export interface UsoCita {
  inicio: string;          // ISO
  minutos: number;
  excesoMin: number;       // 0 si no se pasó de las 3 h
}

export interface ResumenMensual {
  anio: number;
  mes: number;             // 1-12
  permisoMin: number;
  permisoTopeMin: number;
  permisoRestanteMin: number;
  permisoExcedido: boolean;
  citas: UsoCita[];
  citasMin: number;
  citasExcesoMin: number;
}

function minutosEntre(a: Date | string, b: Date | string): number {
  const ini = a instanceof Date ? a : new Date(a);
  const fin = b instanceof Date ? b : new Date(b);
  const ms = fin.getTime() - ini.getTime();
  // Un registro invertido o corrupto aporta 0, no un negativo que descuente
  // tiempo ya consumido y haga ver saldo donde no lo hay.
  return ms > 0 ? Math.round(ms / 60000) : 0;
}

/**
 * Qué mes "consume" una ausencia: el de su inicio, en la zona de la operación.
 * Se compara contra la fecha local y no contra UTC — en UTC-6 un permiso de las
 * 19:00 del 31 cae en el mes siguiente y el tope se reiniciaría un día antes.
 */
function mesLocal(fecha: Date | string, tz: string): { anio: number; mes: number } {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => Number(partes.find(p => p.type === t)?.value ?? 0);
  return { anio: get('year'), mes: get('month') };
}

/**
 * Consumo de un colaborador en un mes concreto.
 *
 * Solo mira PERMISO y CITA_MEDICA: vacaciones e incapacidad son de día
 * completo y no se miden en minutos.
 */
export function resumenMensual(
  ausencias: VentanaAusencia[],
  anio: number,
  mes: number,
  tz: string,
): ResumenMensual {
  let permisoMin = 0;
  const citas: UsoCita[] = [];

  for (const a of ausencias) {
    const m = mesLocal(a.startAt, tz);
    if (m.anio !== anio || m.mes !== mes) continue;
    const mins = minutosEntre(a.startAt, a.endAt);

    if (a.type === 'PERMISO') {
      permisoMin += mins;
    } else if (a.type === 'CITA_MEDICA') {
      citas.push({
        inicio: (a.startAt instanceof Date ? a.startAt : new Date(a.startAt)).toISOString(),
        minutos: mins,
        excesoMin: Math.max(0, mins - TOPE_CITA_MEDICA_MIN),
      });
    }
  }

  citas.sort((x, y) => x.inicio.localeCompare(y.inicio));

  return {
    anio,
    mes,
    permisoMin,
    permisoTopeMin: TOPE_PERMISO_MES_MIN,
    permisoRestanteMin: Math.max(0, TOPE_PERMISO_MES_MIN - permisoMin),
    permisoExcedido: permisoMin > TOPE_PERMISO_MES_MIN,
    citas,
    citasMin: citas.reduce((s, c) => s + c.minutos, 0),
    citasExcesoMin: citas.reduce((s, c) => s + c.excesoMin, 0),
  };
}

/**
 * Si un permiso de `minutos` haría pasar el tope del mes. Lo usa el formulario
 * para avisar ANTES de registrarlo — avisa, no bloquea: una urgencia real no se
 * resuelve con una validación, y el dato queda para que el líder lo converse.
 */
export function excederiaTope(permisoMinDelMes: number, minutosNuevos: number): boolean {
  return permisoMinDelMes + minutosNuevos > TOPE_PERMISO_MES_MIN;
}
