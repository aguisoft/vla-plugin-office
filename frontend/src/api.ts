import type {
  Absence, Department, Holiday, MapZone, PendingInvite, RosterUser, UnavailableParticipant,
  TimesheetOfficeResponse, TimesheetScope, TimesheetTeamResponse, Cumplimiento,
  SolicitudFeriado, EstadoSolicitud, SolicitudAusencia, BandejaSolicitudes, Aviso, SaldoVacaciones,
} from './types';
// La forma de una persona del organigrama la define el módulo que arma el
// árbol, no `types.ts`: es él quien la consume y quien la tiene probada.
import type { PersonaChart } from './lib/org-tree';

const BASE = '/api/v1';

/**
 * Todas las rutas de este plugin cuelgan de /p/office (ver `vite.config.ts`
 * y las llamadas existentes en `App.tsx`/`BitrixSettings.tsx`). El plan de la
 * SDD que originó las funciones de más abajo las escribió sin este prefijo;
 * se corrige acá para que apunten a donde el backend real las monta.
 */
const PLUGIN = '/p/office';

/**
 * Error de una llamada a la API. `detail` es el cuerpo ya parseado de la
 * respuesta no-OK (cuando fue JSON parseable) para que la UI pueda mostrar el
 * mensaje real del backend en vez de un genérico "PATCH /x → 400".
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: unknown,
    method: string,
    path: string,
  ) {
    super(`${method} ${path} → ${status}`);
    this.name = 'ApiError';
  }
}

/**
 * `signal` es opcional y va al final para no tocar ninguna firma existente.
 * Sirve para cancelar una llamada en vuelo cuando la pantalla ya pidió otra
 * cosa -- ver `getOfficeTime` y el efecto de `TimesheetScreen`.
 */
async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      // Cuerpo no parseable (vacío, HTML, etc.): detail queda undefined y el
      // mensaje de ApiError cae en "`${method} ${path} → ${status}`". Nunca
      // debe tirar un error secundario mientras maneja el original.
      detail = undefined;
    }
    throw new ApiError(res.status, detail, method, path);
  }

  // 204/205 (p. ej. los DELETE de /absences/:id y /holidays/:id) no traen
  // cuerpo; res.json() explotaría. Cualquier otro cuerpo vacío se trata igual.
  if (res.status === 204 || res.status === 205) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get:    <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
  post:   <T>(path: string, body?: unknown) => request<T>('POST',   path, body),
  patch:  <T>(path: string, body?: unknown) => request<T>('PATCH',  path, body),
  put:    <T>(path: string, body?: unknown) => request<T>('PUT',    path, body),
  delete: <T>(path: string)                 => request<T>('DELETE', path),
};

export interface StatusPayload {
  status: string;
  justification?: string;
  startsAt?: string;
  endsAt?: string;
  participantIds?: string[];
}

/** Cuerpo de error de `PATCH /presence/status` (y validaciones en general). */
export interface StatusError {
  message: string;
  errors?: { field: string; message: string }[];
  unavailable?: UnavailableParticipant[];
}

export const setStatus = (payload: StatusPayload) =>
  api.patch<void>(`${PLUGIN}/presence/status`, payload);

/**
 * `startAt`/`endAt` cambian de forma según `type`: PERMISO manda un instante
 * real (ISO datetime, ver PermisoModal.tsx); VACACIONES/INCAPACIDAD mandan
 * fecha PURA "YYYY-MM-DD" sin hora ni zona (ver SolicitudDiasModal.tsx) -- el
 * servidor es quien la ancla a la zona de la operación. No conviertas estos
 * dos con `new Date(...).toISOString()` antes de llamar: eso reintroduce la
 * doble conversión de zona que corría la ausencia un día entero.
 */
export const createAbsence = (body: {
  type: string; startAt: string; endAt: string; justification?: string;
  /** Para otra persona (solo RRHH): nace aprobada. */
  userId?: string;
  /** Documentos de respaldo en base64; viajan con la solicitud. */
  adjuntos?: Array<{ nombre: string; tipo: string; contenido: string }>;
}) => api.post<{ id: string; solicitudId?: string; estado?: 'pendiente' | 'aprobada'; aprobadorId?: string | null; adjuntos?: Array<{ id: string; nombre: string }>; avisoAdjuntos?: string }>(`${PLUGIN}/absences`, body);

