import { PUBLIC_JUSTIFICATION, type ResolvedStatus } from './status-rules';

/** Estados restringidos: solo el dueño, su jefe directo y office.manage. */
const RESTRICTED: Set<ResolvedStatus> = new Set(['PERMISO', 'INCAPACIDAD']);

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
