import type {
  Absence, Department, Holiday, MapZone, PendingInvite, RosterUser, UnavailableParticipant,
  TimesheetOfficeResponse, TimesheetScope, TimesheetTeamResponse, Cumplimiento,
  SolicitudFeriado, EstadoSolicitud,
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
 * fecha PURA "YYYY-MM-DD" sin hora ni zona (ver DateRangeModal.tsx) -- el
 * servidor es quien la ancla a la zona de la operación. No conviertas estos
 * dos con `new Date(...).toISOString()` antes de llamar: eso reintroduce la
 * doble conversión de zona que corría la ausencia un día entero.
 */
export const createAbsence = (body: {
  type: string; startAt: string; endAt: string; justification?: string;
}) => api.post<{ id: string }>(`${PLUGIN}/absences`, body);

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

export const listMisSolicitudesFeriado = () =>
  api.get<SolicitudFeriado[]>(`${PLUGIN}/holidays/overrides/mine`);

/** La bandeja del jefe: lo que su gente pidió y él no respondió. */
export const listSolicitudesFeriadoPendientes = () =>
  api.get<SolicitudFeriado[]>(`${PLUGIN}/holidays/overrides/pending`);

export const decidirSolicitudFeriado = (id: string, accion: 'approve' | 'reject', note?: string) =>
  api.post<{ ok: true }>(`${PLUGIN}/holidays/overrides/${id}/${accion}`, { note: note ?? '' });

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
