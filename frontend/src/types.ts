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
