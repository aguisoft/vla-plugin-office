/**
 * Cuándo avisar de mensajes nuevos de Bitrix.
 *
 * Bitrix no le avisa a una app REST de los mensajes entre personas (no existe
 * `OnImMessageAdd` para apps; probado el 1-oct-2026). Hay dos caminos:
 *
 *  1. Inmediato: el mensaje salió por nuestro proxy, así que sabemos a quién.
 *  2. Respaldo: cada 2 minutos se mira el contador de no leídos de cada
 *     persona conectada, para lo que se escribió desde Bitrix web o el celular.
 *
 * El riesgo de tener dos caminos es avisar dos veces el mismo mensaje. Por eso
 * el camino 1 sube la línea base: la siguiente consulta ya lo cuenta como visto.
 */

export interface Decision {
  avisar: boolean;
  /** Cuántos mensajes nuevos hay desde la base. */
  nuevos: number;
  /** La base a guardar para la próxima consulta. */
  base: number;
}

/**
 * `base` nula = primera consulta tras arrancar o tras conectarse: fija la línea
 * base en silencio. Sin eso, cada reinicio del API avisaría de todos los
 * mensajes viejos sin leer, igual que `compararVentana` con las ausencias.
 */
export function decidirAviso(base: number | null, contador: number): Decision {
  if (base === null) return { avisar: false, nuevos: 0, base: contador };
  if (contador > base) return { avisar: true, nuevos: contador - base, base: contador };
  // Igual, o bajó porque la persona leyó: la base acompaña sin avisar.
  return { avisar: false, nuevos: 0, base: contador };
}

/** El camino inmediato ya avisó un mensaje: la próxima consulta no debe repetirlo. */
export function registrarAvisoInmediato(base: number | null): number | null {
  return base === null ? null : base + 1;
}

/**
 * Consultas a saltear tras `fallos` errores seguidos: 1, 2, 4, 8 y tope 16
 * (con el cron de 2 minutos, el tope es ~32 minutos sin molestar a Bitrix).
 */
export function saltosTrasFallos(fallos: number): number {
  if (fallos <= 0) return 0;
  return Math.min(2 ** (fallos - 1), 16);
}

/**
 * No leídos de CONVERSACIONES a partir de `im.counters.get`: directos, chats y
 * canales abiertos.
 *
 * No se usa `TYPE.ALL`: en producción (1-oct-2026) valía 1165, de los cuales
 * 979 eran tareas (`TASKS_TASK`) y 52 notificaciones. Con ALL, cada tarea que
 * se mueve dispararía «mensajes nuevos». `null` si la respuesta no trae
 * ninguno de los tres: mejor no decidir que inventar un 0.
 */
export function totalSinLeer(respuesta: unknown): number | null {
  const tipo = (respuesta as any)?.TYPE;
  if (!tipo || typeof tipo !== 'object') return null;
  const partes = ['DIALOG', 'CHAT', 'LINES'].map(k => tipo[k]).filter(v => typeof v === 'number');
  return partes.length ? partes.reduce((a: number, b: number) => a + b, 0) : null;
}

/** Un `DIALOG_ID` de Bitrix: un usuario (`949`) o un chat (`chat123`). */
export function dialogoValido(dialogId: unknown): dialogId is string {
  return typeof dialogId === 'string' && /^(\d{1,10}|chat\d{1,10})$/.test(dialogId);
}

/** Texto de un mensaje a enviar: recortado y de 1 a 2000 caracteres. `null` si no sirve. */
export function textoMensaje(texto: unknown): string | null {
  if (typeof texto !== 'string') return null;
  const t = texto.trim();
  return t.length >= 1 && t.length <= 2000 ? t : null;
}

/** Vista previa para el aviso: una línea, corta. */
export function vistaPrevia(texto: string, max = 120): string {
  const una = texto
    .replace(/\[USER=\d+\]([^[]*)\[\/USER\]/gi, '@$1')
    .replace(/\[[^\]]{1,40}\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return una.length <= max ? una : `${una.slice(0, max - 1)}…`;
}

// ── Comparación chat por chat ───────────────────────────────────────────────

/** Sin leer por conversación en la última consulta (lo que ya se avisó). */
export interface Instantanea {
  CHAT: Record<string, number>;
  DIALOG: Record<string, number>;
}

export function instantanea(contadores: any): Instantanea {
  const copia = (m: unknown) => Object.fromEntries(
    Object.entries((m && typeof m === 'object' ? m : {}) as Record<string, unknown>).map(([k, v]) => [k, Number(v) || 0]),
  );
  return { CHAT: copia(contadores?.CHAT), DIALOG: copia(contadores?.DIALOG) };
}

/**
 * Lo nuevo desde la consulta anterior, conversación por conversación. Antes se
 * comparaba el TOTAL: si la persona leía 3 en Bitrix y le llegaban 3 en otro
 * chat, el total no cambiaba y no se avisaba nada. `previo` nulo (primera
 * consulta tras arrancar o conectarse) no avisa: fija la base.
 */
export function subidas(previo: Instantanea | null, contadores: any): { nuevos: number; chats: string[]; dialogos: number } {
  if (!previo) return { nuevos: 0, chats: [], dialogos: 0 };
  const ahora = instantanea(contadores);
  let nuevos = 0;
  const subieron = (antes: Record<string, number>, despues: Record<string, number>) => {
    const ids: string[] = [];
    for (const [id, n] of Object.entries(despues)) {
      const d = n - (antes[id] ?? 0);
      if (d > 0) { nuevos += d; ids.push(id); }
    }
    return ids;
  };
  const chats = subieron(previo.CHAT, ahora.CHAT);
  const dialogos = subieron(previo.DIALOG, ahora.DIALOG).length;
  return { nuevos, chats, dialogos };
}

/**
 * El aviso inmediato (mensaje que salió por el proxy) ya avisó en ese chat: la
 * próxima consulta no lo repite. Se aplica ANTES de difundir, sin `await` de
 * por medio, para que una consulta en vuelo no lo cuente dos veces.
 */
export function sumarAvisado(previo: Instantanea | null, dialogId: string): Instantanea | null {
  if (!previo) return null;
  if (dialogId.startsWith('chat')) {
    const id = dialogId.slice(4);
    return { ...previo, CHAT: { ...previo.CHAT, [id]: (previo.CHAT[id] ?? 0) + 1 } };
  }
  return { ...previo, DIALOG: { ...previo.DIALOG, [dialogId]: (previo.DIALOG[dialogId] ?? 0) + 1 } };
}
