const BASE = '/api/v1';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    // If inside an iframe, redirect the parent window; otherwise redirect self
    const target = window.parent !== window ? window.parent : window;
    target.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  get:    <T>(p: string)                 => request<T>('GET',    p),
  post:   <T>(p: string, b?: unknown)    => request<T>('POST',   p, b),
  patch:  <T>(p: string, b?: unknown)    => request<T>('PATCH',  p, b),
  put:    <T>(p: string, b?: unknown)    => request<T>('PUT',    p, b),
  delete: <T>(p: string)                 => request<T>('DELETE', p),
};
