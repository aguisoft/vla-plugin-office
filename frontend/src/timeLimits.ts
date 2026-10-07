import type { ResolvedStatus } from './statusConfig';

/**
 * Cuánto se espera que dure cada estado. Pasado el límite el cronómetro NO se
 * detiene ni revierte el estado: sigue contando para dejar registro de cuánto
 * tiempo extra se tomó, que es el dato que después se conversa.
 *
 * Los estados que no están acá no llevan cronómetro: estar disponible o
 * concentrado no tiene plazo, y ponerle uno convertiría la herramienta en un
 * vigilante.
 */
export const LIMITE_MIN: Partial<Record<ResolvedStatus, number>> = {
  BRB: 10,            // vuelvo pronto / permiso corto
  LUNCH: 60,          // almuerzo
  PERMISO: 60,        // permiso largo
  CITA_MEDICA: 180,   // cita médica
};

/** Minutos en ámbar antes del límite, como aviso de que queda poco. */
export const COLCHON_AMBAR_MIN = 5;

export type Fase = 'verde' | 'ambar' | 'rojo';

export interface Semaforo {
  fase: Fase;
  /** Segundos desde que entró al estado; sigue creciendo pasado el límite. */
  transcurridoSeg: number;
  /** Segundos por encima del límite. 0 mientras no se pase. */
  excesoSeg: number;
  limiteMin: number;
}

/**
 * `null` cuando el estado no tiene plazo o no se sabe desde cuándo está, para
 * que quien lo llame no pinte un cronómetro inventado desde cero.
 */
export function semaforo(
  status: string,
  desde: string | Date | null | undefined,
  ahora: Date = new Date(),
): Semaforo | null {
  const limiteMin = LIMITE_MIN[status as ResolvedStatus];
  if (limiteMin === undefined || !desde) return null;

  const inicio = desde instanceof Date ? desde : new Date(desde);
  if (isNaN(inicio.getTime())) return null;

  // Un inicio en el futuro (reloj del cliente atrasado, ausencia programada que
  // todavía no empieza) se muestra en cero en vez de en negativo.
  const transcurridoSeg = Math.max(0, Math.floor((ahora.getTime() - inicio.getTime()) / 1000));
  const limiteSeg = limiteMin * 60;
  const ambarSeg = Math.max(0, limiteSeg - COLCHON_AMBAR_MIN * 60);

  const fase: Fase =
    transcurridoSeg > limiteSeg ? 'rojo'
    : transcurridoSeg >= ambarSeg ? 'ambar'
    : 'verde';

  return {
    fase,
    transcurridoSeg,
    excesoSeg: Math.max(0, transcurridoSeg - limiteSeg),
    limiteMin,
  };
}

/** mm:ss hasta la hora; de ahí en adelante h:mm:ss. */
export function reloj(seg: number): string {
  const s = Math.max(0, Math.floor(seg));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const dd = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${dd(m)}:${dd(ss)}` : `${dd(m)}:${dd(ss)}`;
}
