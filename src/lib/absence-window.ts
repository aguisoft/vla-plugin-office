/**
 * Quién acaba de entrar o salir de una ausencia, comparando dos instantes.
 *
 * Las ausencias programadas y los feriados empiezan y terminan por RELOJ, no
 * porque alguien toque un botón. Sin esta comparación no hay nada que emitir
 * a esa hora, y las pantallas se quedan con el estado viejo hasta que otra
 * persona haga cualquier cosa y dispare una recarga de rebote.
 */

export interface CambioDeVentana {
  /** Pasaron a estar ausentes desde el tick anterior. */
  entraron: string[];
  /** Dejaron de estarlo. */
  salieron: string[];
}

/**
 * `null` significa «no anuncies nada»: o es el primer tick tras arrancar, o no
 * cambió nadie.
 *
 * El primer tick importa. Sin tratarlo aparte, un reinicio del API anunciaría
 * como recién ausentes a todos los que ya lo estaban, y cada pantalla abierta
 * recargaría sin que hubiera cambiado nada. Por eso `previos` nulo fija la
 * línea base en silencio.
 */
export function compararVentana(
  previos: ReadonlySet<string> | null,
  ahora: ReadonlySet<string>,
): CambioDeVentana | null {
  if (previos === null) return null;

  const entraron = [...ahora].filter(id => !previos.has(id));
  const salieron = [...previos].filter(id => !ahora.has(id));

  if (entraron.length === 0 && salieron.length === 0) return null;
  return { entraron, salieron };
}