/** URL de descarga de un documento. El servidor decide si quien pide puede verlo. */
// ── Solicitudes de ausencia (con aprobación del jefe) ─────────────────────
export const listMisSolicitudes = () => api.get<SolicitudAusencia[]>(`${PLUGIN}/solicitudes/mias`);
/** Saldo de vacaciones: el propio, o (jefe/RRHH) el de otra persona. */
export const getSaldoVacaciones = (userId?: string) =>
  api.get<SaldoVacaciones>(`${PLUGIN}/vacaciones/saldo${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`);
/** RRHH carga los días que la persona tiene hoy (sin contar lo ya aprobado en la oficina desde hoy). */
export const cargarSaldoVacaciones = (userId: string, dias: number, motivo: string) =>
  api.put<SaldoVacaciones>(`${PLUGIN}/vacaciones/saldo/${encodeURIComponent(userId)}`, { dias, motivo });
/** Las de otra persona (solo RRHH: Administrar → Ausencias). */
export const listSolicitudesDe = (userId: string) => api.get<SolicitudAusencia[]>(`${PLUGIN}/solicitudes/de/${encodeURIComponent(userId)}`);
export const getBandejaSolicitudes = () => api.get<BandejaSolicitudes>(`${PLUGIN}/solicitudes/bandeja`);

/** Días hábiles, reintegro, feriados del rango y quién aprueba (formulario de vacaciones). Fechas `YYYY-MM-DD`. */
export interface ResumenAusencia {
  diasHabiles: number;
  diasCorridos: number;
  reintegro: string;
  /** Lo que trabaja la persona el sábado: 0, 0.5 o 1. */
  sabado: number;
  feriados: Array<{ fecha: string; nombre: string }>;
  aprobador: { id: string; nombre: string } | null;
}
/** Con `userId` (solo RRHH), los días de otra persona: su sábado y sus feriados. */
export const getResumenAusencia = (desde: string, hasta: string, userId?: string) =>
  api.get<ResumenAusencia>(`${PLUGIN}/absences/resumen?desde=${desde}&hasta=${hasta}${userId ? `&userId=${encodeURIComponent(userId)}` : ''}`);

// ── Avisos: la campana ───────────────────────────────────────────────────────
export const getAvisos = () => api.get<{ avisos: Aviso[]; sinLeer: number }>(`${PLUGIN}/avisos`);
/** Sin ids, todos. */
export const marcarAvisosLeidos = (ids?: string[]) => api.post<{ marcados: number }>(`${PLUGIN}/avisos/leer`, ids ? { ids } : {});
export const getClaveNavegador = () => api.get<{ clave: string | null }>(`${PLUGIN}/avisos/clave-navegador`);
/** Ruta del core: es él quien manda los avisos del navegador. */
export const suscribirNavegador = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) => api.post<unknown>('/push/subscribe', sub);
export const responderSolicitud = (id: string, accion: 'aprobar' | 'rechazar', motivo?: string) =>
  api.post<SolicitudAusencia>(`${PLUGIN}/solicitudes/${id}/${accion}`, { motivo: motivo ?? '' });
export const cancelarSolicitud = (id: string, motivo?: string) =>
  api.post<SolicitudAusencia>(`${PLUGIN}/solicitudes/${id}/cancelar`, { motivo: motivo ?? '' });

export const urlAdjunto = (id: string) => `${BASE}${PLUGIN}/absences/adjuntos/${id}`;

export const listAbsences = (userId?: string) =>
  api.get<Absence[]>(`${PLUGIN}/absences${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`);

export const deleteAbsence = (id: string) => api.delete<void>(`${PLUGIN}/absences/${id}`);

export const listHolidays = (year?: number, country?: string) => {
  const params = new URLSearchParams();
  if (year) params.set('year', String(year));
  if (country) params.set('country', country);
  const qs = params.toString();
  return api.get<Holiday[]>(`${PLUGIN}/holidays${qs ? `?${qs}` : ''}`);
};

export const listMovableHolidays = () => api.get<Holiday[]>(`${PLUGIN}/holidays/movable`);

export const createHoliday = (body: { date: string; name: string; country: string }) =>
  api.post<{ id: string }>(`${PLUGIN}/holidays`, body);

