/**
 * Cuándo cerrar sola la sesión de alguien que se olvidó de marcar la salida.
 *
 * Antes se miraba solo `lastActivityAt`, que cambia al entrar, salir o cambiar
 * de estado: quien entraba a las 8:00 y se quedaba todo el día en Disponible
 * salía a las 16:00, y se le cerraba la jornada de Bitrix con una hora falsa
 * (lo encontramos el 2-oct-2026 con 3 personas a punto de caer).
 *
 * Ahora: con la oficina o la app abiertas no se cierra (salvo un tope de horas
 * desde la entrada, para quien deja la compu prendida toda la noche), y sin
 * pantallas abiertas cuenta desde la última vez que se lo vio conectado.
 *
 * 15-oct-2026: con la jornada de Bitrix abierta tampoco. Quien trabaja todo el
 * día en Bitrix sin la oficina abierta quedaba «inactivo» a las 8 h y se le
 * cortaba la jornada (22 veces en horario laboral entre el 6 y el 15-oct, a 7
 * personas). Bitrix manda: solo el tope cierra una jornada olvidada.
 */

export const HORAS_INACTIVIDAD = 8;
export const HORAS_TOPE_CONECTADO = 16;

export type MotivoCierre = 'inactivo' | 'tope';

/**
 * Qué le dice a la oficina la jornada de Bitrix (`timeman.status`):
 * - abierta (OPENED o PAUSED): está trabajando. La sincronización lo mete y la
 *   inactividad no lo saca (solo el tope).
 * - cerrada (CLOSED): la sincronización lo saca.
 * - vencida (EXPIRED: de un día anterior, sin cerrar): no se deduce nada. Antes
 *   contaba como abierta y volvía a meter a medianoche a quien la dejó abierta,
 *   que a las 8 h salía por inactividad y al minuto volvía a entrar.
 * null si Bitrix no contestó.
 */
export type JornadaBitrix = 'abierta' | 'cerrada' | 'vencida';
export function jornadaBitrix(status: string | null | undefined): JornadaBitrix | null {
  switch (status) {
    case 'OPENED': case 'PAUSED': return 'abierta';
    case 'CLOSED': return 'cerrada';
    case 'EXPIRED': return 'vencida';
    default: return null;
  }
}

export function motivoDeCierre(d: {
  ahora: Date;
  lastActivityAt: Date | null;
  /** Última vez que tuvo una pantalla abierta (si se cerró), o null. */
  ultimaConexion: Date | null;
  /** Tiene ahora la oficina o la app abiertas. */
  conectado: boolean;
  /** Entrada de la sesión abierta. */
  checkInAt: Date | null;
  /** Su jornada de Bitrix está abierta (según la última sincronización). */
  jornadaAbierta?: boolean;
  horas?: number;
  tope?: number;
}): MotivoCierre | null {
  const horas = d.horas ?? HORAS_INACTIVIDAD;
  const tope = d.tope ?? HORAS_TOPE_CONECTADO;
  const ms = (h: number) => h * 3_600_000;
  if (d.conectado || d.jornadaAbierta) {
    return d.checkInAt && d.ahora.getTime() - d.checkInAt.getTime() > ms(tope) ? 'tope' : null;
  }
  const actividad = Math.max(d.lastActivityAt?.getTime() ?? 0, d.ultimaConexion?.getTime() ?? 0);
  if (!actividad) return null;
  return d.ahora.getTime() - actividad > ms(horas) ? 'inactivo' : null;
}

/** Los que vencen solos. Las reuniones no: cerrarlas tiene efectos en los invitados. */
const VENCEN = new Set(['LUNCH', 'BRB', 'FOCUS']);

/**
 * Estados que vencieron: tienen fin y ya pasó. Desde el 12-oct-2026 NO vuelven
 * solos a Disponible: se le avisa a la persona (ver lib/vuelta-manual.ts).
 */
export function estadosVencidos<T extends { userId: string; status: string; statusEndsAt: Date | null; isCheckedIn: boolean }>(
  filas: T[], ahora: Date,
): T[] {
  return filas.filter(f => f.isCheckedIn && VENCEN.has(f.status)
    && !!f.statusEndsAt && f.statusEndsAt.getTime() <= ahora.getTime());
}
