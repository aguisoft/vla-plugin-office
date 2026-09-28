/**
 * Helpers de formato de fecha/hora en español, compartidos entre `App.tsx`
 * y los componentes que agregan las Tasks 22/23 (`MeetingInviteModal`,
 * `HolidayOverrideModal`). Ya pasó dos veces que un valor quedó duplicado
 * archivo por archivo -- los tres mapas de color de estado, después los dos
 * mapas de dot-color que caían a gris -- no hay motivo para que las fechas
 * sean la tercera.
 */

/** Fecha corta, p. ej. "14 sept 2026". Para confirmaciones y fechas agendadas
 * que representan un instante real (`Date`/`DateTime`, con hora y zona). */
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Fecha corta a partir de una columna `@db.Date` (feriados) o de un
 * `<input type="date">` (p. ej. `newDate` de `HolidayOverrideModal`), p. ej.
 * "14 sept 2026". Ninguna de las dos lleva zona real — Prisma serializa
 * `@db.Date` como medianoche UTC, y un string `YYYY-MM-DD` sin hora lo
 * interpreta el motor de JS como medianoche UTC también (a diferencia de un
 * datetime sin sufijo, que se lee en hora local). Las dos formas, leídas con
 * `fmtDate`, corren un día atrás en cualquier zona al oeste de UTC —
 * Costa Rica incluida. Se toma solo la parte de fecha y se reconstruye el
 * `Date` sin `Z` (medianoche LOCAL) para evitar el corrimiento — mismo
 * patrón que `monthName`. No usar para instantes reales: para eso es
 * `fmtDate`.
 */
export function fmtDateOnly(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Hora corta, p. ej. "15:00". Para invitaciones y permisos dentro del mismo día. */
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

/**
 * `absenceEndsAt` (y el `until` que viaja en `unavailable[]` cuando se
 * bloquea invitar a un ausente) es el instante inclusivo del ÚLTIMO día de
 * una ausencia de rango -- 23:59:59.999 hora local del día en que la persona
 * todavía está fuera. Se fija acá la semántica de una vez: "hasta X" muestra
 * ese mismo día; "vuelve el X" muestra el siguiente. Antes cada consumidor
 * formateaba el instante crudo con una etiqueta distinta ("Vuelve
 * el"/"hasta") sin sumar el día -- las dos frases leían la misma fecha, así
 * que una de las dos siempre mentía, y cuál dependía de la zona del
 * navegador (ver Fix #4 de la revisión final). Los dos exports comparten el
 * mismo cálculo: `absenceReturnDate` es literalmente el día de `absenceLastDay`
 * + 1. Devuelve un `Date` (no un string ya formateado) porque HoverCard
 * muestra el mes largo sin año y los otros dos sitios el formato corto de
 * `fmtDate` -- el cálculo se comparte, el estilo visual de cada uno no.
 */
export function absenceLastDay(endsAtIso: string): string {
  return fmtDate(endsAtIso);
}

export function absenceReturnDate(endsAtIso: string): Date {
  const next = new Date(endsAtIso);
  next.setDate(next.getDate() + 1);
  return next;
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

/**
 * `Xh Ym`, sin la parte en cero: "45m", "2h", "2h 15m". Vivía duplicado en
 * `TimesheetScreen` y hubiera quedado triplicado con `TeamTable` -- se sube
 * acá por el mismo motivo que el resto de este archivo (ver docstring de
 * arriba).
 */
export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
