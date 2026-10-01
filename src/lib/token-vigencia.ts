/**
 * Cuándo refrescar el token de Bitrix de una persona, y si una conexión que
 * llega del core se puede guardar.
 */

/** Refrescar con margen: un token que vence en 30 s puede vencer en vuelo. */
export function necesitaRefresco(expiresAt: number, ahora: number, margenMs = 60_000): boolean {
  return expiresAt - ahora <= margenMs;
}

/** Bitrix responde así cuando la persona revocó el acceso o el refresh venció. */
export function esAccesoRevocado(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /invalid_grant/i.test(msg);
}

export type VeredictoConexion = 'ok' | 'otra_cuenta' | 'sin_mapeo';

/**
 * El core dice qué usuario de Bitrix autorizó. Si en ese navegador había otra
 * sesión de Bitrix abierta —la de un compañero en una compu compartida—, los
 * tokens son de ESA persona: guardarlos haría que Ana mande mensajes firmados
 * por Beto. Se compara contra el mapeo VLA ↔ Bitrix que ya mantiene el sync.
 */
export function validarConexion(
  bitrixDelMapeo: number | string | null | undefined,
  bitrixQueAutorizo: string | null | undefined,
): VeredictoConexion {
  if (bitrixDelMapeo === null || bitrixDelMapeo === undefined) return 'sin_mapeo';
  if (!bitrixQueAutorizo) return 'otra_cuenta';
  return String(bitrixDelMapeo) === String(bitrixQueAutorizo) ? 'ok' : 'otra_cuenta';
}
