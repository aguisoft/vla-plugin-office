/**
 * La versión publicada de la app de escritorio (vla-widget).
 *
 * Office solo la guarda y la sirve: NO decide si es confiable. La firma la
 * verifica cada app con la clave pública que trae adentro, contra una clave
 * privada que vive fuera de este servidor. Así, aunque alguien tomara el
 * servidor, no podría instalar nada en las 23 computadoras.
 *
 * Formato de `publicacion.json` (un solo archivo, para que manifiesto y firma
 * no queden nunca a medio actualizar el uno respecto del otro):
 *
 *   { "manifiesto": "<JSON como texto, exactamente lo firmado>", "firma": "<base64>" }
 *
 * Una publicación por sistema (20-oct-2026): Windows sigue en `publicacion.json`
 * con su instalador `.exe` (así las apps ya instaladas, que no dicen de qué
 * sistema son, siguen recibiendo lo de Windows), y Linux va en
 * `publicacion-linux.json` con un AppImage. El manifiesto de Linux lleva
 * `plataforma: "linux"` firmado.
 */

export type Plataforma = 'win' | 'linux';
export const PLATAFORMAS: readonly Plataforma[] = ['win', 'linux'];

/** Lo que pide la app (`?plataforma=`). Sin nada o con otra cosa: Windows, como siempre. */
export function plataformaDe(valor: unknown): Plataforma {
  return valor === 'linux' ? 'linux' : 'win';
}

export function archivoPublicacion(p: Plataforma): string {
  return p === 'linux' ? 'publicacion-linux.json' : 'publicacion.json';
}

export interface Manifiesto {
  version: string;
  archivo: string;
  sha512: string;
  tamano: number;
  fecha: string;
  notas?: string;
  /** Solo en las de Linux (las de Windows no lo traían). */
  plataforma?: Plataforma;
}

export interface Publicacion {
  manifiesto: string;
  firma: string;
  meta: Manifiesto;
}

const VERSION = /^\d+\.\d+\.\d+$/;
const ARCHIVO: Record<Plataforma, RegExp> = {
  win: /^VLA-Oficina-Setup-\d+\.\d+\.\d+\.exe$/,
  linux: /^VLA-Oficina-\d+\.\d+\.\d+\.AppImage$/,
};

/** Solo el nombre que genera electron-builder para ese sistema: nada de rutas ni `..`. */
export function archivoSeguro(nombre: unknown, plataforma: Plataforma = 'win'): nombre is string {
  return typeof nombre === 'string' && ARCHIVO[plataforma].test(nombre);
}

/** `null` si el archivo no tiene la forma esperada. No verifica la firma (no es tarea de office). */
export function leerPublicacion(texto: string, plataforma: Plataforma = 'win'): Publicacion | null {
  try {
    const p = JSON.parse(texto);
    if (typeof p?.manifiesto !== 'string' || typeof p?.firma !== 'string') return null;
    const m = JSON.parse(p.manifiesto);
    if (!VERSION.test(m?.version) || !archivoSeguro(m?.archivo, plataforma)) return null;
    // La de Linux dice que es de Linux; la de Windows no dice nada o dice win.
    if ((m.plataforma ?? 'win') !== plataforma) return null;
    if (typeof m.sha512 !== 'string' || typeof m.tamano !== 'number') return null;
    return { manifiesto: p.manifiesto, firma: p.firma, meta: m };
  } catch {
    return null;
  }
}

/**
 * Si hay que avisar a los widgets: cambió la versión publicada. La primera
 * lectura tras arrancar solo fija la base, igual que `compararVentana`: un
 * reinicio del API no debe hacer que 23 apps se pongan a descargar.
 */
export function huboPublicacionNueva(anterior: string | null | undefined, actual: string | null): boolean {
  if (anterior === undefined) return false;
  return actual !== null && actual !== anterior;
}
