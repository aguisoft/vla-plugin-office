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

/**
 * Lo mismo para los GRUPOS: el 2-oct-2026 el widget marcaba 3 sin leer y la
 * lista no mostraba ninguno. Eran de un chat de junio («Nadege Cesar») que
 * Bitrix no traía en recientes pero seguía contando. Devuelve los `chatN` que
 * faltan, con tope: cada uno cuesta una llamada a Bitrix.
 */
export function chatsSinLeerFaltantes(base: any[], contadores: unknown, tope = 5): string[] {
  const chats = (contadores as any)?.CHAT;
  if (!chats || typeof chats !== 'object') return [];
  const presentes = new Set(base.map(b => String(b.id)));
  return Object.entries(chats)
    .filter(([id, n]) => Number(n) > 0 && /^\d+$/.test(id) && !presentes.has(`chat${id}`))
    .slice(0, tope)
    .map(([id]) => `chat${id}`);
}

/**
 * Los grupos que faltan, armados como ítems de `im.recent.get` con lo que da
 * `im.dialog.get` de cada uno. Van primero, como los diálogos ocultos. Los de
 * tareas no: Bitrix los cuenta aparte y llenaban la lista.
 */
export function completarChatsSinLeer(base: any[], contadores: unknown, datos: Array<{ dialogId: string; info: any }>): any[] {
  const chats = ((contadores as any)?.CHAT ?? {}) as Record<string, unknown>;
  const extra = datos
    .filter(d => d.info && !TIPOS_DE_CHAT_EXCLUIDOS.has(d.info.type))
    .map(({ dialogId, info }) => ({
      id: dialogId,
      type: 'chat',
      title: String(info.name || 'Grupo sin nombre'),
      avatar: { url: info.avatar || '', color: info.color || null },
      counter: Number(chats[dialogId.slice(4)]) || 0,
      message: null,
      chat: { type: info.type ?? null, mute_list: info.mute_list ?? [] },
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

/**
 * ¿Cuenta como alguien con quien conversar? Una cuenta desactivada en Bitrix
 * (gente que ya no está) no: en producción (1-oct-2026) había 4 diálogos «sin
 * leer» de cuentas desactivadas —tres con el saludo automático de Bitrix del
 * 22-dic-2025— que aparecían en la lista e inflaban el número para siempre.
 * Solo cuenta como desactivada si Bitrix lo DICE (`active: false`): a una
 * cuenta desactivada la sigue devolviendo. Antes, si no la devolvía por
 * cualquier motivo, sus mensajes quedaban 6 h fuera del número y de los avisos
 * (revisión del 2-oct-2026): esconder un mensaje real es peor que mostrar de más.
 */
export function cuentaActiva(usuario: any): boolean {
  return !usuario || usuario.active !== false;
}

/**
 * Los contadores de `im.counters.get` sin los diálogos de cuentas desactivadas.
 * Se recalcula `TYPE.DIALOG`, que es de donde salen el número del widget y la
 * consulta de respaldo de avisos.
 */
export function ajustarContadores(contadores: any, activo: (id: string) => boolean): any {
  const dialogos = contadores?.DIALOG;
  if (!dialogos || typeof dialogos !== 'object') return contadores;
  const quedan = Object.fromEntries(Object.entries(dialogos).filter(([id]) => activo(id)));
  const total = Object.values(quedan).reduce((s: number, n) => s + (Number(n) || 0), 0);
  return { ...contadores, DIALOG: quedan, TYPE: { ...(contadores.TYPE ?? {}), DIALOG: total } };
}
