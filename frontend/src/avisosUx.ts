/**
 * Lo que la campana necesita y se puede probar sin navegador: cuánto hace que
 * llegó un aviso, y en qué estado están los avisos del navegador.
 */

/** «ahora», «hace 5 min», «hace 3 h», «ayer», «hace 4 días», o la fecha. */
export function haceCuanto(iso: string, ahora: number): string {
  const min = Math.floor((ahora - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ayer';
  if (d < 7) return `hace ${d} días`;
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' }).replace('.', '');
}

/**
 * Los avisos del navegador: el core los pedía una sola vez en la vida y, si la
 * persona cerraba el cartel, no había forma de volver a activarlos (llegaban a
 * 8 de 22 personas). Desde la campana se ve el estado y se activan.
 */
export type EstadoNavegador = 'no-disponible' | 'bloqueado' | 'activo' | 'inactivo';

export function estadoNavegador(o: { soportado: boolean; permiso: NotificationPermission | null; suscrito: boolean }): EstadoNavegador {
  if (!o.soportado || o.permiso === null) return 'no-disponible';
  if (o.permiso === 'denied') return 'bloqueado';
  return o.permiso === 'granted' && o.suscrito ? 'activo' : 'inactivo';
}

/** La clave VAPID (base64url) como la pide `pushManager.subscribe`. */
export function claveABytes(base64url: string): Uint8Array {
  const relleno = '='.repeat((4 - (base64url.length % 4)) % 4);
  const b64 = (base64url + relleno).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
