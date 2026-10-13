/**
 * El formulario de vacaciones (e incapacidad) con calendario: lo que se puede
 * probar sin pantalla. Los números (días hábiles, reintegro, feriados) los da
 * el servidor con los feriados de la persona; acá solo la selección y las
 * fechas en palabras.
 */

export interface Seleccion {
  desde: string | null;
  /** null mientras se elige: con un solo día tocado, es un día. */
  hasta: string | null;
}

/**
 * Tocar un día: el primero abre el rango y el segundo lo cierra. Si el segundo
 * es anterior al primero, se empieza de nuevo desde ahí; con el rango ya
 * cerrado, tocar otro día empieza uno nuevo.
 */
export function elegirDia(sel: Seleccion, fecha: string): Seleccion {
  if (!sel.desde || sel.hasta) return { desde: fecha, hasta: null };
  if (fecha < sel.desde) return { desde: fecha, hasta: null };
  return { desde: sel.desde, hasta: fecha };
}

/** El rango efectivo: con un solo día tocado, desde = hasta. */
export function rangoDe(sel: Seleccion): { desde: string; hasta: string } | null {
  return sel.desde ? { desde: sel.desde, hasta: sel.hasta ?? sel.desde } : null;
}

/** «2026-10» ± meses. */
export function moverMes(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Primer y último día de un mes «2026-10». */
export function limitesMes(ym: string): { desde: string; hasta: string } {
  const [y, m] = ym.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { desde: `${ym}-01`, hasta: `${ym}-${String(ultimo).padStart(2, '0')}` };
}

/** «Octubre 2026». */
export function nombreMes(ym: string): string {
  const t = new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('es', { month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(' de ', ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** «jueves 8 oct» de una fecha `YYYY-MM-DD` (sin correr de día por la zona del navegador). */
export function fechaEnPalabras(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`)
    .toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace(/\./g, '').replace(/,/g, '').replace(/ de /g, ' ');
}

/** Sábado o domingo. */
export function esFinDeSemana(ymd: string): boolean {
  const d = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

/** «1 día hábil», «medio día hábil», «5,5 días hábiles», «6 días corridos». */
export function textoDias(n: number, que = 'hábil'): string {
  const plural = que === 'hábil' ? 'hábiles' : `${que}s`;
  if (n === 0.5) return `medio día ${que}`;
  if (n === 1) return `1 día ${que}`;
  return `${String(n).replace('.', ',')} días ${plural}`;
}

/** 0 = domingo … 6 = sábado. */
export function diaSemana(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}
