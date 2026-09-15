export type ResolvedStatus =
  | 'AVAILABLE' | 'FOCUS' | 'IN_MEETING_INTERNAL' | 'IN_MEETING_EXTERNAL'
  | 'LUNCH' | 'BRB' | 'OFFLINE'
  | 'PERMISO' | 'VACACIONES' | 'INCAPACIDAD' | 'FERIADO';

export type PayloadKind =
  | 'none'
  | 'justification'
  | 'timeRange'
  | 'participants'
  | 'dateRange'
  | 'permiso'
  | 'holidayOverride';

export interface StatusCfg {
  label: string;
  /** Color del anillo del avatar. */
  color: string;
  /** Clase Tailwind del punto. */
  dot: string;
  /** Clase Tailwind del texto. */
  text: string;
  /** Solo en ausencias: las distingue del grupo del día. */
  icon?: string;
  group: 'day' | 'absence' | 'system';
  payload: PayloadKind;
}

/**
 * Record exhaustivo a propósito: agregar un miembro a ResolvedStatus sin
 * agregarlo acá rompe el build. Es la red que reemplaza a las pruebas de UI.
 *
 * Los estados del día usan color saturado; las ausencias usan tono apagado más
 * un ícono, para que se lean como dos grupos distintos sin inventar cuatro
 * matices que nadie distingue.
 */
export const STATUS_CFG: Record<ResolvedStatus, StatusCfg> = {
  AVAILABLE:           { label: 'Disponible',         color: '#4ade80', dot: 'bg-green-400',  text: 'text-green-600',  group: 'day',     payload: 'none' },
  FOCUS:               { label: 'Concentrado',        color: '#60a5fa', dot: 'bg-blue-400',   text: 'text-blue-600',   group: 'day',     payload: 'justification' },
  IN_MEETING_INTERNAL: { label: 'En reunión interna', color: '#c084fc', dot: 'bg-purple-400', text: 'text-purple-600', group: 'day',     payload: 'participants' },
  IN_MEETING_EXTERNAL: { label: 'En reunión externa', color: '#7c3aed', dot: 'bg-violet-600', text: 'text-violet-700', group: 'day',     payload: 'justification' },
  LUNCH:               { label: 'Almuerzo',           color: '#fb923c', dot: 'bg-orange-400', text: 'text-orange-500', group: 'day',     payload: 'timeRange' },
  BRB:                 { label: 'Vuelvo pronto',      color: '#facc15', dot: 'bg-yellow-400', text: 'text-yellow-600', group: 'day',     payload: 'justification' },
  OFFLINE:             { label: 'Desconectado',       color: '#d1d5db', dot: 'bg-gray-300',   text: 'text-gray-400',   group: 'system',  payload: 'none' },
  PERMISO:             { label: 'Permiso',            color: '#94a3b8', dot: 'bg-slate-400',  text: 'text-slate-600',  icon: '📄', group: 'absence', payload: 'permiso' },
  VACACIONES:          { label: 'Vacaciones',         color: '#7dd3fc', dot: 'bg-sky-300',    text: 'text-sky-600',    icon: '🏖', group: 'absence', payload: 'dateRange' },
  INCAPACIDAD:         { label: 'Incapacidad',        color: '#fca5a5', dot: 'bg-red-300',    text: 'text-red-500',    icon: '🏥', group: 'absence', payload: 'dateRange' },
  FERIADO:             { label: 'Feriado',            color: '#fcd34d', dot: 'bg-amber-300',  text: 'text-amber-600',  icon: '🎉', group: 'absence', payload: 'holidayOverride' },
};

export const DAY_GROUP: ResolvedStatus[] =
  (Object.keys(STATUS_CFG) as ResolvedStatus[]).filter(s => STATUS_CFG[s].group === 'day');

export const ABSENCE_GROUP: ResolvedStatus[] =
  (Object.keys(STATUS_CFG) as ResolvedStatus[]).filter(s => STATUS_CFG[s].group === 'absence');

/** Lo que el colaborador puede elegir. OFFLINE lo escribe solo el sistema. */
export const SELECTABLE: ResolvedStatus[] = [...DAY_GROUP, ...ABSENCE_GROUP];

export const MIN_JUSTIFICATION = 10;

export function cfgOf(status: string): StatusCfg {
  return STATUS_CFG[status as ResolvedStatus] ?? STATUS_CFG.OFFLINE;
}
