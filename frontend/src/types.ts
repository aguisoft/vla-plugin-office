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
  status: string;
  statusMessage?: string;
  currentZoneId?: string;
  defaultZoneId?: string;
  positionX?: number;
  positionY?: number;
  lastActivityAt: string;
  avatar: AvatarCfg | null;
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
