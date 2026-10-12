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
