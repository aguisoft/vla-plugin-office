/**
 * Quiénes de una lista de usuarios de Bitrix están en la oficina y pueden
 * atender ahora. Lo usa el asistente de ventas (por el filtro
 * `office.presencia.disponibles`) para decidir si una conversación del Canal
 * Abierto va a un asesor o la atiende él.
 *
 * Atiende: en la oficina, en Disponible o Concentrado, sin ausencia ni
 * feriado. Almuerzo, Vuelvo pronto y las reuniones no cuentan.
 */
const ATIENDEN = new Set(['AVAILABLE', 'FOCUS']);

export interface PersonaPresencia {
  bitrixUserId: string;
  isCheckedIn: boolean;
  status: string;
  ausente: boolean;
}

export function disponibles(personas: PersonaPresencia[], bitrixUserIds: string[]): string[] {
  const pedidos = new Set(bitrixUserIds.map(String));
  return personas
    .filter(p => pedidos.has(p.bitrixUserId) && p.isCheckedIn && !p.ausente && ATIENDEN.has(p.status))
    .map(p => p.bitrixUserId);
}