export const deleteHoliday = (id: string) => api.delete<void>(`${PLUGIN}/holidays/${id}`);

/**
 * Pide mover un feriado. Devuelve el estado con que quedó: `PENDING` si tiene
 * jefe que la revise, `APPROVED` si no lo tiene. La pantalla necesita saber
 * cuál de los dos para no prometer una aprobación que nadie va a dar.
 */
export const setHolidayOverride = (holidayId: string, body: { newDate: string; justification: string }) =>
  api.post<{ ok: true; status: EstadoSolicitud }>(`${PLUGIN}/holidays/${holidayId}/override`, body);

/**
 * El organigrama. Endpoint aparte de `/org/roster` (que exige office.manage)
 * porque este lo puede ver cualquiera: trae solo nombre, jefe y
 * departamento, sin correos ni el origen de cada dato.
 */
export const getOrgChart = () =>
  api.get<{ personas: PersonaChart[] }>(`${PLUGIN}/org/chart`);

/** Retira un pedido pendiente (solo antes del feriado; el servidor lo verifica). */
export const retirarSolicitudFeriado = (holidayId: string) =>
  api.delete<void>(`${PLUGIN}/holidays/${holidayId}/override`);

export const listMisSolicitudesFeriado = () =>
  api.get<SolicitudFeriado[]>(`${PLUGIN}/holidays/overrides/mine`);

/** La bandeja del jefe: lo que su gente pidió y él no respondió. */
export const listSolicitudesFeriadoPendientes = () =>
  api.get<SolicitudFeriado[]>(`${PLUGIN}/holidays/overrides/pending`);

export const decidirSolicitudFeriado = (id: string, accion: 'approve' | 'reject', note?: string) =>
  api.post<{ ok: true }>(`${PLUGIN}/holidays/overrides/${id}/${accion}`, { note: note ?? '' });

/** «Tu almuerzo terminó a las …»: lo deja office cuando un estado vence solo. */

export const listInvites = () => api.get<PendingInvite[]>(`${PLUGIN}/meetings/invites`);

export const respondInvite = (id: string, action: 'accept' | 'decline') =>
  api.post<{ ok: true }>(`${PLUGIN}/meetings/invites/${id}/${action}`, {});

export const getOrg = (userId: string) =>
  api.get<{ userId: string; managerUserId: string | null; country: string }>(`${PLUGIN}/org/${userId}`);

/**
 * Fija o limpia los overrides de una persona. Omitir una clave la deja como
 * está; mandarla en `null` la limpia. La distinción importa: mandar el país
 * solo no puede borrar el departamento que alguien ya corrigió.
 */
export const setOrg = (
  userId: string,
  body: {
    managerUserId?: string | null; country?: string | null;
    departmentId?: string | null; zoneId?: string | null;
    /** Lo que trabaja el sábado: 0, 0.5 o 1. */
    sabado?: number;
  },
) => api.put<{ ok: true }>(`${PLUGIN}/org/${userId}`, body);

export const listDepartments = () =>
  api.get<{ departments: Department[] }>(`${PLUGIN}/org/departments`);

export const getOrgRoster = () =>
  api.get<{ defaultCountry: string; zones: MapZone[]; users: RosterUser[] }>(`${PLUGIN}/org/roster`);

/** A quién puede consultar el viewer en la pantalla de Tiempos: a sí mismo y a su gente a cargo. */
export const getTimesheetScope = () =>
  api.get<TimesheetScope>(`${PLUGIN}/timesheet/scope`);

/**
 * Tiempo en oficina recortado por período. `anchor` es un `YYYY-MM-DD` local
 * (ver `PeriodPicker`); el backend resuelve el rango `from`/`to` a partir de
 * ahí. Sin `userId` el backend asume al viewer.
 *
 * Acepta `signal` porque cambiar de persona con una respuesta en vuelo puede
 * pintar el tiempo de A bajo el nombre de B -- una conclusión falsa sobre una
 * persona, que es justo lo que esta pantalla existe para evitar.
 */
export const getOfficeTime = (period: string, anchor: string, userId?: string, signal?: AbortSignal) => {
  const qs = new URLSearchParams({ period, anchor });
  if (userId) qs.set('userId', userId);
  return api.get<TimesheetOfficeResponse>(`${PLUGIN}/timesheet/office?${qs}`, signal);
};

