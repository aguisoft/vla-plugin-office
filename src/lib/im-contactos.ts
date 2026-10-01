/**
 * Compañeros a quienes escribir desde el widget: los del equipo que tienen
 * usuario de Bitrix (sin eso no hay a qué diálogo mandar), con su estado
 * resuelto para saber si conviene escribir ahora o si va a tardar en contestar.
 */

export interface Contacto {
  userId: string;
  nombre: string;
  /** DIALOG_ID para escribirle por Bitrix. */
  bitrixUserId: string;
  /** Estado resuelto: ya incluye ausencias y feriados. */
  status: string;
  /** Marcó entrada a la oficina. */
  enOficina: boolean;
  /** Hasta cuándo dura ese estado (almuerzo, ausencia), si se sabe. ISO. */
  hasta: string | null;
  /** Justificación visible para cualquiera (concentrado, en reunión…). */
  detalle: string | null;
}

interface Persona {
  userId: string;
  firstName: string;
  lastName: string;
  status: string;
  isCheckedIn?: boolean;
  statusEndsAt?: string;
  absenceEndsAt?: string;
  justification?: string;
}

export function armarContactos(personas: Persona[], mapeos: Array<{ userId: string; bitrixUserId: number }>, yo: string): Contacto[] {
  const bitrix = new Map(mapeos.map(m => [m.userId, String(m.bitrixUserId)]));
  return personas
    .filter(p => p.userId !== yo && bitrix.has(p.userId))
    .map(p => ({
      userId: p.userId,
      nombre: `${p.firstName} ${p.lastName}`.trim(),
      bitrixUserId: bitrix.get(p.userId)!,
      status: p.status,
      enOficina: !!p.isCheckedIn,
      hasta: p.absenceEndsAt ?? p.statusEndsAt ?? null,
      detalle: p.justification ?? null,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}
