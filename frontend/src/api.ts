const BASE = '/api/v1';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  get:   <T>(path: string)                   => request<T>('GET',   path),
  post:  <T>(path: string, body?: unknown)   => request<T>('POST',  path, body),
  patch: <T>(path: string, body?: unknown)   => request<T>('PATCH', path, body),
};
