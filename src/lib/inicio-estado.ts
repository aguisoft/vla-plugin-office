/**
 * Desde cuándo corre un estado del día con cronómetro (vuelvo pronto, almuerzo).
 *
 * El cronómetro de la tarjeta cuenta desde `statusStartsAt`. La web lo manda,
 * pero el menú de la bandeja de la app de escritorio manda solo el estado: el
 * 7-oct-2026 Ramiro marcó «Vuelvo pronto» desde la app y su tarjeta no mostraba
 * el cronómetro. Si no viene inicio, el estado empieza ahora.
 */
const CON_CRONOMETRO = new Set(['BRB', 'LUNCH']);

export function inicioDelEstado(status: string, startsAt: Date | null | undefined, ahora: Date): Date | null {
  if (startsAt) return startsAt;
  return CON_CRONOMETRO.has(status) ? ahora : null;
}
