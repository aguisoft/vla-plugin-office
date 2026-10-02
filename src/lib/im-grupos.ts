/**
 * Grupos de Bitrix en el widget: miembros, avisos, silencio y administración.
 * Probado contra el portal el 2-oct-2026 en un grupo de prueba de Carlos solo:
 *
 *  - Datos del grupo: `im.dialog.get {DIALOG_ID: 'chatN'}` (nombre, owner,
 *    manager_list, mute_list). `im.chat.get` devuelve vacío.
 *  - Miembros: `im.chat.user.list {CHAT_ID}` → ids.
 *  - Silenciar: `im.chat.mute {CHAT_ID, ACTION: 'Y'|'N'}`. Los grupos
 *    silenciados NO suman en `CHAT` de `im.counters.get` (van a `CHAT_MUTED`).
 *  - Crear `im.chat.add {TYPE:'CHAT', TITLE, USERS}`, renombrar
 *    `im.chat.updateTitle`, salir `im.chat.leave`.
 */

export function chatIdDe(dialogId: unknown): number | null {
  const m = typeof dialogId === 'string' ? /^chat(\d{1,10})$/.exec(dialogId) : null;
  return m ? Number(m[1]) : null;
}

/** `mute_list` llega como lista de ids (`[]`) o como objeto `{ "949": true }`. */
export function silenciadoPor(muteList: unknown, bitrixUserId: string | number | null | undefined): boolean {
  if (bitrixUserId == null) return false;
  const id = String(bitrixUserId);
  if (Array.isArray(muteList)) return muteList.map(String).includes(id);
  if (muteList && typeof muteList === 'object') return (muteList as Record<string, unknown>)[id] === true;
  return false;
}

/** Ids de Bitrix mencionados en un texto ([USER=id]…[/USER]). */
export function mencionados(texto: string): Set<string> {
  return new Set([...texto.matchAll(/\[USER=(\d+)\]/gi)].map(m => m[1]));
}

export interface Destinatario { userId: string; mencion: boolean }

/**
 * A quién del equipo avisar de un mensaje de grupo: los miembros que son
 * usuarios VLA, menos quien escribió. Quien silenció el grupo no recibe aviso…
 * salvo que lo mencionen: para eso existe la mención (Bitrix hace lo mismo).
 */
export function destinatariosDeGrupo(
  miembros: string[],
  vlaPorBitrix: Map<string, string>,
  remitenteVla: string,
  muteList: unknown,
  texto: string,
): Destinatario[] {
  const menc = mencionados(texto);
  const salida: Destinatario[] = [];
  for (const b of new Set(miembros.map(String))) {
    const userId = vlaPorBitrix.get(b);
    if (!userId || userId === remitenteVla) continue;
    const mencion = menc.has(b);
    if (silenciadoPor(muteList, b) && !mencion) continue;
    salida.push({ userId, mencion });
  }
  return salida;
}

export function tituloGrupo(t: unknown): string | null {
  if (typeof t !== 'string') return null;
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length >= 1 && s.length <= 100 ? s : null;
}

/** Lista de ids de Bitrix: solo dígitos, sin repetidos, hasta 50. `null` si algo no sirve. */
export function idsDeUsuarios(x: unknown, max = 50): number[] | null {
  if (!Array.isArray(x)) return null;
  const ids = x.map(String);
  if (ids.some(i => !/^\d{1,10}$/.test(i))) return null;
  const unicos = [...new Set(ids)].map(Number);
  return unicos.length <= max ? unicos : null;
}

/**
 * Qué cambió entre dos lecturas de contadores, para que el aviso diga de dónde
 * vienen los mensajes: «Ventas y 2 conversaciones más». Ids de chats que
 * subieron, y cuántos diálogos directos subieron.
 */
export function novedades(antes: { CHAT?: Record<string, number>; DIALOG?: Record<string, number> } | null, ahora: any): { chats: string[]; dialogos: number } {
  if (!antes) return { chats: [], dialogos: 0 };
  const subio = (a: Record<string, number> | undefined, b: Record<string, number> | undefined) =>
    Object.entries(b ?? {}).filter(([id, n]) => Number(n) > Number(a?.[id] ?? 0)).map(([id]) => id);
  return { chats: subio(antes.CHAT, ahora?.CHAT), dialogos: subio(antes.DIALOG, ahora?.DIALOG).length };
}

/** Texto del aviso de respaldo a partir de las novedades y los nombres de los grupos. */
export function textoNovedades(n: { chats: string[]; dialogos: number }, nombre: (chatId: string) => string | null, total: number): string {
  const grupos = n.chats.map(nombre).filter((x): x is string => !!x);
  const partes: string[] = [];
  if (grupos.length === 1) partes.push(`en ${grupos[0]}`);
  else if (grupos.length > 1) partes.push(`en ${grupos[0]} y ${grupos.length - 1} grupo${grupos.length > 2 ? 's' : ''} más`);
  if (n.dialogos > 0) partes.push(n.dialogos === 1 ? '1 conversación directa' : `${n.dialogos} conversaciones directas`);
  if (!partes.length) return total === 1 ? 'Tenés 1 mensaje nuevo sin leer' : `Tenés ${total} mensajes nuevos sin leer`;
  return `Mensajes nuevos ${partes.join(' y ')}`;
}

export interface Miembro {
  bitrixUserId: string;
  nombre: string;
  esEquipo: boolean;
  status: string | null;
  enOficina: boolean | null;
  hasta: string | null;
  esDueno: boolean;
  esAdmin: boolean;
  soyYo: boolean;
}

/**
 * Miembros del grupo con su estado en la oficina (si son del equipo). Primero
 * quien pregunta, después el equipo por nombre y al final la gente de fuera.
 */
export function armarMiembros(
  info: { miembros: string[]; duenoId: string | null; adminIds: string[] },
  equipo: Array<{ bitrixUserId: string; nombre: string; status: string; enOficina?: boolean; hasta?: string | null }>,
  nombresBitrix: Record<string, { name?: string } | undefined> | null,
  miBitrix: string | null,
): Miembro[] {
  const porBitrix = new Map(equipo.map(c => [c.bitrixUserId, c]));
  return info.miembros
    .map(id => {
      const c = porBitrix.get(id);
      return {
        bitrixUserId: id,
        nombre: c?.nombre ?? nombresBitrix?.[id]?.name ?? 'Alguien de Bitrix',
        esEquipo: !!c,
        status: c?.status ?? null,
        enOficina: c ? !!c.enOficina : null,
        hasta: c?.hasta ?? null,
        esDueno: id === info.duenoId,
        esAdmin: info.adminIds.includes(id),
        soyYo: id === miBitrix,
      };
    })
    .sort((a, b) => Number(b.soyYo) - Number(a.soyYo) || Number(b.esEquipo) - Number(a.esEquipo) || a.nombre.localeCompare(b.nombre, 'es'));
}
