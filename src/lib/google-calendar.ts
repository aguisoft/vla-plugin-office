import { createHmac, timingSafeEqual } from 'crypto';
import { zonedTimeToUtc } from './local-date';

/**
 * Lo que se puede decidir sin hablar con Google: qué eventos tiene que haber
 * en el calendario de cada persona por sus ausencias y feriados, cuándo una
 * reunión de Google cambia su estado en la oficina, hasta cuándo está ocupada,
 * y la firma del enlace para conectar la cuenta (14-oct-2026).
 */

/** Los dos Workspace de VLA: solo se conectan cuentas de acá. */
export const DOMINIOS_GOOGLE = ['grupovla.com', 'vlacademy.com'];

/** Crear y borrar eventos, y ver ocupado/libre. Nada más. */
export const ALCANCES_GOOGLE = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
];

export function dominioDe(email: string): string {
  return email.trim().toLowerCase().split('@')[1] ?? '';
}

export function dominioPermitido(email: string): boolean {
  return DOMINIOS_GOOGLE.includes(dominioDe(email));
}

// ── El enlace para conectar: `state` firmado, vale 10 minutos ────────────────

const VIGENCIA_ESTADO_MS = 10 * 60_000;

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const firma = (dato: string, secreto: string) => createHmac('sha256', secreto).update(dato).digest('base64url');

export function firmarEstado(userId: string, ahora: number, secreto: string): string {
  const dato = b64(`${userId}.${ahora}`);
  return `${dato}.${firma(dato, secreto)}`;
}

/** El userId del `state`, o null si no es nuestro o venció. */
export function leerEstado(estado: string, secreto: string, ahora: number): string | null {
  const [dato, f] = String(estado ?? '').split('.');
  if (!dato || !f) return null;
  const esperada = firma(dato, secreto);
  if (esperada.length !== f.length || !timingSafeEqual(Buffer.from(esperada), Buffer.from(f))) return null;
  const [userId, ts] = Buffer.from(dato, 'base64url').toString().split('.');
  const t = Number(ts);
  if (!userId || !Number.isFinite(t) || ahora - t > VIGENCIA_ESTADO_MS || t > ahora + 60_000) return null;
  return userId;
}

// ── Ausencias y feriados → eventos «Fuera de la oficina» ─────────────────────

export interface EventoDeseado {
  /** `ausencia:<id>` o `feriado:<YYYY-MM-DD>`: lo que ata el evento a su origen. */
  clave: string;
  titulo: string;
  inicio: string;
  fin: string;
  /** Permisos, citas e incapacidades: el motivo no es de nadie más. */
  privado: boolean;
}

const DE_DIAS = new Set(['VACACIONES', 'INCAPACIDAD']);

/**
 * Las de días terminan a las 23:59:59.999 del último día: el evento va hasta la
 * medianoche siguiente. Las de horas, tal cual. El título no dice el motivo:
 * en Google lo pueden ver otros, y una cita médica es un dato de salud.
 */
export function eventosDeAusencias(
  ausencias: Array<{ id: string; type: string; startAt: Date; endAt: Date }>,
  feriados: Array<{ fecha: string; nombre?: string | null }>,
  tz: string,
): EventoDeseado[] {
  const out: EventoDeseado[] = [];
  for (const a of ausencias) {
    const fin = DE_DIAS.has(a.type) ? new Date(a.endAt.getTime() + 1) : a.endAt;
    if (fin <= a.startAt) continue;
    out.push({
      clave: `ausencia:${a.id}`,
      titulo: a.type === 'VACACIONES' ? 'Vacaciones' : 'Fuera de la oficina',
      inicio: a.startAt.toISOString(),
      fin: fin.toISOString(),
      privado: a.type !== 'VACACIONES',
    });
  }
  for (const f of feriados) {
    const [y, m, d] = f.fecha.split('-').map(Number);
    out.push({
      clave: `feriado:${f.fecha}`,
      titulo: f.nombre ? `Feriado · ${f.nombre}` : 'Feriado',
      inicio: zonedTimeToUtc(y, m, d, 0, 0, 0, tz).toISOString(),
      fin: zonedTimeToUtc(y, m, d + 1, 0, 0, 0, tz).toISOString(),
      privado: false,
    });
  }
  return out;
}

