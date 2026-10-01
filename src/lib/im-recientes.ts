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

/**
 * Agrega los diálogos con mensajes sin leer que `im.recent.get` no trajo.
 *
 * En producción (1-oct-2026) había 5 diálogos sin leer y la lista traía 2: Bitrix
 * deja ocultar una conversación de «recientes» y el contador sigue contando.
 * Un mensaje sin leer que no se ve en ningún lado es peor que no tener widget.
 *
 * `usuarios` es la respuesta de `im.user.list.get` (objeto por id). Van primero:
 * son justamente los que la persona no está viendo.
 */
export function completarSinLeer(base: any[], contadores: unknown, usuarios: unknown): any[] {
  const dialogos = (contadores as any)?.DIALOG;
  if (!dialogos || typeof dialogos !== 'object') return base;
  const presentes = new Set(base.map(b => String(b.id)));
  const u = (usuarios && typeof usuarios === 'object' ? usuarios : {}) as Record<string, any>;
  const extra = Object.entries(dialogos)
    .filter(([id, n]) => Number(n) > 0 && !presentes.has(id))
    .map(([id, n]) => ({
      id,
      type: 'user',
      title: u[id]?.name || 'Conversación sin nombre',
      avatar: { url: u[id]?.avatar || '', color: u[id]?.color || null },
      counter: Number(n),
      message: null,
      oculta: true,
    }));
  return [...extra, ...base];
}

/** Ids de diálogos sin leer que faltan, para pedir sus nombres. Con tope. */
export function idsSinLeerFaltantes(base: any[], contadores: unknown, tope = 20): number[] {
  const dialogos = (contadores as any)?.DIALOG;
  if (!dialogos || typeof dialogos !== 'object') return [];
  const presentes = new Set(base.map(b => String(b.id)));
  return Object.entries(dialogos)
    .filter(([id, n]) => Number(n) > 0 && !presentes.has(id) && /^\d+$/.test(id))
    .slice(0, tope)
    .map(([id]) => Number(id));
}
