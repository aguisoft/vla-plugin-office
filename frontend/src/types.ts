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
  /** Estado resuelto: ya incluye ausencias y feriados. */
  status: string;
  /** PresenceStatus.status sin resolver. Para diagnosticar. */
  rawStatus: string;
  /** El estado viene de una ausencia o feriado; el avatar se pinta igual. */
  isAbsent: boolean;
  statusMessage?: string;
  /** Ausente si el viewer no tiene permiso de verla. */
  justification?: string;
  statusStartsAt?: string;
  statusEndsAt?: string;
  absenceEndsAt?: string;
  meetingId?: string;
  meetingWith?: { userId: string; firstName: string; lastName: string }[];
  currentZoneId?: string;
  defaultZoneId?: string;
  positionX?: number;
  positionY?: number;
  lastActivityAt: string;
  checkedInAt?: string;
  photoUrl?: string;
  avatar: AvatarCfg | null;
}

export interface Absence {
  id: string;
  userId: string;
  type: 'PERMISO' | 'VACACIONES' | 'INCAPACIDAD';
  startAt: string;
  endAt: string;
  justification?: string;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  country: string;
}

export interface PendingInvite {
  id: string;
  meetingId: string;
  hostId: string;
  hostName: string;
  justification: string | null;
  expiresAt: string;
}

