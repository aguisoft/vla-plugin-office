import type { Absence, Holiday, PendingInvite, UnavailableParticipant } from './types';

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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
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
  get:    <T>(path: string)                 => request<T>('GET',    path),
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

export const setHolidayOverride = (holidayId: string, body: { newDate: string; justification: string }) =>
  api.post<{ ok: true }>(`${PLUGIN}/holidays/${holidayId}/override`, body);

export const listInvites = () => api.get<PendingInvite[]>(`${PLUGIN}/meetings/invites`);

export const respondInvite = (id: string, action: 'accept' | 'decline') =>
  api.post<{ ok: true }>(`${PLUGIN}/meetings/invites/${id}/${action}`, {});

export const leaveMeeting = (meetingId: string) =>
  api.post<{ ok: true }>(`${PLUGIN}/meetings/${meetingId}/leave`, {});

export const getOrg = (userId: string) =>
  api.get<{ userId: string; managerUserId: string | null; country: string }>(`${PLUGIN}/org/${userId}`);

export const setOrg = (userId: string, body: { managerUserId?: string | null; country?: string | null }) =>
  api.put<{ ok: true }>(`${PLUGIN}/org/${userId}`, body);
