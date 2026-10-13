/**
 * Reglas de pantalla para mover un feriado (las mismas que valida el
 * servidor en `validateOverrideInput`): el cambio se pide ANTES del feriado,
 * a un día hábil del mismo mes que todavía no pasó y que no sea feriado.
 * Fechas siempre `YYYY-MM-DD`, de calendario, sin zona.
 */

export interface Dia {
  fecha: string;
  dia: number;
}

const dos = (n: number) => String(n).padStart(2, '0');

function diaSemana(fecha: string): number {
  return new Date(`${fecha}T00:00:00Z`).getUTCDay();
}

/** Las semanas del mes del feriado, de lunes a domingo; `null` = celda vacía. */
export function semanasDelMes(fechaFeriado: string): Array<Array<Dia | null>> {
  const [y, m] = fechaFeriado.slice(0, 10).split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const semanas: Array<Array<Dia | null>> = [];
  let semana: Array<Dia | null> = Array((diaSemana(`${y}-${dos(m)}-01`) + 6) % 7).fill(null);
  for (let d = 1; d <= ultimo; d++) {
    semana.push({ fecha: `${y}-${dos(m)}-${dos(d)}`, dia: d });
    if (semana.length === 7) { semanas.push(semana); semana = []; }
  }
  if (semana.length) semanas.push([...semana, ...Array(7 - semana.length).fill(null)]);
  return semanas;
}

/** Por qué no se puede elegir ese día, o `null` si se puede. */
export function motivoNoElegible(fecha: string, c: { hoy: string; feriado: string; otrosFeriados: string[]; sabado?: number }): string | null {
  if (fecha === c.feriado) return 'Es el día del feriado';
  if (fecha <= c.hoy) return 'Ya pasó';
  // Quien trabaja el sábado (medio día o completo) puede tomarlo ese día.
  const ds = diaSemana(fecha);
  if (ds === 0 || (ds === 6 && !(c.sabado ?? 0))) return 'Fin de semana';
  if (c.otrosFeriados.includes(fecha)) return 'Ya es feriado';
  return null;
}

/** `YYYY-MM-DD` de hace `dias` días respecto de `hoy`. */
export function haceDias(hoy: string, dias: number): string {
  const d = new Date(`${hoy}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/** Un feriado que pasó hace más de un mes ya no aplica: se oculta. */
export function feriadoVigente(fecha: string, hoy: string): boolean {
  return fecha.slice(0, 10) >= haceDias(hoy, 31);
}

/**
 * Una solicitud se sigue mostrando mientras esté pendiente o mientras alguna de
 * sus dos fechas (el feriado o el día nuevo) sea de hace menos de un mes.
 */
export function solicitudVigente(s: { status: string; holidayDate: string | null; newDate: string }, hoy: string): boolean {
  if (s.status === 'PENDING') return true;
  const ultima = [s.holidayDate, s.newDate].filter((x): x is string => !!x).map(x => x.slice(0, 10)).sort().pop();
  return !!ultima && feriadoVigente(ultima, hoy);
}
