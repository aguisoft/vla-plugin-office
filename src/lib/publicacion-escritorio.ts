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
 */

export interface Manifiesto {
  version: string;
  archivo: string;
  sha512: string;
  tamano: number;
  fecha: string;
  notas?: string;
}

export interface Publicacion {
  manifiesto: string;
  firma: string;
  meta: Manifiesto;
}

const VERSION = /^\d+\.\d+\.\d+$/;
const ARCHIVO = /^VLA-Oficina-Setup-\d+\.\d+\.\d+\.exe$/;

/** Solo el nombre que genera electron-builder: nada de rutas ni `..`. */
export function archivoSeguro(nombre: unknown): nombre is string {
  return typeof nombre === 'string' && ARCHIVO.test(nombre);
}

/** `null` si el archivo no tiene la forma esperada. No verifica la firma (no es tarea de office). */
export function leerPublicacion(texto: string): Publicacion | null {
  try {
    const p = JSON.parse(texto);
    if (typeof p?.manifiesto !== 'string' || typeof p?.firma !== 'string') return null;
    const m = JSON.parse(p.manifiesto);
    if (!VERSION.test(m?.version) || !archivoSeguro(m?.archivo)) return null;
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
