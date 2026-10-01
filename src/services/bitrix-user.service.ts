import type { PluginContext, BitrixUserAuthorizedPayload, BitrixUserTokens } from '@vla/plugin-sdk';
import { necesitaRefresco, esAccesoRevocado, validarConexion, type VeredictoConexion } from '../lib/token-vigencia';

interface FilaToken {
  user_id: string;
  bitrix_user_id: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  conectado_at: Date;
}

export interface EstadoConexion {
  conectado: boolean;
  desde?: string;
  /** Usuario de Bitrix conectado: el widget lo usa para marcar los mensajes propios del hilo. */
  bitrixUserId?: string | null;
  /** Por qué no quedó conectado el último intento, si fue rechazado hace poco. */
  rechazo?: Exclude<VeredictoConexion, 'ok'>;
}

const claveRechazo = (userId: string) => `bitrix:rechazo:${userId}`;

/**
 * Tokens de Bitrix de cada persona. El core los canjea (tiene el secreto) y
 * los entrega por `core.bitrix.user_authorized`; acá se guardan, se refrescan
 * y se borran.
 *
 * Todo el SQL viaja con fechas como texto ISO y sin `ANY()`: `ctx.query` no
 * tipa los parámetros (ver holiday.service.ts).
 */
export class BitrixUserService {
  /**
   * Un refresco por persona a la vez. Bitrix invalida el refresh token al
   * usarlo: dos refrescos en paralelo harían que el segundo reciba
   * `invalid_grant` y borre una conexión que estaba bien.
   */
  private refrescando = new Map<string, Promise<string | null>>();

  constructor(private readonly ctx: PluginContext) {}

  /** Handler de `core.bitrix.user_authorized`. Devuelve el veredicto para poder probarlo. */
  async alAutorizar(payload: BitrixUserAuthorizedPayload): Promise<VeredictoConexion> {
    const mapeo = await this.ctx.prisma.bitrixUserMapping.findFirst({ where: { userId: payload.userId } });
    const veredicto = validarConexion(mapeo?.bitrixUserId, payload.bitrixUserId);
    if (veredicto !== 'ok') {
      this.ctx.logger.warn(
        `Conexión de Bitrix rechazada para ${payload.userId}: ${veredicto} ` +
        `(mapeo ${mapeo?.bitrixUserId ?? '—'}, autorizó ${payload.bitrixUserId ?? '—'})`,
      );
      await this.ctx.redis.set(claveRechazo(payload.userId), veredicto, 600);
      return veredicto;
    }
    await this.guardar(payload.userId, payload.tokens, payload.bitrixUserId);
    await this.ctx.redis.del(claveRechazo(payload.userId));
    this.ctx.logger.log(`Bitrix conectado: ${payload.userId} (Bitrix ${payload.bitrixUserId})`);
    return 'ok';
  }

  async guardar(userId: string, tokens: BitrixUserTokens, bitrixUserId: string | null): Promise<void> {
    await this.ctx.query(
      `INSERT INTO office_bitrix_tokens (user_id, bitrix_user_id, access_token, refresh_token, expires_at, conectado_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz, now())
       ON CONFLICT (user_id) DO UPDATE SET
         bitrix_user_id = EXCLUDED.bitrix_user_id,
         access_token   = EXCLUDED.access_token,
         refresh_token  = EXCLUDED.refresh_token,
         expires_at     = EXCLUDED.expires_at,
         conectado_at   = now()`,
      [userId, bitrixUserId, tokens.accessToken, tokens.refreshToken, new Date(tokens.expiresAt).toISOString()],
    );
  }

  /**
   * Token listo para usar, refrescado si hace falta. `null` = no está conectado
   * (o revocó el acceso, y entonces se borra para que reconecte).
   */
  async obtenerVigente(userId: string, ahora = Date.now()): Promise<string | null> {
    const fila = await this.leer(userId);
    if (!fila) return null;
    if (!necesitaRefresco(new Date(fila.expires_at).getTime(), ahora)) return fila.access_token;

    const enCurso = this.refrescando.get(userId);
    if (enCurso) return enCurso;
    const p = this.refrescar(fila).finally(() => this.refrescando.delete(userId));
    this.refrescando.set(userId, p);
    return p;
  }

  async desconectar(userId: string): Promise<void> {
    await this.ctx.query(`DELETE FROM office_bitrix_tokens WHERE user_id = $1`, [userId]);
  }

  async estado(userId: string): Promise<EstadoConexion> {
    const fila = await this.leer(userId);
    if (fila) return { conectado: true, desde: new Date(fila.conectado_at).toISOString(), bitrixUserId: fila.bitrix_user_id };
    const rechazo = (await this.ctx.redis.get(claveRechazo(userId))) as EstadoConexion['rechazo'] | null;
    return rechazo ? { conectado: false, rechazo } : { conectado: false };
  }

  /** Quiénes tienen Bitrix conectado. Para la consulta de respaldo de mensajes. */
  async conectados(): Promise<string[]> {
    const filas = await this.ctx.query<{ user_id: string }>(`SELECT user_id FROM office_bitrix_tokens`);
    return filas.map(f => f.user_id);
  }

  private async leer(userId: string): Promise<FilaToken | null> {
    const filas = await this.ctx.query<FilaToken>(
      `SELECT user_id, bitrix_user_id, access_token, refresh_token, expires_at, conectado_at
         FROM office_bitrix_tokens WHERE user_id = $1`,
      [userId],
    );
    return filas[0] ?? null;
  }

  private async refrescar(fila: FilaToken): Promise<string | null> {
    if (!this.ctx.bitrix) throw new Error('Bitrix no está configurado en el sistema');
    try {
      const nuevos = await this.ctx.bitrix.refreshUserToken(fila.refresh_token);
      await this.guardar(fila.user_id, nuevos, fila.bitrix_user_id);
      return nuevos.accessToken;
    } catch (e) {
      if (esAccesoRevocado(e)) {
        this.ctx.logger.warn(`Bitrix revocó el acceso de ${fila.user_id}: se borra la conexión`);
        await this.desconectar(fila.user_id);
        return null;
      }
      throw e;
    }
  }
}