export interface UnavailableParticipant {
  userId: string;
  name: string;
  reason: string;
  until: string | null;
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

/**
 * Colaborador con su país y jefe resueltos, y de dónde salen esos datos, tal
 * como lo devuelve `GET /org/roster`. El `countrySource` y `managerSource`
 * distinguen un dato cargado por RRHH de uno que es automático (Bitrix) o de
 * respaldo del plugin.
 */
export interface RosterUser {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  country: string | null;
  countrySource: 'override' | 'bitrix' | 'default';
  managerUserId: string | null;
  managerSource: 'override' | 'bitrix' | 'none';
  departmentId: string | null;
  /** Nombre del catálogo; cae al ID si el sync todavía no lo trajo. */
  departmentName: string | null;
  departmentSource: 'override' | 'bitrix' | 'none';
  /** Zona del mapa donde se dibuja el avatar. Independiente del departamento. */
  zoneId: string | null;
  zoneName: string | null;
  /** 'sugerida' = calzó por nombre con el departamento, nadie la confirmó. */
  zoneSource: 'fijada' | 'sugerida' | 'none';
}

/** Una zona del mapa de la oficina, tal como la entrega `GET /org/roster`. */
export interface MapZone {
  id: string;
  name: string;
}

/** Un departamento del organigrama, tal como lo entrega `GET /org/departments`. */
export interface Department {
  id: string;
  name: string;
  /** Cuánta gente tiene hoy, contando los overrides. */
  headcount: number;
}

/** Un día del recorte de tiempo en oficina, tal como lo entrega `GET /timesheet/office`. */
export interface OfficeDay {
  date: string;
  minutes: number;
}

/** Un tramo del desglose por estado: cuántos minutos pasó en ese estado dentro del período. */
export interface StatusSlice {
  status: string;
  minutes: number;
}

/**
 * Ausencias del período agrupadas por tipo, tal como las devuelve
 * `GET /timesheet/office`. No salen de `breakdown`: las ausencias no viven en
 * `PresenceStatus` (el snapshot las calcula al vuelo), así que necesitan su
 * propio campo en la respuesta.
 */
export interface AbsenceTally {
  type: string;
  /** Días completos que toca, solo para las de día completo (VACACIONES/INCAPACIDAD). PERMISO siempre da 0. */
  days: number;
  minutes: number;
}

export interface TimesheetOfficeResponse {
  period: 'day' | 'week' | 'month';
  from: string;
  to: string;
  office: {
    userId: string;
    totalMinutes: number;
    byDay: OfficeDay[];
    /**
     * `true` si alguna sesión sin marcar salida se acotó a `openSessionCapHours`.
     * Acotar en silencio es tan malo como no acotar: el total cambia y nadie
     * sabe por qué.
     */
    openSessionCapped?: boolean;
    /** Horas a las que se acotó la sesión abierta. */
    openSessionCapHours?: number;
  };
  /** Desglose por estado dentro del período. Junto con `unaccountedMinutes` suma `office.totalMinutes`. */
  breakdown: StatusSlice[];
  /** Minutos conectados sin estado capturado en el historial -- lo que el desglose no alcanza a explicar. */
  unaccountedMinutes: number;
  /**
   * Cuánto sumaban los estados por encima del tiempo conectado antes del
   * reescalado proporcional. `> 0` es una inconsistencia real entre las dos
   * fuentes (intervalos registrados fuera de toda sesión), no un redondeo.
   */
  overflowMinutes?: number;
  /**
   * `true` cuando el backend no pudo leer la tabla de intervalos (migración sin
   * aplicar, base caída). Distinto de `breakdown: []`, que significa "no hubo
   * intervalos": sin este flag, un fallo de infraestructura se dibujaría como
   * un gráfico 100% "sin registrar", o sea como si la persona no hubiera hecho
   * nada.
   */
  breakdownUnavailable?: boolean;
  /** Desde cuándo el backend tiene historial de estados. `null` si todavía no hay ninguno. */
  coverageStart: string | null;
  /** Ausencias del período. Los feriados NO están incluidos -- ver TimesheetScreen. */
  absences: AbsenceTally[];
}

/**
 * A quién puede consultar el viewer: a sí mismo siempre, y a su gente a cargo
 * si tiene reportes directos. `isAdmin` no se usa hoy en la UI -- lo trae el
 * backend por si una vista futura necesita distinguir el bypass total.
 */
export interface TimesheetScope {
  viewerId: string;
  isAdmin: boolean;
  users: Array<{ id: string; firstName: string; lastName: string; email: string }>;
}

/**
 * Estado de una fila de la tabla del equipo, tal como la entrega
 * `GET /timesheet/team`. Son TRES valores, no dos:
 * - `con-registro`: la persona marcó y el total es real.
 * - `sin-registrar`: la persona no marcó -- un hecho sobre la persona.
 * - `no-disponible`: el backend no pudo leer `CheckInRecord` -- un hecho
 *   sobre el sistema, no sobre la persona. Confundir este valor con
 *   `sin-registrar` en la interfaz le atribuye a alguien una conducta que no
 *   tuvo, que es justo el defecto que esta tabla existe para evitar.
 */
export type EstadoFila = 'con-registro' | 'sin-registrar' | 'no-disponible';

/**
 * Variación del período actual contra la norma personal (nunca contra el
 * equipo). `sin-base` cuando no hay suficiente historial o la norma es cero;
 * `destacar` distingue una fluctuación normal (se muestra el número, sin
 * flecha ni color) de una que vale la pena señalar.
 */
export type Variacion =
  | { tipo: 'sin-base' }
  | { tipo: 'calculada'; pct: number; destacar: boolean };

/** Una fila de la tabla del equipo, tal como la entrega `GET /timesheet/team`. */
export interface FilaEquipo {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  estado: EstadoFila;
  totalMinutes: number;
  openSessionCapped: boolean;
  variacion: Variacion;
  diasConRegistro: number;
  diasHabiles: number;
  /**
   * Cuántos de `diasConRegistro` cayeron fuera de lunes-viernes (I6).
   * `diasConRegistro` sigue contando TODOS los días con sesión -- no se
   * esconde el trabajo de fin de semana -- así que la interfaz resta este
   * valor para armar el numerador que sí comparte universo con
   * `diasHabiles`, y muestra el fin de semana aparte.
   */
  diasFueraDeHabiles: number;
  entradaHabitual: string | null;
  /** YYYY-MM-DD local. `null` = de verdad nunca marcó. Ver `ultimoDisponible`. */
  ultimoRegistro: string | null;
  /** `false` = no se pudo leer el último registro; `ultimoRegistro: null` ahí NO significa "nunca". */
  ultimoDisponible: boolean;
}

/** Excepciones del equipo: quién no ha marcado en 30 días y quién tiene una sesión abierta vieja. */
export interface Excepciones {
  sinMarcar30Dias: Array<{ userId: string; nombre: string }>;
  sesionesAbiertas: Array<{ userId: string; nombre: string; desde: string }>;
}

/** Una celda de la matriz de cobertura horaria, tal como la entrega `GET /timesheet/team`. */
export interface Celda {
  fecha: string;
  hora: number;
  personas: number;
}

/**
 * Matriz de cobertura horaria del equipo: cuánta gente distinta estaba
 * conectada en cada combinación de fecha local y hora local.
 *
 * `horaMin`/`horaMax` se derivan de los datos, no de una constante -- un
 * turno de 22:00 a 02:00 no desaparece por caer fuera de un horario de
 * oficina supuesto de antemano. `fechas: []` (y `celdas: []`) significa que
 * nadie tuvo sesiones en el período: la interfaz no dibuja nada, ver
 * `CoverageMap`.
 */
export interface Matriz {
  horaMin: number;
  horaMax: number;
  fechas: string[];
  celdas: Celda[];
}

export interface TimesheetTeamResponse {
  period: 'day' | 'week' | 'month';
  from: string;
  to: string;
  viewerId: string;
  isAdmin: boolean;
  filas: FilaEquipo[];
  excepciones: Excepciones;
  cobertura: Matriz;
  /**
   * `true` cuando el período consultado todavía no ocurrió (se llega
   * navegando con «›»). Distinto de `filas: []`: sin esta bandera, la
   * pantalla mostraría a todo el equipo como «sin registrar» en una semana
   * futura — una afirmación sobre la conducta de gente en un período que
   * no existe.
   */
  periodoFuturo?: boolean;
}

/**
 * Reporte de cumplimiento de TODA la organización, tal como lo entrega
 * `GET /timesheet/compliance` (solo `office.manage`).
 *
 * Cada campo es `null` cuando esa fuente en particular no se pudo leer --
 * NUNCA `0` ni un arreglo vacío, que en esta pantalla se leería como "está
 * todo bien" cuando en realidad nadie pudo comprobarlo. `ComplianceTab` lo
 * muestra literalmente como «no disponible». Ver `compliance.service.ts`
 * en el backend para el detalle de qué fuente alimenta cada campo.
 */
export interface Cumplimiento {
  sinMarcar30Dias: Array<{ userId: string; nombre: string; departamento: string | null }> | null;
  sesionesAbiertas: Array<{ userId: string; nombre: string; desde: string }> | null;
  sinJefe: Array<{ userId: string; nombre: string }> | null;
  sinDepartamento: Array<{ userId: string; nombre: string }> | null;
  feriadosCargados: number | null;
  ausenciasDelPeriodo: number | null;
  historialEstadosDesde: string | null;
  /**
   * `departamentoId` es `null` para la fila sintética "(sin departamento)" y
   * es la `key` de React de cada fila -- dos departamentos homónimos dan dos
   * filas con el mismo `departamento` pero distinto `departamentoId`, y una
   * `key` basada en el nombre las confundiría.
   */
  porDepartamento: Array<{ departamentoId: string | null; departamento: string; total: number; sinMarcar: number }> | null;
}
