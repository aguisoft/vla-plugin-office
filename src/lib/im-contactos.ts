/**
 * Compañeros a quienes escribir desde el widget: los del equipo que tienen
 * usuario de Bitrix (sin eso no hay a qué diálogo mandar), con su estado
 * resuelto para saber si conviene escribir ahora.
 */

export interface Contacto {
  userId: string;
  nombre: string;
  /** DIALOG_ID para escribirle por Bitrix. */
  bitrixUserId: string;
  status: string;
}

export function armarContactos(
  personas: Array<{ userId: string; firstName: string; lastName: string; status: string }>,
  mapeos: Array<{ userId: string; bitrixUserId: number }>,
  yo: string,
): Contacto[] {
  const bitrix = new Map(mapeos.map(m => [m.userId, String(m.bitrixUserId)]));
  return personas
    .filter(p => p.userId !== yo && bitrix.has(p.userId))
    .map(p => ({
      userId: p.userId,
      nombre: `${p.firstName} ${p.lastName}`.trim(),
      bitrixUserId: bitrix.get(p.userId)!,
      status: p.status,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}
