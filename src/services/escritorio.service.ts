import fs from 'fs';
import path from 'path';
import type { PluginContext } from '@vla/plugin-sdk';
import { leerPublicacion, huboPublicacionNueva, type Publicacion } from '../lib/publicacion-escritorio';

/**
 * Dónde viven los instaladores publicados de la app de escritorio.
 *
 * NO dentro de `storage/plugins/office/`: subir el plugin desde Admin → Módulos
 * borra esa carpeta entera (`plugin-upload.service.ts`) y se llevaría la
 * publicación. Una carpeta hermana en el mismo volumen sobrevive a eso y a los
 * reinicios. El cargador de plugins la saltea porque no tiene plugin.json.
 */
export function carpetaEscritorio(): string {
  return process.env.VLA_ESCRITORIO_DIR || path.resolve(process.cwd(), 'storage', 'plugins', '.escritorio');
}

const ARCHIVO_PUBLICACION = 'publicacion.json';

export class EscritorioService {
  /** `undefined` = todavía no se leyó nunca (primera lectura en silencio). */
  private versionVista: string | null | undefined = undefined;
  private pendiente: NodeJS.Timeout | null = null;

  constructor(private readonly ctx: PluginContext, private readonly dir = carpetaEscritorio()) {}

  leer(): Publicacion | null {
    try {
      return leerPublicacion(fs.readFileSync(path.join(this.dir, ARCHIVO_PUBLICACION), 'utf8'));
    } catch {
      return null;
    }
  }

  /** Ruta absoluta del instalador publicado, o `null` si no está. */
  rutaInstalador(p: Publicacion): string | null {
    const ruta = path.join(this.dir, p.meta.archivo);
    // archivoSeguro() ya impide separadores; esto es la segunda llave.
    if (path.dirname(ruta) !== path.resolve(this.dir)) return null;
    return fs.existsSync(ruta) ? ruta : null;
  }

  /**
   * Avisa cuando cambia la versión publicada. `fs.watch` para que llegue en el
   * acto; `revisar()` lo llama además el cron cada minuto por si el watch se
   * pierde (pasa con algunos volúmenes).
   */
  vigilar(alPublicar: (version: string) => void): void {
    this.revisar(alPublicar);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.watch(this.dir, () => {
        // El script copia el instalador y después la publicación: se espera a que termine.
        if (this.pendiente) clearTimeout(this.pendiente);
        this.pendiente = setTimeout(() => this.revisar(alPublicar), 2000);
      });
    } catch (e) {
      this.ctx.logger.warn(`No se pudo vigilar ${this.dir}: ${e}. Queda el cron de cada minuto.`);
    }
  }

  revisar(alPublicar: (version: string) => void): void {
    const p = this.leer();
    const actual = p && this.rutaInstalador(p) ? p.meta.version : null;
    if (huboPublicacionNueva(this.versionVista, actual)) {
      this.ctx.logger.log(`App de escritorio ${actual} publicada: avisando a los widgets conectados`);
      alPublicar(actual!);
    }
    // Si desapareció, se recuerda la última buena para no re-avisar al volver.
    if (actual !== null || this.versionVista === undefined) this.versionVista = actual;
  }
}