export function firmaDe(e: Pick<EventoDeseado, 'inicio' | 'fin' | 'titulo'>): string {
  return `${e.inicio}|${e.fin}|${e.titulo}`;
}

export interface EventoCreado { clave: string; eventId: string; firma: string; fin: string }

/**
 * Qué crear y qué borrar para que Google muestre lo que tiene que mostrar.
 * Solo mira lo que todavía no terminó: lo pasado queda como historial. Si algo
 * cambió (fechas o título), se borra y se crea de nuevo.
 */
export function planDeAusencias(deseados: EventoDeseado[], existentes: EventoCreado[], ahora: Date): {
  crear: EventoDeseado[];
  borrar: Array<{ clave: string; eventId: string }>;
} {
  const vigente = (fin: string) => new Date(fin) > ahora;
  const porClave = new Map(deseados.filter(d => vigente(d.fin)).map(d => [d.clave, d]));
  const propios = existentes.filter(e => /^(ausencia|feriado):/.test(e.clave) && vigente(e.fin));
  const borrar = propios
    .filter(e => { const d = porClave.get(e.clave); return !d || firmaDe(d) !== e.firma; })
    .map(e => ({ clave: e.clave, eventId: e.eventId }));
  const quedan = new Set(propios.filter(e => !borrar.some(b => b.clave === e.clave)).map(e => e.clave));
  const crear = [...porClave.values()].filter(d => !quedan.has(d.clave));
  return { crear, borrar };
}

// ── Reuniones de Google → estado en la oficina ───────────────────────────────

export interface EventoGoogle {
  id: string;
  status?: string;
  summary?: string;
  visibility?: string;
  transparency?: string;
  eventType?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; self?: boolean; resource?: boolean; responseStatus?: string; organizer?: boolean }>;
  organizer?: { self?: boolean; email?: string };
  extendedProperties?: { private?: Record<string, string> };
}

/** ¿Es el evento que la oficina quiere en ese lugar? Para adoptar uno que quedó creado sin anotarse. */
export function coincide(ev: EventoGoogle, d: EventoDeseado): boolean {
  const iso = (s?: string) => (s ? new Date(s).toISOString() : '');
  return (ev.summary ?? '') === d.titulo && iso(ev.start?.dateTime) === d.inicio && iso(ev.end?.dateTime) === d.fin;
}

export interface ReunionGoogle { id: string; titulo: string; fin: Date; externa: boolean }

/**
 * La reunión que la persona tiene AHORA, si hay una que cuente: con otra gente,
 * aceptada (o propia), de horario (no de todo el día), que la marque ocupada y
 * que no sea un bloque de concentración, de ubicación o de fuera de la oficina.
 * Externa si alguien no es de los dos dominios de VLA.
 */
export function reunionEnCurso(eventos: EventoGoogle[], ahora: Date): ReunionGoogle | null {
  const candidatas = eventos.flatMap(e => {
    if (e.status === 'cancelled' || e.transparency === 'transparent') return [];
    if (e.eventType && e.eventType !== 'default') return [];
    // Las reuniones que arma la oficina ya ponen su estado por su cuenta.
    if ((e.extendedProperties?.private?.vlaOficina ?? '').startsWith('reunion:')) return [];
    if (!e.start?.dateTime || !e.end?.dateTime) return [];
    const inicio = new Date(e.start.dateTime);
    const fin = new Date(e.end.dateTime);
    if (!(inicio <= ahora && ahora < fin)) return [];
    const gente = (e.attendees ?? []).filter(a => !a.resource);
    const yo = gente.find(a => a.self);
    const otros = gente.filter(a => !a.self);
    if (!otros.length) return [];
    const propia = !!e.organizer?.self || !!yo?.organizer;
    if (!propia && yo?.responseStatus !== 'accepted') return [];
    const privada = e.visibility === 'private' || e.visibility === 'confidential';
    const titulo = privada ? 'Reunión' : (e.summary?.trim() || 'Reunión').slice(0, 120);
    const externa = otros.some(a => !!a.email && !DOMINIOS_GOOGLE.includes(dominioDe(a.email)));
    return [{ id: e.id, titulo, fin, externa, inicio }];
  });
  if (!candidatas.length) return null;
  // La que empezó más tarde: si se superponen, es en la que está ahora.
  candidatas.sort((a, b) => b.inicio.getTime() - a.inicio.getTime());
  const { inicio: _i, ...r } = candidatas[0];
  return r;
}

