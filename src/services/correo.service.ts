import type { PluginContext } from '@vla/plugin-sdk';
import { configCorreo, armarCorreo, type ConfigCorreo } from '../lib/correo-aviso';

interface Transporte {
  sendMail(m: { from: string; to: string; subject: string; text: string; html: string }): Promise<{ messageId?: string }>;
}

/**
 * Manda por correo los avisos que lo piden (ver lib/avisos.ts). Usa el SMTP de
 * Amazon SES configurado en el panel de la oficina; sin configuración, no hace
 * nada (y lo dice una vez en el log).
 */
export class CorreoService {
  private transporte: Transporte | null = null;
  private clave = '';
  private avisoSinConfig = false;

  constructor(
    private readonly ctx: PluginContext,
    /** URL pública del sistema, para el botón del correo. */
    private readonly base: () => string,
    /** Inyectable para las pruebas. */
    private readonly crear: (c: ConfigCorreo) => Transporte = c =>
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('nodemailer').createTransport({ host: c.host, port: c.port, secure: c.secure, auth: { user: c.user, pass: c.pass }, connectionTimeout: 10_000 }),
  ) {}

  /** El transporte vigente; se rearma si cambió la configuración. */
  private obtener(): { t: Transporte; c: ConfigCorreo } | null {
    const c = configCorreo(this.ctx.plugin.config ?? {});
    if (!c) {
      if (!this.avisoSinConfig) this.ctx.logger.warn('Correo de avisos sin configurar (CORREO_HOST/USUARIO/CLAVE): no se mandan correos');
      this.avisoSinConfig = true;
      return null;
    }
    const clave = `${c.host}|${c.port}|${c.secure}|${c.user}|${c.pass}`;
    if (!this.transporte || clave !== this.clave) {
      this.transporte = this.crear(c);
      this.clave = clave;
    }
    return { t: this.transporte, c };
  }

  /** Manda el aviso a esa dirección. Devuelve si salió. */
  async enviar(para: string, aviso: { titulo: string; cuerpo: string; url?: string | null }): Promise<boolean> {
    const x = this.obtener();
    if (!x || !para) return false;
    const m = armarCorreo(aviso, this.base());
    await x.t.sendMail({ from: x.c.from, to: para, subject: m.asunto, text: m.texto, html: m.html });
    return true;
  }
}
