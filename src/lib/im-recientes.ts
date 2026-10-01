/**
 * Las conversaciones recientes que tiene sentido mostrar en el widget.
 *
 * `im.recent.get` devuelve una cantidad limitada de ítems, y en producción
 * (1-oct-2026) 225 de 234 eran chats de TAREAS (`chat.type = 'tasksTask'`, uno
 * por cada tarea con comentarios). Ocupaban la lista y dejaban afuera
 * conversaciones directas sin leer: había 5 con mensajes nuevos y la lista
 * mostraba 2.
 *
 * Por eso se piden por separado los diálogos directos y los chats, y de los
 * chats se descartan los de tareas. Sus avisos van por la campana de Bitrix,
 * no por la mensajería.
 */

const TIPOS_DE_CHAT_EXCLUIDOS = new Set(['tasksTask']);

export function esConversacion(item: any): boolean {
  if (!item || item.id == null) return false;
  if (item.type === 'user') return true;
  if (item.type === 'chat') return !TIPOS_DE_CHAT_EXCLUIDOS.has(item.chat?.type);
  return false;
}

/** Junta las dos consultas, sin repetidos y sin chats de tareas. */
export function unirRecientes(...listas: unknown[]): any[] {
  const vistos = new Set<string>();
  const salida: any[] = [];
  for (const lista of listas) {
    if (!Array.isArray(lista)) continue;
    for (const it of lista) {
      if (!esConversacion(it)) continue;
      const id = String(it.id);
      if (vistos.has(id)) continue;
      vistos.add(id);
      salida.push(it);
    }
  }
  return salida;
}
