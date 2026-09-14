/**
 * Helpers de formato de fecha/hora en español, compartidos entre `App.tsx`
 * y los componentes que agregan las Tasks 22/23 (`MeetingInviteModal`,
 * `HolidayOverrideModal`). Ya pasó dos veces que un valor quedó duplicado
 * archivo por archivo -- los tres mapas de color de estado, después los dos
 * mapas de dot-color que caían a gris -- no hay motivo para que las fechas
 * sean la tercera.
 */

/** Fecha corta, p. ej. "14 sept 2026". Para confirmaciones y fechas agendadas. */
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Hora corta, p. ej. "15:00". Para invitaciones y permisos dentro del mismo día. */
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Nombre del mes de una fecha ISO, p. ej. "septiembre". Corta a los primeros
 * 10 caracteres y reconstruye el `Date` sin `Z` (medianoche local, no UTC)
 * antes de extraer el mes, para que un feriado guardado como fecha no se
 * lea como el día anterior en zonas al oeste de UTC.
 */
export function monthName(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('es', { month: 'long' });
}