/**
 * Lo que dejó la oficina al poner a alguien «En reunión» por Google. `soltado`:
 * la persona cambió el estado a mano durante esa reunión; se recuerda el evento
 * para no volver a ponérsela hasta que termine.
 */
export interface Puesto { eventId: string; status: string; titulo: string; soltado?: boolean }

export type AccionEstado =
  | { tipo: 'poner'; status: 'IN_MEETING_INTERNAL' | 'IN_MEETING_EXTERNAL'; titulo: string; fin: Date; eventId: string }
  | { tipo: 'devolver' }
  | { tipo: 'soltar' }
  | { tipo: 'olvidar' }
  | { tipo: 'nada' };

/**
 * Pone «En reunión» solo a quien está en la oficina y Disponible: nunca pisa un
 * almuerzo, una pausa ni una ausencia. Al terminar devuelve a Disponible, pero
 * solo si el estado sigue siendo el que puso la oficina. Si la persona lo
 * cambió (por ejemplo, se puso Disponible porque la reunión terminó antes), se
 * suelta: esa reunión ya no la vuelve a poner, aunque en Google siga corriendo.
 */
export function decidirEstado(
  actual: ReunionGoogle | null,
  presencia: { isCheckedIn: boolean; status: string; justification: string | null } | null,
  puesto: Puesto | null,
): AccionEstado {
  const poner = (r: ReunionGoogle): AccionEstado => ({
    tipo: 'poner', status: r.externa ? 'IN_MEETING_EXTERNAL' : 'IN_MEETING_INTERNAL', titulo: r.titulo, fin: r.fin, eventId: r.id,
  });
  if (puesto?.soltado) {
    if (!actual) return { tipo: 'olvidar' };
    if (actual.id === puesto.eventId) return { tipo: 'nada' };
  } else if (puesto) {
    const sigueSiendoNuestro = !!presencia && presencia.isCheckedIn
      && presencia.status === puesto.status && (presencia.justification ?? '') === puesto.titulo;
    if (!sigueSiendoNuestro) return actual ? { tipo: 'soltar' } : { tipo: 'olvidar' };
    if (actual && actual.id === puesto.eventId) return { tipo: 'nada' };
    return actual ? poner(actual) : { tipo: 'devolver' };
  }
  if (actual && presencia?.isCheckedIn && presencia.status === 'AVAILABLE') return poner(actual);
  return { tipo: 'nada' };
}

// ── Ocupado al invitar ───────────────────────────────────────────────────────

/** Hasta cuándo está ocupada ahora (juntando bloques pegados), o null si está libre. */
export function ocupadoHasta(bloques: Array<{ start: string; end: string }>, ahora: Date): Date | null {
  const orden = bloques
    .map(b => ({ i: new Date(b.start), f: new Date(b.end) }))
    .filter(b => b.f > b.i)
    .sort((a, b) => a.i.getTime() - b.i.getTime());
  let hasta: Date | null = null;
  for (const b of orden) {
    if (hasta === null) {
      if (b.i <= ahora && ahora < b.f) hasta = b.f;
    } else if (b.i <= hasta && b.f > hasta) {
      hasta = b.f;
    }
  }
  return hasta;
}