/**
 * Filas del equipo (uno por persona a cargo, más el propio jefe) y las
 * excepciones del período, recortadas al alcance del viewer -- ver
 * `resolveScope` en el backend. Mismo patrón de `anchor`/`signal` que
 * `getOfficeTime`.
 */
export const getTimesheetTeam = (period: string, anchor: string, signal?: AbortSignal) => {
  const qs = new URLSearchParams({ period, anchor });
  return api.get<TimesheetTeamResponse>(`${PLUGIN}/timesheet/team?${qs}`, signal);
};

/**
 * Reporte de cumplimiento de toda la organización -- solo `office.manage`.
 * Mismo patrón de `anchor`/`signal` que `getTimesheetTeam`.
 */
export const getCompliance = (period: string, anchor: string, signal?: AbortSignal) => {
  const qs = new URLSearchParams({ period, anchor });
  return api.get<Cumplimiento>(`${PLUGIN}/timesheet/compliance?${qs}`, signal);
};

/**
 * URL de la descarga del CSV -- no pasa por `api.get` porque el navegador
 * abre esto directo (`window.location` / un `<a href>`), no un `fetch` que
 * parsee JSON.
 */
export const complianceExportUrl = (period: string, anchor: string) => {
  const qs = new URLSearchParams({ period, anchor });
  return `${BASE}${PLUGIN}/timesheet/export?${qs}`;
};

// ── Bitrix por persona y app de escritorio ───────────────────────────────────

export interface EstadoBitrix {
  conectado: boolean;
  desde?: string;
  rechazo?: 'otra_cuenta' | 'sin_mapeo';
}

export const getEstadoBitrix = () => api.get<EstadoBitrix>(`${PLUGIN}/bitrix/oauth/estado`);
export const desconectarBitrix = () => api.delete<{ ok: true }>(`${PLUGIN}/bitrix/oauth`);

/**
 * Se navega, no se pide por fetch: termina en la pantalla de Bitrix. Va en la
 * ventana de arriba porque la oficina corre dentro de un iframe y Bitrix no se
 * deja mostrar enmarcado.
 */
export const conectarBitrixUrl = `${BASE}${PLUGIN}/bitrix/oauth/start`;

/** Ruta del core, no del plugin: es el core quien emite el token del escritorio. */
export const confirmarDispositivo = (userCode: string) =>
  api.post<{ ok: true }>('/auth/device/confirm', { userCode });

// ── App de escritorio: ofrecerla y saber si ya la tiene ──────────────────────

/** ¿Tiene la app? Y lo publicado (versión, tamaño), para ofrecerla. */
export const getEscritorioMio = () => api.get<import('./lib/escritorio').UsoEscritorio>(`${PLUGIN}/escritorio/mio`);

/** Se navega (un <a download>): la cookie de sesión autoriza la descarga. */
export const descargaEscritorioUrl = `${BASE}${PLUGIN}/escritorio/descarga`;

// ── La planta de la oficina ──────────────────────────────────────────────────

export interface Planta {
  estado: 'feliz' | 'sed' | 'marchita' | 'seca';
  horasSinAgua: number | null;
  puedeRegar: boolean;
  seriaRescate: boolean;
  ultimoRiegoPor: string | null;
  /** Cuándo fue el último riego (ISO). */
  ultimoRiegoEn?: string | null;
  misRiegos: number;
  fueRescate?: boolean;
}

export const getPlanta = () => api.get<Planta>(`${PLUGIN}/planta`);

/** El servidor vuelve a comprobar si se puede regar: devuelve 409 si alguien se adelantó. */
export const regarPlanta = () => api.post<Planta>(`${PLUGIN}/planta/regar`, {});

/**
 * Consumo del mes contra los topes (permiso largo y cita médica). Sin
 * `userId` responde por el viewer; con él, solo si lo tiene a cargo.
 */
export const getUsoAusencias = (userId?: string, anio?: number, mes?: number) => {
  const qs = new URLSearchParams();
  if (userId) qs.set('userId', userId);
  if (anio) qs.set('anio', String(anio));
  if (mes) qs.set('mes', String(mes));
  const q = qs.toString();
  return api.get<import('./types').UsoAusencias>(`${PLUGIN}/absences/usage${q ? `?${q}` : ''}`);
};
