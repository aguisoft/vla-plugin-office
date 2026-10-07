/**
 * La planta de la oficina: un objeto compartido que pide agua cada tanto y que
 * cualquiera puede regar.
 *
 * El estado NO se guarda: se deriva del último riego. Así no hace falta un
 * proceso que la vaya marchitando, no hay nada que se desincronice si el
 * servidor estuvo caído, y el historial de riegos es la única verdad.
 */

export const HORAS_SED = 8;        // empieza a pedir agua
export const HORAS_MARCHITA = 24;  // se nota que nadie pasó
export const HORAS_SECA = 48;      // hay que rescatarla

export type EstadoPlanta = 'feliz' | 'sed' | 'marchita' | 'seca';

export interface Planta {
  estado: EstadoPlanta;
  horasSinAgua: number | null;     // null = nunca se regó
  /** Regar cuando está feliz no suma: evita el riego compulsivo y que el
   *  gesto pierda sentido a fuerza de repetirlo. */
  puedeRegar: boolean;
  /** Regarla estando seca es un rescate y se marca distinto. */
  seriaRescate: boolean;
}

export function estadoDePlanta(ultimoRiego: Date | string | null, ahora: Date = new Date()): Planta {
  if (!ultimoRiego) {
    // Sin ningún riego registrado se la trata como recién plantada y sedienta:
    // mejor que arranque pidiendo agua a que nazca seca el primer día.
    return { estado: 'sed', horasSinAgua: null, puedeRegar: true, seriaRescate: false };
  }
  const t = ultimoRiego instanceof Date ? ultimoRiego : new Date(ultimoRiego);
  if (isNaN(t.getTime())) {
    return { estado: 'sed', horasSinAgua: null, puedeRegar: true, seriaRescate: false };
  }

  // Un riego con fecha futura (reloj desfasado) cuenta como recién regada.
  const horas = Math.max(0, (ahora.getTime() - t.getTime()) / 3_600_000);

  const estado: EstadoPlanta =
    horas >= HORAS_SECA     ? 'seca'
    : horas >= HORAS_MARCHITA ? 'marchita'
    : horas >= HORAS_SED      ? 'sed'
    : 'feliz';

  return {
    estado,
    horasSinAgua: Math.floor(horas),
    puedeRegar: estado !== 'feliz',
    seriaRescate: estado === 'seca',
  };
}

/** Lo que se le dice a la gente en cada estado. */
export function fraseDePlanta(p: Planta): string {
  switch (p.estado) {
    case 'feliz':    return 'Está contenta';
    case 'sed':      return 'Tiene sed';
    case 'marchita': return 'Se está marchitando';
    case 'seca':     return p.horasSinAgua == null
      ? 'Nadie la ha regado todavía'
      : `Hace ${Math.floor(p.horasSinAgua / 24)} días que nadie la riega`;
  }
}
