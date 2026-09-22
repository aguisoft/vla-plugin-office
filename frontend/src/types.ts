export interface AvatarCfg {
  skinColor: string;
  hairStyle: string;
  hairColor: string;
  shirtColor: string;
  accessory: string;
  emoji?: string;
}

export interface UserSnapshot {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isCheckedIn: boolean;
  /** Estado resuelto: ya incluye ausencias y feriados. */
  status: string;
  /** PresenceStatus.status sin resolver. Para diagnosticar. */
  rawStatus: string;
  /** El estado viene de una ausencia o feriado; el avatar se pinta igual. */
  isAbsent: boolean;
  statusMessage?: string;
  /** Ausente si el viewer no tiene permiso de verla. */
  justification?: string;
  statusStartsAt?: string;
  statusEndsAt?: string;
  absenceEndsAt?: string;
  meetingId?: string;
  meetingWith?: { userId: string; firstName: string; lastName: string }[];
  currentZoneId?: string;
  defaultZoneId?: string;
  positionX?: number;
  positionY?: number;
  lastActivityAt: string;
  checkedInAt?: string;
  photoUrl?: string;
  avatar: AvatarCfg | null;
}

export interface Absence {
  id: string;
  userId: string;
  type: 'PERMISO' | 'VACACIONES' | 'INCAPACIDAD';
  startAt: string;
  endAt: string;
  justification?: string;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  country: string;
}

export interface PendingInvite {
  id: string;
  meetingId: string;
  hostId: string;
  hostName: string;
  justification: string | null;
  expiresAt: string;
}

export interface UnavailableParticipant {
  userId: string;
  name: string;
  reason: string;
  until: string | null;
}

export interface Zone {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: string;
  color?: string;
  icon?: string;
  maxOccupancy?: number | null;
}

export interface LayoutData {
  id: string;
  name: string;
  zones: Zone[];
}

/**
 * Colaborador con su país resuelto y de dónde sale ese país, tal como lo
 * devuelve `GET /org/roster`. El `countrySource` es lo que distingue un país
 * cargado por RRHH de uno que es solo el valor de respaldo del plugin.
 */
export interface RosterUser {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  country: string | null;
  countrySource: 'override' | 'bitrix' | 'default';
  managerUserId: string | null;
}

/** Un día del recorte de tiempo en oficina, tal como lo entrega `GET /timesheet/office`. */
export interface OfficeDay {
  date: string;
  minutes: number;
}

/** Un tramo del desglose por estado: cuántos minutos pasó en ese estado dentro del período. */
export interface StatusSlice {
  status: string;
  minutes: number;
}

export interface TimesheetOfficeResponse {
  period: 'day' | 'week' | 'month';
  from: string;
  to: string;
  office: { userId: string; totalMinutes: number; byDay: OfficeDay[] };
  /** Desglose por estado dentro del período. Junto con `unaccountedMinutes` suma `office.totalMinutes`. */
  breakdown: StatusSlice[];
  /** Minutos conectados sin estado capturado en el historial -- lo que el desglose no alcanza a explicar. */
  unaccountedMinutes: number;
  /** Desde cuándo el backend tiene historial de estados. `null` si todavía no hay ninguno. */
  coverageStart: string | null;
}

/**
 * A quién puede consultar el viewer: a sí mismo siempre, y a su gente a cargo
 * si tiene reportes directos. `isAdmin` no se usa hoy en la UI -- lo trae el
 * backend por si una vista futura necesita distinguir el bypass total.
 */
export interface TimesheetScope {
  viewerId: string;
  isAdmin: boolean;
  users: Array<{ id: string; firstName: string; lastName: string; email: string }>;
}
