import type { PluginContext } from '@vla/plugin-sdk';
import { type AvisoNuevo, rutaInterna, recortar, MAX_TITULO, MAX_CUERPO } from '../lib/avisos';
import { listaIn } from './holiday.service';

/** Un aviso de la campana, como lo ve la pantalla. */
export interface Aviso {
  id: string;
  tipo: string;
  titulo: string;
  cuerpo: string;
  url: string | null;
  creadoEn: string;
  leidoEn: string | null;
}

/** Las conexiones en vivo (web y app de escritorio) de la oficina. */
export interface CanalesEnVivo {
  broadcastToUser(userId: string, payload: object): void;
  /** Tiene la app de escritorio conectada ahora. */
  escritorioConectado(userId: string): boolean;
}

const URL_POR_DEFECTO = '/dashboard/office';

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const aAviso = (f: any): Aviso => ({
  id: String(f.id), tipo: f.tipo, titulo: f.titulo, cuerpo: f.cuerpo ?? '', url: f.url ?? null,
  creadoEn: iso(f.creado_en)!, leidoEn: iso(f.leido_en),
});

/**
 * El único lugar por donde la oficina le avisa algo a alguien (ver
 * lib/avisos.ts). Por cada persona:
 *
 * 1. Lo guarda en la campana (salvo `guardar: false`).
 * 2. Lo manda en vivo a sus pantallas: la web lo suma a la campana y, si es
 *    emergente, muestra un cartel; la app de escritorio, un aviso de Windows.
 * 3. Aviso del navegador SOLO si no tiene la app de escritorio conectada: con
 *    la app, Windows mostraba dos avisos por cada cosa.
 * 4. Bitrix, si el aviso trae mensaje para Bitrix.
 * 5. Correo, si el aviso lo pide (solicitudes y sus respuestas).
 *
 * Cada canal falla por su cuenta: que Bitrix no conteste no frena el resto.
 */
export class AvisosService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly vivo: CanalesEnVivo,
    private readonly bitrix: (userId: string, mensaje: string) => Promise<void>,
    /** Correo a la persona; sin él, los avisos que lo piden salen igual por lo demás. */
    private readonly correo?: (userId: string, aviso: AvisoNuevo) => Promise<void>,
  ) {}

  async avisar(userIds: string[], a: AvisoNuevo): Promise<void> {
    const aviso: AvisoNuevo = { ...a, titulo: recortar(a.titulo, MAX_TITULO), cuerpo: recortar(a.cuerpo ?? '', MAX_CUERPO), url: rutaInterna(a.url) };
    for (const userId of new Set(userIds)) {
      try {
        await this.avisarA(userId, aviso);
      } catch (e) {
        this.ctx.logger.warn(`Aviso «${a.tipo}» a ${userId} falló: ${e}`);
      }
    }
  }

  private async avisarA(userId: string, a: AvisoNuevo): Promise<void> {
    const guardar = a.guardar !== false;
    const emergente = a.emergente !== false;
    let aviso: Aviso = { id: '', tipo: a.tipo, titulo: a.titulo, cuerpo: a.cuerpo, url: a.url ?? null, creadoEn: new Date().toISOString(), leidoEn: null };
    if (guardar) {
      const [fila] = await this.ctx.query<any>(
        `INSERT INTO office_avisos (user_id, tipo, titulo, cuerpo, url) VALUES ($1, $2, $3, $4, $5)
         RETURNING id::text AS id, tipo, titulo, cuerpo, url, creado_en, leido_en`,
        [userId, a.tipo, a.titulo, a.cuerpo, a.url ?? null],
      );
      if (fila) aviso = aAviso(fila);
    }
    if (guardar || emergente) this.vivo.broadcastToUser(userId, { type: 'aviso', aviso, emergente });
    await this.respaldo(userId, a);
    if (a.bitrix) {
      try { await this.bitrix(userId, a.bitrix); } catch (e) { this.ctx.logger.warn(`Aviso de Bitrix a ${userId} falló: ${e}`); }
    }
    if (a.correo && this.correo) {
      try { await this.correo(userId, a); } catch (e) { this.ctx.logger.warn(`Correo a ${userId} falló: ${e}`); }
    }
  }

  /**
   * El aviso del navegador, para quien no tiene la app de escritorio abierta.
   * También lo usa el chat, que tiene su propio aviso en vivo.
   */
  async respaldo(userId: string, a: { titulo: string; cuerpo: string; url?: string | null }): Promise<void> {
    if (this.vivo.escritorioConectado(userId)) return;
    try {
      await this.ctx.hooks.doAction('core.push.send', { userId, title: a.titulo, body: a.cuerpo, url: rutaInterna(a.url) ?? URL_POR_DEFECTO });
    } catch (e) {
      this.ctx.logger.warn(`Aviso del navegador a ${userId} falló: ${e}`);
    }
  }

  /** Los últimos avisos de la persona y cuántos no leyó. */
  async lista(userId: string, limite = 30): Promise<{ avisos: Aviso[]; sinLeer: number }> {
    const [filas, [cuenta]] = await Promise.all([
      this.ctx.query<any>(
        `SELECT id::text AS id, tipo, titulo, cuerpo, url, creado_en, leido_en FROM office_avisos
         WHERE user_id = $1 ORDER BY creado_en DESC, id DESC LIMIT ${Math.max(1, Math.min(100, Math.floor(limite)))}`,
        [userId],
      ),
      this.ctx.query<{ n: number }>(`SELECT count(*)::int AS n FROM office_avisos WHERE user_id = $1 AND leido_en IS NULL`, [userId]),
    ]);
    return { avisos: filas.map(aAviso), sinLeer: Number(cuenta?.n ?? 0) };
  }

  /** Marca como leídos esos avisos (de la persona), o todos si no se pasan. Devuelve cuántos. */
  async marcarLeidos(userId: string, ids?: string[]): Promise<number> {
    const validos = (ids ?? []).filter(i => /^\d{1,18}$/.test(i)).slice(0, 200);
    if (ids && !validos.length) return 0;
    const filas = await this.ctx.query<{ id: string }>(
      ids
        ? `UPDATE office_avisos SET leido_en = now() WHERE user_id = $1 AND leido_en IS NULL AND id::text IN (${listaIn(validos.length, 2)}) RETURNING id::text AS id`
        : `UPDATE office_avisos SET leido_en = now() WHERE user_id = $1 AND leido_en IS NULL RETURNING id::text AS id`,
      ids ? [userId, ...validos] : [userId],
    );
    return filas.length;
  }

  /** Borra los avisos de hace más de `dias`. */
  async limpiar(dias = 90): Promise<number> {
    const filas = await this.ctx.query<{ id: string }>(
      `DELETE FROM office_avisos WHERE creado_en < now() - ($1::text || ' days')::interval RETURNING id::text AS id`,
      [String(dias)],
    );
    return filas.length;
  }
}
