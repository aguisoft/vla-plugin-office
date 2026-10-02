import { localDateString, zonedTimeToUtc } from './local-date';

/**
 * Jornada laboral de Bitrix (timeman) vista desde la oficina: lo que el widget
 * muestra y lo que se manda al cerrar. Todo puro: las llamadas viven en
 * services/jornada.service.ts.
 */

export type EstadoJornada = 'sin_iniciar' | 'trabajando' | 'en_pausa' | 'terminada' | 'vencida';

/** Lo que devuelve `timeman.status` (solo lo que se usa). */
export interface TimemanStatus {
  STATUS?: string;
  TIME_START?: string | null;
  TIME_FINISH?: string | null;
  DURATION?: string | null;
  TIME_LEAKS?: string | null;
}

export interface Jornada {
  estado: EstadoJornada;
  /** Fecha local (YYYY-MM-DD) en que empezó; `null` si no hay jornada. */
  fecha: string | null;
  inicio: string | null;
  /** Fin de la jornada, o comienzo de la pausa en curso. */
  fin: string | null;
  pausasSeg: number;
  /** Trabajado hasta el momento de la consulta. */
  trabajadoSeg: number;
}

/** «HH:MM:SS» de Bitrix a segundos. Acepta más de 24 h; lo ilegible es 0. */
export function segundosDe(hms: unknown): number {
  if (typeof hms !== 'string') return 0;
  const m = /^(\d{1,4}):([0-5]\d):([0-5]\d)$/.exec(hms.trim());
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function instante(v: unknown): Date | null {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Trabajado = (hasta − inicio) − pausas. Trabajando, «hasta» es ahora; en
 * pausa o terminada, el `fin` que dejó Bitrix. Una jornada vencida sin fin no
 * suma: no se sabe a qué hora se fue la persona.
 */
export function trabajadoSegundos(
  j: Pick<Jornada, 'estado' | 'inicio' | 'fin' | 'pausasSeg'>, ahora: Date,
): number {
  const inicio = instante(j.inicio);
  if (!inicio) return 0;
  const hasta = j.estado === 'trabajando' ? ahora : instante(j.fin);
  if (!hasta) return j.estado === 'en_pausa' ? Math.max(0, Math.floor((ahora.getTime() - inicio.getTime()) / 1000) - j.pausasSeg) : 0;
  return Math.max(0, Math.floor((hasta.getTime() - inicio.getTime()) / 1000) - j.pausasSeg);
}

const POR_STATUS: Record<string, EstadoJornada> = {
  OPENED: 'trabajando', PAUSED: 'en_pausa', CLOSED: 'terminada', EXPIRED: 'vencida',
};

const SIN_JORNADA: Jornada = { estado: 'sin_iniciar', fecha: null, inicio: null, fin: null, pausasSeg: 0, trabajadoSeg: 0 };

export function leerJornada(s: TimemanStatus | null | undefined, ahora: Date, tz: string): Jornada {
  const inicio = instante(s?.TIME_START);
  const estado = s?.STATUS ? POR_STATUS[s.STATUS] : undefined;
  if (!s || !inicio || !estado) return SIN_JORNADA;

  const fecha = localDateString(inicio, tz);
  // Bitrix devuelve la última jornada: si la de ayer se cerró, hoy no empezó.
  if (estado === 'terminada' && fecha !== localDateString(ahora, tz)) return SIN_JORNADA;

  const j: Jornada = {
    estado,
    fecha,
    inicio: inicio.toISOString(),
    fin: instante(s.TIME_FINISH)?.toISOString() ?? null,
    pausasSeg: segundosDe(s.TIME_LEAKS),
    trabajadoSeg: 0,
  };
  const duracion = segundosDe(s.DURATION);
  j.trabajadoSeg = estado === 'terminada' && duracion > 0 ? duracion : trabajadoSegundos(j, ahora);
  return j;
}

/** Para mostrar: «7 h 05 min», «45 min». */
export function duracionTexto(seg: number): string {
  const min = Math.max(0, Math.floor(seg / 60));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

// ── Hora de salida ────────────────────────────────────────────────────────────

/** «17:45» del día local `fecha` → instante. `null` si no es una hora válida. */
export function horaLocal(fecha: string, hhmm: unknown, tz: string): Date | null {
  if (typeof hhmm !== 'string') return null;
  const h = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!h || !f) return null;
  return zonedTimeToUtc(Number(f[1]), Number(f[2]), Number(f[3]), Number(h[1]), Number(h[2]), 0, tz);
}

/** Un minuto de gracia: el reloj de la computadora y el del servidor no coinciden. */
const GRACIA_MS = 60_000;

/** Mensaje para la persona si la hora de salida no tiene sentido; `null` si sirve. */
export function problemaConSalida(salida: Date, inicio: Date, ahora: Date, tz: string): string | null {
  if (salida.getTime() <= inicio.getTime()) {
    return `La salida tiene que ser después de la entrada (${horaTexto(inicio, tz)}).`;
  }
  if (salida.getTime() > ahora.getTime() + GRACIA_MS) return 'La hora de salida no puede ser más tarde que ahora.';
  return null;
}

function partes(instant: Date, tz: string): Record<string, string> {
  const p: Record<string, string> = {};
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  for (const x of dtf.formatToParts(instant)) if (x.type !== 'literal') p[x.type] = x.value;
  p.hour = String(Number(p.hour) % 24).padStart(2, '0');
  return p;
}

export function horaTexto(instant: Date, tz: string): string {
  const p = partes(instant, tz);
  return `${p.hour}:${p.minute}`;
}

/** ISO con el desfase de la zona («2026-10-02T17:45:00-06:00»): así lo espera `timeman.close`. */
export function isoConZona(instant: Date, tz: string): string {
  const p = partes(instant, tz);
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  const desfaseMin = Math.round((local - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
  const signo = desfaseMin < 0 ? '-' : '+';
  const abs = Math.abs(desfaseMin);
  const zona = `${signo}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${zona}`;
}

// ── Tareas y eventos de Bitrix ────────────────────────────────────────────────

export type EstadoTarea = 'pendiente' | 'en_curso' | 'completada' | 'diferida';

export interface Tarea {
  id: number;
  titulo: string;
  estado: EstadoTarea;
  vence: string | null;
  cerrada: string | null;
  tiempoSeg: number;
  grupo: string | null;
}

/** 4 es «supuestamente completada» (espera que la revise quien la creó): para quien la hizo, ya está. */
const ESTADO_TAREA: Record<string, EstadoTarea> = { '2': 'pendiente', '3': 'en_curso', '4': 'completada', '5': 'completada', '6': 'diferida' };

/** `tasks.task.list` → tareas. Acepta `{tasks: [...]}` o la lista sola; descarta lo que no tiene id. */
export function leerTareas(crudo: unknown): Tarea[] {
  const lista = Array.isArray(crudo) ? crudo : Array.isArray((crudo as any)?.tasks) ? (crudo as any).tasks : [];
  const out: Tarea[] = [];
  for (const t of lista) {
    const id = Number(t?.id ?? t?.ID);
    if (!Number.isInteger(id) || id <= 0) continue;
    out.push({
      id,
      titulo: String(t.title ?? t.TITLE ?? '').trim() || `Tarea ${id}`,
      estado: ESTADO_TAREA[String(t.status ?? t.STATUS)] ?? 'pendiente',
      vence: instante(t.deadline ?? t.DEADLINE)?.toISOString() ?? null,
      cerrada: instante(t.closedDate ?? t.CLOSED_DATE)?.toISOString() ?? null,
      tiempoSeg: Number(t.timeSpentInLogs ?? t.TIME_SPENT_IN_LOGS) || 0,
      grupo: (t.group?.name ?? null) || null,
    });
  }
  return out;
}

export interface Evento {
  id: string;
  titulo: string;
  desde: string;
  hasta: string;
  todoElDia: boolean;
  fueraDeOficina: boolean;
}

function instanteDeEvento(ts: unknown, texto: unknown): Date | null {
  const n = Number(ts);
  if (Number.isFinite(n) && n > 0) return new Date(n * 1000);
  return instante(texto);
}

/**
 * `calendar.event.get` → eventos del día, en orden. Las fechas en texto vienen
 * en el formato del portal; se usan las marcas UTC cuando están. Las
 * invitaciones rechazadas no cuentan.
 */
export function leerEventos(crudo: unknown): Evento[] {
  const lista = Array.isArray(crudo) ? crudo : [];
  const out: Evento[] = [];
  for (const e of lista) {
    if (e?.MEETING_STATUS === 'N') continue;
    const desde = instanteDeEvento(e?.DATE_FROM_TS_UTC, e?.DATE_FROM);
    const hasta = instanteDeEvento(e?.DATE_TO_TS_UTC, e?.DATE_TO);
    if (!desde || !hasta || e?.ID == null) continue;
    out.push({
      id: String(e.ID),
      titulo: String(e.NAME ?? '').trim() || 'Evento',
      desde: desde.toISOString(),
      hasta: hasta.toISOString(),
      todoElDia: e.DT_SKIP_TIME === 'Y',
      fueraDeOficina: e.ACCESSIBILITY === 'absent',
    });
  }
  return out.sort((a, b) => a.desde.localeCompare(b.desde));
}

/** Plan del día: el de Bitrix (no se puede escribir por API) más lo que se sumó desde la oficina. */
export function idsDelPlan(deBitrix: unknown, deOficina: number[]): number[] {
  const crudos = Array.isArray(deBitrix) ? deBitrix : [];
  const vistos = new Set<number>();
  for (const v of [...crudos, ...deOficina]) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) vistos.add(n);
  }
  return [...vistos];
}

// ── Informe del día ───────────────────────────────────────────────────────────

/**
 * Borrador del informe que se manda al cerrar la jornada, como el de Bitrix:
 * lo que se completó, lo que quedó en curso y las reuniones. La persona lo
 * corrige antes de mandarlo.
 */
export function armarBorrador(d: { completadas: Tarea[]; enCurso: Tarea[]; eventos: Evento[]; tz: string }): string {
  const bloques: string[] = [];
  if (d.completadas.length) bloques.push(['Tareas completadas:', ...d.completadas.map(t => `- ${t.titulo}`)].join('\n'));
  if (d.enCurso.length) bloques.push(['Tareas en curso:', ...d.enCurso.map(t => `- ${t.titulo}`)].join('\n'));
  const conHora = d.eventos.filter(e => !e.todoElDia);
  if (conHora.length) {
    bloques.push(['Reuniones y eventos:', ...conHora.map(e =>
      `- ${horaTexto(new Date(e.desde), d.tz)}–${horaTexto(new Date(e.hasta), d.tz)} ${e.titulo}`)].join('\n'));
  }
  return bloques.join('\n\n');
}

export const LARGO_MAXIMO_INFORME = 5000;

// ── Reporte semanal / mensual ─────────────────────────────────────────────────

export interface FilaInforme {
  fecha: string;
  reporte: string;
  inicio: string | null;
  fin: string | null;
  trabajadoSeg: number;
}

export interface DiaResumen {
  fecha: string;
  /** Tiempo en la oficina virtual (check-in). */
  minutos: number;
  /** Lo que dijo Bitrix al cerrar ese día, si se cerró desde la oficina. */
  trabajadoSeg: number | null;
  inicio: string | null;
  fin: string | null;
  informe: string | null;
}

export interface Resumen {
  desde: string;
  hasta: string;
  totalMin: number;
  diasTrabajados: number;
  promedioMinPorDia: number;
  dias: DiaResumen[];
  tareasCerradas: Tarea[];
}

export function armarResumen(d: {
  desde: string; hasta: string;
  oficina: Array<{ date: string; minutes: number }>;
  informes: FilaInforme[];
  tareasCerradas: Tarea[];
}): Resumen {
  const porFecha = new Map<string, DiaResumen>();
  const dia = (fecha: string) => {
    let x = porFecha.get(fecha);
    if (!x) { x = { fecha, minutos: 0, trabajadoSeg: null, inicio: null, fin: null, informe: null }; porFecha.set(fecha, x); }
    return x;
  };
  for (const o of d.oficina) if (o.minutes > 0) dia(o.date).minutos += o.minutes;
  for (const i of d.informes) {
    const x = dia(i.fecha);
    x.informe = i.reporte;
    x.trabajadoSeg = i.trabajadoSeg;
    x.inicio = i.inicio;
    x.fin = i.fin;
  }
  const dias = [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const totalMin = dias.reduce((s, x) => s + x.minutos, 0);
  const diasTrabajados = dias.filter(x => x.minutos > 0 || x.informe).length;
  return {
    desde: d.desde,
    hasta: d.hasta,
    totalMin,
    diasTrabajados,
    promedioMinPorDia: diasTrabajados ? Math.round(totalMin / diasTrabajados) : 0,
    dias,
    tareasCerradas: [...d.tareasCerradas].sort((a, b) => (a.cerrada ?? '').localeCompare(b.cerrada ?? '')),
  };
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function fechaTexto(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return `${DIAS[dow]} ${d}/${m}`;
}

/** Texto para pegar en el informe semanal de Bitrix (que no tiene API) o en un correo. */
export function textoResumen(r: Resumen, titulo: string): string {
  const lineas = [
    titulo,
    `Tiempo en la oficina: ${duracionTexto(r.totalMin * 60)} en ${r.diasTrabajados} ${r.diasTrabajados === 1 ? 'día' : 'días'}` +
      (r.diasTrabajados ? ` (promedio ${duracionTexto(r.promedioMinPorDia * 60)} por día)` : ''),
  ];
  if (r.tareasCerradas.length) {
    lineas.push('', `Tareas completadas (${r.tareasCerradas.length}):`, ...r.tareasCerradas.map(t => `- ${t.titulo}`));
  }
  const conInforme = r.dias.filter(x => x.informe);
  if (conInforme.length) {
    lineas.push('', 'Informes diarios:');
    for (const x of conInforme) lineas.push('', `${fechaTexto(x.fecha)}:`, x.informe!.trim());
  }
  return lineas.join('\n');
}
