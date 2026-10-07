import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { PluginContext } from '@vla/plugin-sdk';
import { nombreSeguro, TIPOS_PERMITIDOS, type AdjuntoEntrada } from '../lib/adjuntos';

/**
 * Dónde viven los documentos de respaldo de las solicitudes.
 *
 * Carpeta HERMANA del plugin, por lo mismo que los instaladores del escritorio:
 * subir el plugin desde Admin → Módulos borra `storage/plugins/office/` entera
 * y se llevaría los comprobantes de todo el mundo. El cargador la saltea
 * porque no tiene plugin.json.
 */
export function carpetaAdjuntos(): string {
  return process.env.VLA_ADJUNTOS_DIR || path.resolve(process.cwd(), 'storage', 'plugins', '.adjuntos');
}

export interface AdjuntoFila {
  id: string;
  absence_id: string;
  user_id: string;
  nombre: string;
  archivo: string;
  tipo: string;
  bytes: number;
  subido_por: string;
  creado_en: string;
}

export class AdjuntosService {
  constructor(private readonly ctx: PluginContext, private readonly dir = carpetaAdjuntos()) {}

  /** Guarda los archivos y deja el apunte en la base. Devuelve lo guardado. */
  async guardar(
    absenceId: string,
    duenoId: string,
    subidoPor: string,
    entradas: AdjuntoEntrada[],
  ): Promise<AdjuntoFila[]> {
    if (!entradas.length) return [];
    fs.mkdirSync(this.dir, { recursive: true });

    const out: AdjuntoFila[] = [];
    for (const e of entradas) {
      const visible = nombreSeguro(e.nombre, e.tipo);
      // Nombre en disco único e impredecible: con el nombre visible, dos
      // personas que suben "boleta.pdf" se pisan, y un id adivinable deja
      // probar rutas a mano.
      const enDisco = `${crypto.randomUUID()}.${TIPOS_PERMITIDOS[e.tipo] ?? 'bin'}`;
      const buf = Buffer.from(e.contenido, 'base64');
      fs.writeFileSync(path.join(this.dir, enDisco), buf);

      const [fila] = await this.ctx.query<AdjuntoFila>(
        `INSERT INTO office_absence_adjuntos
           (absence_id, user_id, nombre, archivo, tipo, bytes, subido_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, absence_id, user_id, nombre, archivo, tipo, bytes, subido_por, creado_en`,
        [absenceId, duenoId, visible, enDisco, e.tipo, buf.length, subidoPor],
      );
      out.push(fila);
    }
    return out;
  }

  async listar(absenceIds: string[]): Promise<AdjuntoFila[]> {
    if (!absenceIds.length) return [];
    return this.ctx.query<AdjuntoFila>(
      `SELECT id, absence_id, user_id, nombre, archivo, tipo, bytes, subido_por, creado_en
         FROM office_absence_adjuntos
        WHERE absence_id = ANY($1::text[])
        ORDER BY creado_en`,
      [absenceIds],
    );
  }

  async porId(id: string): Promise<AdjuntoFila | null> {
    const [f] = await this.ctx.query<AdjuntoFila>(
      `SELECT id, absence_id, user_id, nombre, archivo, tipo, bytes, subido_por, creado_en
         FROM office_absence_adjuntos WHERE id = $1`, [id]);
    return f ?? null;
  }

  rutaDe(fila: AdjuntoFila): string {
    // `archivo` lo generó el servidor (uuid + extensión de una lista cerrada),
    // nunca viene del cliente: no hay forma de que apunte fuera de la carpeta.
    return path.join(this.dir, fila.archivo);
  }

  /** Al cancelar una ausencia se van sus documentos: no queda una constancia
   *  médica huérfana en el disco sin nada que la referencie. */
  async borrarDeAusencia(absenceId: string): Promise<number> {
    const filas = await this.ctx.query<AdjuntoFila>(
      `DELETE FROM office_absence_adjuntos WHERE absence_id = $1
       RETURNING id, absence_id, user_id, nombre, archivo, tipo, bytes, subido_por, creado_en`,
      [absenceId],
    );
    for (const f of filas) {
      try { fs.unlinkSync(this.rutaDe(f)); }
      catch { /* ya no estaba: la fila igual se fue, que es lo que importa */ }
    }
    return filas.length;
  }
}
