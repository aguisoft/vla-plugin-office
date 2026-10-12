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
 */

export const HORAS_INACTIVIDAD = 8;
export const HORAS_TOPE_CONECTADO = 16;

export type MotivoCierre = 'inactivo' | 'tope';

export function motivoDeCierre(d: {
  ahora: Date;
  lastActivityAt: Date | null;
  /** Última vez que tuvo una pantalla abierta (si se cerró), o null. */
  ultimaConexion: Date | null;
  /** Tiene ahora la oficina o la app abiertas. */
  conectado: boolean;
  /** Entrada de la sesión abierta. */
  checkInAt: Date | null;
  horas?: number;
  tope?: number;
}): MotivoCierre | null {
  const horas = d.horas ?? HORAS_INACTIVIDAD;
  const tope = d.tope ?? HORAS_TOPE_CONECTADO;
  const ms = (h: number) => h * 3_600_000;
  if (d.conectado) {
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
