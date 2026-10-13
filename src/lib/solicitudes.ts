/**
 * Reglas del ciclo de solicitudes de ausencia (ver
 * docs/superpowers/specs/2026-10-07-solicitudes-ausencias-design.md).
 *
 * - Permiso, cita médica e incapacidad VALEN mientras están pendientes (son
 *   urgentes o hechos consumados): el jefe aprueba después.
 * - Vacaciones NO valen hasta que se aprueban.
 * - Aprueba el jefe directo; si no hay, RRHH (office.manage). RRHH puede
 *   resolver cualquiera. Nadie resuelve la suya.
 * - Nada se borra: rechazar o cancelar cambia el estado. Lo que sí se quita
 *   es la ausencia (AbsenceRecord) cuando todavía no empezó.
 */

export type TipoAusencia = 'PERMISO' | 'CITA_MEDICA' | 'VACACIONES' | 'INCAPACIDAD';
export type EstadoSolicitud = 'pendiente' | 'aprobada' | 'rechazada' | 'cancelada';
export type Accion = 'aprobar' | 'rechazar' | 'cancelar';
/** Qué le pasa a la AbsenceRecord: se crea (vacaciones aprobadas), se quita, o nada. */
export type Efecto = 'crear' | 'quitar' | 'ninguno';

export const MIN_MOTIVO = 5;

/** ¿La ausencia aplica desde que se pide, aunque esté pendiente? */
export function valeMientrasPendiente(tipo: string): boolean {
  return tipo !== 'VACACIONES';
}

/**
 * Cómo nace una solicitud.
 * - La cargó RRHH para otra persona: ya está aprobada (RRHH es quien aprueba).
 * - Quien la pide no tiene jefe y es RRHH: no hay a quién pedírsela, aprobada.
 * - El resto: pendiente (la ve su jefe, o RRHH si no tiene jefe).
 */
export function estadoInicial(d: { cargadaPorRrhhParaOtro: boolean; tieneJefe: boolean; solicitanteEsRrhh: boolean }): 'pendiente' | 'aprobada' {
  if (d.cargadaPorRrhhParaOtro) return 'aprobada';
  if (!d.tieneJefe && d.solicitanteEsRrhh) return 'aprobada';
  return 'pendiente';
}

/** ¿Puede este viewer aprobar o rechazar la solicitud de esa persona? */
export function puedeResolver(d: { viewerId: string; solicitanteId: string; esJefeDirecto: boolean; esRrhh: boolean }): boolean {
  if (d.viewerId === d.solicitanteId) return false;
  return d.esJefeDirecto || d.esRrhh;
}

export type Transicion =
  | { ok: true; nuevo: EstadoSolicitud; efecto: Efecto }
  | { ok: false; motivo: string };

/**
 * Qué pasa al aplicar una acción. `empezo` = la ausencia ya empezó (start_at
 * <= ahora). `tieneAusencia` = existe la AbsenceRecord.
 */
export function transicion(d: {
  estado: EstadoSolicitud;
  accion: Accion;
  tipo: string;
  empezo: boolean;
  tieneAusencia: boolean;
  /** Quien cancela es la persona misma (no RRHH). */
  esDueno: boolean;
  esRrhh: boolean;
  motivo?: string;
}): Transicion {
  const motivoOk = (d.motivo ?? '').trim().length >= MIN_MOTIVO;
  switch (d.accion) {
    case 'aprobar':
      if (d.estado !== 'pendiente') return { ok: false, motivo: 'Esa solicitud ya fue respondida' };
      return { ok: true, nuevo: 'aprobada', efecto: d.tieneAusencia ? 'ninguno' : 'crear' };
    case 'rechazar':
      if (d.estado !== 'pendiente') return { ok: false, motivo: 'Esa solicitud ya fue respondida' };
      if (!motivoOk) return { ok: false, motivo: `Contale el motivo (al menos ${MIN_MOTIVO} caracteres)` };
      // Una ausencia que ya ocurrió queda registrada como no aprobada: la
      // persona igual faltó, y eso tiene que verse (y contar para el tope).
      return { ok: true, nuevo: 'rechazada', efecto: d.tieneAusencia && !d.empezo ? 'quitar' : 'ninguno' };
    case 'cancelar':
      if (d.estado === 'rechazada' || d.estado === 'cancelada') return { ok: false, motivo: 'Esa solicitud ya no está vigente' };
      if (d.esRrhh) {
        if (d.empezo && !motivoOk) return { ok: false, motivo: `Para anular una ausencia que ya empezó, contá el motivo (al menos ${MIN_MOTIVO} caracteres)` };
        return { ok: true, nuevo: 'cancelada', efecto: d.tieneAusencia ? 'quitar' : 'ninguno' };
      }
      if (!d.esDueno) return { ok: false, motivo: 'Solo podés cancelar tus propias solicitudes' };
      if (d.empezo) return { ok: false, motivo: 'Ya empezó: para cambiarla, hablalo con tu jefe o con RRHH' };
      return { ok: true, nuevo: 'cancelada', efecto: d.tieneAusencia ? 'quitar' : 'ninguno' };
  }
}

