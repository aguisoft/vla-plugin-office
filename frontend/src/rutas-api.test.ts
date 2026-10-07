import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Las rutas de este plugin cuelgan de /api/v1/p/office. Una llamada cruda
 * como `api.get('/planta')` compila, pasa el tipado y sale a `/api/v1/planta`:
 * el core responde 404 y la pantalla se queda sin datos en silencio.
 *
 * Pasó de verdad con la planta: se desplegó a producción y estuvo invisible
 * hasta que se miraron los logs del servidor. Por eso las rutas se declaran en
 * `api.ts` con el prefijo, y acá se vigila que nadie vuelva a escribirlas sueltas.
 */

/** Rutas del CORE, no del plugin: estas sí van sin el prefijo. */
const DEL_CORE = ['/auth/'];

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe('rutas de la API', () => {
  it('ningún componente llama a api.* con una ruta sin el prefijo del plugin', () => {
    const sueltas: string[] = [];

    for (const f of archivos(join(__dirname))) {
      if (f.endsWith(`${'api'}.ts`)) continue;   // api.ts es donde vive el prefijo
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bapi\.(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*(['"`])([^'"`]*)\2/g)) {
        const ruta = m[3];
        if (ruta.startsWith('/p/office')) continue;
        if (DEL_CORE.some(p => ruta.startsWith(p))) continue;
        sueltas.push(`${f.replace(__dirname, 'src')} → api.${m[1]}('${ruta}')`);
      }
    }

    expect(sueltas).toEqual([]);
  });

  it('se reconoce una ruta suelta cuando la hay', () => {
    // El detector tiene que reaccionar a la forma exacta que causó el fallo.
    const re = /\bapi\.(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*(['"`])([^'"`]*)\2/g;
    const ejemplo = `const cargar = () => api.get<Planta>('/planta').then(setP);`;
    expect([...ejemplo.matchAll(re)].map(m => m[3])).toEqual(['/planta']);
  });
});
