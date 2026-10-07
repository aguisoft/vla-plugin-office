import { PUBLIC_JUSTIFICATION, type ResolvedStatus } from './status-rules';

/**
 * Estados restringidos: solo el dueño, su jefe directo y office.manage.
 * CITA_MEDICA está acá por lo mismo que INCAPACIDAD: el motivo es un dato de
 * salud —propio o de un familiar— y no tiene por qué leerlo todo el equipo.
 */
const RESTRICTED: Set<ResolvedStatus> = new Set(['PERMISO', 'CITA_MEDICA', 'INCAPACIDAD']);

export interface Viewer {
  userId: string;
  hasManage: boolean;
  /** Usuarios de los que este viewer es jefe directo. */
  managedUserIds: Set<string>;
}

export function canSeeJustification(
  viewer: Viewer,
  targetUserId: string,
  resolved: ResolvedStatus,
): boolean {
  if (PUBLIC_JUSTIFICATION.has(resolved)) return true;
  if (!RESTRICTED.has(resolved)) return false; // el estado no lleva justificación

  if (viewer.userId === targetUserId) return true;
  if (viewer.hasManage) return true;
  return viewer.managedUserIds.has(targetUserId);
}

/**
 * Quién ve el SEMÁFORO del cronómetro (ámbar/rojo y los minutos de más).
 *
 * El tiempo transcurrido lo ve cualquiera: saber que a alguien le faltan dos
 * minutos para volver sirve para coordinarse. El color es otra cosa — señala
 * que alguien se pasó — y eso solo le compete a la persona, a su jefe directo
 * y a RRHH. Sin esta distinción, el equipo entero vería en rojo a un compañero
 * que se demoró en el almuerzo.
 */
export function canSeeTimeAlerts(viewer: Viewer, targetUserId: string): boolean {
  if (viewer.userId === targetUserId) return true;
  if (viewer.hasManage) return true;
  return viewer.managedUserIds.has(targetUserId);
}