/** Texto corto del tipo, para avisos. */
export const NOMBRE_TIPO: Record<string, string> = {
  PERMISO: 'permiso', CITA_MEDICA: 'cita médica', VACACIONES: 'vacaciones', INCAPACIDAD: 'incapacidad',
};

/**
 * Las fechas de una solicitud en palabras, en la zona de la operación:
 * «el 20 oct de 09:00 a 10:00» (permiso, cita) o «del 26 al 30 oct».
 */
export function textoRango(tipo: string, startIso: string, endIso: string, tz: string): string {
  const dia = (iso: string) => new Intl.DateTimeFormat('es-CR', { timeZone: tz, day: 'numeric', month: 'short' }).format(new Date(iso)).replace('.', '');
  const hora = (iso: string) => new Intl.DateTimeFormat('es-CR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  if (tipo === 'PERMISO' || tipo === 'CITA_MEDICA') return `el ${dia(startIso)} de ${hora(startIso)} a ${hora(endIso)}`;
  const a = dia(startIso);
  const b = dia(endIso);
  if (a === b) return `el ${a}`;
  // Mismo mes: «del 26 al 30 oct».
  const [da, ma] = a.split(' ');
  const [, mb] = b.split(' ');
  return ma === mb ? `del ${da} al ${b}` : `del ${a} al ${b}`;
}

/** Cómo se nombra cada tipo y con qué concuerda («Tus vacaciones … fueron aprobadas»). */
const SUJETO: Record<string, { tu: string; titulo: string; plural: boolean; fem: boolean }> = {
  PERMISO: { tu: 'Tu permiso', titulo: 'Permiso', plural: false, fem: false },
  CITA_MEDICA: { tu: 'Tu cita médica', titulo: 'Cita médica', plural: false, fem: true },
  VACACIONES: { tu: 'Tus vacaciones', titulo: 'Vacaciones', plural: true, fem: true },
  INCAPACIDAD: { tu: 'Tu incapacidad', titulo: 'Incapacidad', plural: false, fem: true },
};
const sujeto = (tipo: string) => SUJETO[tipo] ?? { tu: 'Tu ausencia', titulo: 'Ausencia', plural: false, fem: true };
const participio = (raiz: string, s: { plural: boolean; fem: boolean }) => `${raiz}${s.fem ? 'a' : 'o'}${s.plural ? 's' : ''}`;

/** Las de días completos: llevan «del 23 oct», no «el 23 oct». */
const DE_DIAS = new Set(['VACACIONES', 'INCAPACIDAD']);

/**
 * «Tus vacaciones del 26 al 30 oct fueron aprobadas por Josué Rodríguez»,
 * «Tu permiso el 20 oct de 09:00 a 10:00 no fue aprobado por …: «motivo»».
 * Antes salía «Tu vacaciones el 23 oct fue aprobada».
 */
export function fraseResolucion(
  tipo: string, rango: string, estado: EstadoSolicitud, por: string, motivo?: string | null,
): string {
  const s = sujeto(tipo);
  const r = DE_DIAS.has(tipo) && rango.startsWith('el ') ? `del ${rango.slice(3)}` : rango;
  const fue = s.plural ? 'fueron' : 'fue';
  const verbo = estado === 'aprobada' ? `${fue} ${participio('aprobad', s)}`
    : estado === 'rechazada' ? `no ${fue} ${participio('aprobad', s)}`
    : `${fue} ${participio('cancelad', s)}`;
  return `${s.tu} ${r} ${verbo} por ${por}${motivo ? `: «${motivo}»` : ''}`;
}

/**
 * «Irene Salas registró tus vacaciones del 3 al 7 nov». Lo que RRHH carga por
 * otra persona nace aprobado; este es el aviso con el que la persona se entera.
 */
export function fraseCargada(tipo: string, rango: string, por: string): string {
  const s = sujeto(tipo);
  const r = DE_DIAS.has(tipo) && rango.startsWith('el ') ? `del ${rango.slice(3)}` : rango;
  return `${por} registró ${s.tu.charAt(0).toLowerCase()}${s.tu.slice(1)} ${r}`;
}

/**
 * A quién avisar un pedido: a su jefe directo; sin jefe, a RRHH, que es quien
 * lo aprueba. Antes, sin jefe no se avisaba a nadie y el pedido solo aparecía
 * en la bandeja (13-oct-2026). Nunca a quien lo pidió.
 */
export function aQuienAvisar(jefe: string | null, rrhh: string[], solicitanteId: string): { ids: string[]; esRrhh: boolean } {
  if (jefe) return { ids: [jefe], esRrhh: false };
  return { ids: [...new Set(rrhh)].filter(id => id !== solicitanteId), esRrhh: true };
}

/** El recordatorio de las 9:00: lo de su equipo, lo de quien no tiene jefe, o las dos cosas. */
export function textoRecordatorio(equipo: number, sinJefe: number): string {
  const n = equipo + sinJefe;
  const cuantas = n === 1 ? '1 solicitud' : `${n} solicitudes`;
  const de = sinJefe === 0 ? ' de tu equipo'
    : equipo === 0 ? (sinJefe === 1 ? ' de alguien sin jefe' : ' de personas sin jefe')
    : '';
  return `Tenés ${cuantas}${de} sin responder desde ayer`;
}

/** «1 día hábil», «medio día hábil», «3,5 días hábiles». */
export function textoDiasHabiles(n: number): string {
  if (n === 0.5) return 'medio día hábil';
  if (n === 1) return '1 día hábil';
  return `${String(n).replace('.', ',')} días hábiles`;
}

/** «lunes 26 oct 2026», de un instante (en la zona dada) o de una fecha `YYYY-MM-DD`. */
export function fechaLarga(v: string, tz: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00Z`) : new Date(v);
  const zona = /^\d{4}-\d{2}-\d{2}$/.test(v) ? 'UTC' : tz;
  return new Intl.DateTimeFormat('es-CR', { timeZone: zona, weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
    .format(d).replace(/\./g, '').replace(/,/g, '').replace(/ de /g, ' ');
}

/**
 * La ficha de una solicitud para el correo: los mismos campos del formulario
 * de papel de RRHH (desde, hasta, total de días, se reintegra, comentarios) y,
 * si ya se resolvió, quién y con qué motivo.
 */
export function fichaSolicitud(o: {
  nombre: string; tipo: string; startIso: string; endIso: string; tz: string;
  /** Solo las de días: desde `resumenRango`, con los feriados de la persona. */
  diasHabiles?: number | null; reintegro?: string | null;
  comentarios?: string | null;
  estado?: EstadoSolicitud; resolvio?: string | null; motivo?: string | null;
}): Array<[string, string]> {
  const filas: Array<[string, string]> = [['Colaborador', o.nombre], ['Tipo', sujeto(o.tipo).titulo]];
  if (DE_DIAS.has(o.tipo)) {
    filas.push(['Desde', fechaLarga(o.startIso, o.tz)], ['Hasta', fechaLarga(o.endIso, o.tz)]);
    if (o.diasHabiles != null) filas.push(['Total', textoDiasHabiles(o.diasHabiles)]);
    if (o.reintegro) filas.push(['Se reintegra', fechaLarga(o.reintegro, o.tz)]);
  } else {
    const hora = (iso: string) => new Intl.DateTimeFormat('es-CR', { timeZone: o.tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
    filas.push(['Fecha', fechaLarga(o.startIso, o.tz)], ['Horario', `${hora(o.startIso)} a ${hora(o.endIso)}`]);
  }
  if (o.comentarios?.trim()) filas.push(['Comentarios', o.comentarios.trim()]);
  if (o.estado && o.estado !== 'pendiente') {
    filas.push(['Estado', o.estado === 'aprobada' ? 'Aprobada' : o.estado === 'rechazada' ? 'No aprobada' : 'Cancelada']);
    if (o.resolvio) filas.push([o.estado === 'cancelada' ? 'Cancelada por' : 'Resuelta por', o.resolvio]);
    if (o.motivo?.trim()) filas.push(['Motivo', o.motivo.trim()]);
  }
  return filas;
}
