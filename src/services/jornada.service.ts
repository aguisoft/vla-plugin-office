import type { PluginContext } from '@vla/plugin-sdk';
import {
  leerJornada, leerTareas, leerEventos, idsDelPlan, armarBorrador, horaLocal, problemaConSalida,
  isoConZona, horaTexto, armarResumen, textoResumen, segundosDe, trabajadoSegundos,
  LARGO_MAXIMO_INFORME, type Jornada, type Tarea, type Evento, type TimemanStatus, type FilaInforme, type Resumen,
} from '../lib/jornada';
import { localDateString, localDayStart, localDayEnd } from '../lib/local-date';
import { periodBounds, type Span } from '../lib/timesheet';

/** Llamar a Bitrix con el token de la persona (MensajeriaService.llamar). */
export type Llamar = <T = any>(userId: string, method: string, params?: Record<string, unknown>) => Promise<T>;

/** Error para mostrarle a la persona tal cual, con su código HTTP. */
export class JornadaError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface Panel {
  jornada: Jornada;
  /** Plan del día, con lo completado al final. */
  plan: Tarea[];
  /** Tareas abiertas que no están en el plan: para elegir. */
  tareas: Tarea[];
  /** Las del plan que se sumaron desde la oficina: las del planificador de Bitrix volverían solas. */
  quitables: number[];
  eventos: Evento[];
}

const CAMPOS_TAREA = ['ID', 'TITLE', 'STATUS', 'DEADLINE', 'CLOSED_DATE', 'TIME_SPENT_IN_LOGS', 'GROUP_ID'];
const POR_PAGINA = 50;
const PAGINAS_MAXIMAS = 4;
/** Cuándo empezó la pausa que pidió la oficina: Bitrix no lo devuelve. */
const clavePausa = (userId: string) => `jornada:pausa:${userId}`;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * Espejo del widget de jornada de Bitrix: estado y pausa, cierre con informe
 * (que Bitrix le hace llegar al jefe), plan del día, tareas y eventos. Todo con
 * el token de la persona: lo que hace queda a su nombre en Bitrix.
 */
export class JornadaService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly llamar: Llamar,
    private readonly tz: () => string,
    private readonly bitrixIdDe: (userId: string) => Promise<number | null>,
    /** Minutos en la oficina virtual por día, del timesheet. */
    private readonly oficinaPorDia: (userId: string, span: Span) => Promise<Array<{ date: string; minutes: number }>>,
    /** Al cerrar la jornada de hoy: salir de la oficina SIN volver a cerrar en Bitrix. */
    private readonly salirDeLaOficina: (userId: string) => Promise<void>,
  ) {}

  async estado(userId: string, ahora = new Date()): Promise<Jornada> {
    const s = await this.llamar<TimemanStatus>(userId, 'timeman.status');
    const marca = s?.STATUS === 'PAUSED' ? await this.ctx.redis.get(clavePausa(userId)) : null;
    return leerJornada(s, ahora, this.tz(), marca);
  }

  async panel(userId: string, ahora = new Date()): Promise<Panel> {
    const { jornada, plan, tareas, eventos, planOficina } = await this.delDia(userId, ahora);
    const deBitrix = new Set(idsDelPlan(planOficina.planBitrix, []));
    return { jornada, plan, tareas, eventos, quitables: planOficina.ids.filter(id => !deBitrix.has(id)) };
  }

  async pausar(userId: string): Promise<Jornada> {
    const j = await this.estado(userId);
    if (j.estado !== 'trabajando') throw new JornadaError(409, 'Tu jornada no está corriendo.');
    await this.llamar(userId, 'timeman.pause');
    await this.ctx.redis.set(clavePausa(userId), new Date().toISOString(), 86_400);
    return this.estado(userId);
  }

  async reanudar(userId: string): Promise<Jornada> {
    const j = await this.estado(userId);
    if (j.estado !== 'en_pausa') throw new JornadaError(409, 'Tu jornada no está en pausa.');
    await this.llamar(userId, 'timeman.open');
    await this.ctx.redis.del(clavePausa(userId));
    return this.estado(userId);
  }

  /** Lo que la pantalla de «Terminar jornada» muestra antes de mandar. */
  async borrador(userId: string, ahora = new Date()) {
    const tz = this.tz();
    const { jornada, plan, tareas, eventos, hechasHoy } = await this.delDia(userId, ahora);
    // Lo que se cerró hoy va aunque no estuviera en el plan: es trabajo del día.
    const completadas = hechasHoy;
    const enCurso = plan.length
      ? plan.filter(t => t.estado !== 'completada')
      : tareas.filter(t => t.estado === 'en_curso').slice(0, 10);

    return {
      jornada,
      reporte: armarBorrador({ completadas, enCurso, eventos, tz }),
      // Una jornada vencida es de otro día: la hora de salida la tiene que decir la persona.
      pideHora: jornada.estado === 'vencida',
      horaSugerida: jornada.estado === 'vencida' ? null : horaTexto(ahora, tz),
    };
  }

  async terminar(userId: string, entrada: { reporte?: unknown; hora?: unknown }, ahora = new Date()): Promise<Jornada> {
    const tz = this.tz();
    const reporte = typeof entrada.reporte === 'string' ? entrada.reporte.trim() : '';
    if (!reporte) throw new JornadaError(400, 'Escribí qué hiciste hoy: el informe le llega a tu jefe.');
    if (reporte.length > LARGO_MAXIMO_INFORME) throw new JornadaError(400, `El informe es muy largo (máximo ${LARGO_MAXIMO_INFORME} caracteres).`);

    const j = await this.estado(userId, ahora);
    if (!['trabajando', 'en_pausa', 'vencida'].includes(j.estado) || !j.inicio || !j.fecha) {
      throw new JornadaError(409, 'Tu jornada no está abierta.');
    }

    let salida: Date | null = null;
    if (entrada.hora != null && entrada.hora !== '') {
      salida = horaLocal(j.fecha, entrada.hora, tz);
      if (!salida) throw new JornadaError(400, 'La hora de salida tiene que ser como 17:45.');
      const problema = problemaConSalida(salida, new Date(j.inicio), ahora, tz);
      if (problema) throw new JornadaError(400, problema);
    } else if (j.estado === 'vencida') {
      throw new JornadaError(400, `Tu jornada del ${j.fecha} quedó abierta: decí a qué hora saliste.`);
    }

    const params: Record<string, unknown> = { REPORT: reporte };
    if (salida) params.TIME = isoConZona(salida, tz);
    await this.llamar(userId, 'timeman.close', params);
    await this.ctx.redis.del(clavePausa(userId));

    // Lo que quedó en Bitrix manda; si no se puede leer, se calcula.
    const final = await this.llamar<TimemanStatus>(userId, 'timeman.status').catch(() => null);
    const cerrada = final?.STATUS === 'CLOSED' ? final : null;
    const finBitrix = cerrada?.TIME_FINISH ? new Date(cerrada.TIME_FINISH) : null;
    const fin = finBitrix && !Number.isNaN(finBitrix.getTime()) ? finBitrix : (salida ?? ahora);
    const pausasSeg = cerrada ? segundosDe(cerrada.TIME_LEAKS) : j.pausasSeg;
    const trabajadoSeg = cerrada && segundosDe(cerrada.DURATION) > 0
      ? segundosDe(cerrada.DURATION)
      : trabajadoSegundos({ estado: 'terminada', inicio: j.inicio, fin: fin.toISOString(), pausasSeg }, ahora);

    try {
      await this.ctx.query(
        `INSERT INTO office_reportes_diarios (user_id, fecha, inicio, fin, trabajado_seg, pausas_seg, reporte)
         VALUES ($1, $2::date, $3::timestamptz, $4::timestamptz, $5, $6, $7)
         ON CONFLICT (user_id, fecha) DO UPDATE SET
           inicio = EXCLUDED.inicio, fin = EXCLUDED.fin, trabajado_seg = EXCLUDED.trabajado_seg,
           pausas_seg = EXCLUDED.pausas_seg, reporte = EXCLUDED.reporte, actualizado_en = now()`,
        [userId, j.fecha, j.inicio, fin.toISOString(), trabajadoSeg, pausasSeg, reporte],
      );
    } catch (e) {
      // Bitrix ya lo tiene, que es lo que ve el jefe: no se le dice «falló» a la persona.
      this.ctx.logger.error(`Jornada: no se guardó el informe de ${userId} del ${j.fecha}: ${e}`);
    }

    // Cerrar una jornada vencida de otro día no saca a nadie de la oficina de hoy.
    if (j.estado !== 'vencida') {
      await this.salirDeLaOficina(userId).catch(e => this.ctx.logger.warn(`Jornada: no se pudo salir de la oficina (${userId}): ${e}`));
    }
    return this.estado(userId, ahora);
  }

  // ── Plan del día y tareas ─────────────────────────────────────────────────

  async agregarAlPlan(userId: string, entrada: { taskId?: unknown; titulo?: unknown }, ahora = new Date()): Promise<{ taskId: number }> {
    let taskId: number;
    if (entrada.titulo != null) {
      const titulo = typeof entrada.titulo === 'string' ? entrada.titulo.trim() : '';
      if (!titulo || titulo.length > 250) throw new JornadaError(400, 'La tarea necesita un nombre (hasta 250 caracteres).');
      const bid = await this.miBitrix(userId);
      const r = await this.llamar(userId, 'tasks.task.add', { fields: { TITLE: titulo, RESPONSIBLE_ID: bid } });
      taskId = Number(r?.task?.id);
      if (!Number.isInteger(taskId) || taskId <= 0) throw new Error('[tasks.task.add] respuesta sin id');
    } else {
      taskId = Number(entrada.taskId);
      if (!Number.isInteger(taskId) || taskId <= 0) throw new JornadaError(400, 'Tarea inválida');
    }
    await this.ctx.query(
      `INSERT INTO office_plan_dia (user_id, fecha, task_id) VALUES ($1, $2::date, $3) ON CONFLICT DO NOTHING`,
      [userId, localDateString(ahora, this.tz()), taskId],
    );
    return { taskId };
  }

  /**
   * Tarea nueva desde la pestaña Tareas: con fecha de vencimiento opcional y,
   * si se pide, también al plan de hoy.
   */
  async crearTarea(userId: string, entrada: { titulo?: unknown; vence?: unknown; alPlan?: unknown }, ahora = new Date()): Promise<{ taskId: number }> {
    const titulo = typeof entrada.titulo === 'string' ? entrada.titulo.trim() : '';
    if (!titulo || titulo.length > 250) throw new JornadaError(400, 'La tarea necesita un nombre (hasta 250 caracteres).');
    const deadline = this.deadlineDe(entrada.vence);
    const bid = await this.miBitrix(userId);
    const fields: Record<string, unknown> = { TITLE: titulo, RESPONSIBLE_ID: bid };
    if (deadline) fields.DEADLINE = deadline;
    const r = await this.llamar(userId, 'tasks.task.add', { fields });
    const taskId = Number(r?.task?.id);
    if (!Number.isInteger(taskId) || taskId <= 0) throw new Error('[tasks.task.add] respuesta sin id');
    if (entrada.alPlan === true) {
      await this.ctx.query(
        `INSERT INTO office_plan_dia (user_id, fecha, task_id) VALUES ($1, $2::date, $3) ON CONFLICT DO NOTHING`,
        [userId, localDateString(ahora, this.tz()), taskId],
      );
    }
    return { taskId };
  }

  /** Cambiar (o quitar, con `null`) la fecha de vencimiento. */
  async cambiarVencimiento(userId: string, taskId: number, vence: unknown): Promise<void> {
    const deadline = vence === null || vence === '' ? '' : this.deadlineDe(vence);
    if (deadline === null) throw new JornadaError(400, 'La fecha tiene que ser como 2026-10-15.');
    await this.llamar(userId, 'tasks.task.update', { taskId, fields: { DEADLINE: deadline } });
  }

  /** «2026-10-15» → ese día a las 18:00 de la oficina, con zona. Sin fecha: undefined; mal escrita: null. */
  private deadlineDe(vence: unknown): string | null | undefined {
    if (vence === undefined || vence === null || vence === '') return undefined;
    // Que el día exista: «2026-13-40» tiene buena forma pero no es una fecha.
    const [y, m, d] = typeof vence === 'string' ? vence.split('-').map(Number) : [];
    const real = typeof vence === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(vence)
      && new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === vence;
    if (!real) {
      throw new JornadaError(400, 'La fecha tiene que ser como 2026-10-15.');
    }
    const instante = horaLocal(vence, '18:00', this.tz());
    if (!instante) throw new JornadaError(400, 'La fecha tiene que ser como 2026-10-15.');
    return isoConZona(instante, this.tz());
  }

  async quitarDelPlan(userId: string, taskId: number, ahora = new Date()): Promise<void> {
    await this.ctx.query(
      `DELETE FROM office_plan_dia WHERE user_id = $1 AND fecha = $2::date AND task_id = $3`,
      [userId, localDateString(ahora, this.tz()), taskId],
    );
  }

  async completar(userId: string, taskId: number): Promise<void> {
    await this.llamar(userId, 'tasks.task.complete', { taskId });
  }

  async registrarTiempo(userId: string, taskId: number, entrada: { minutos?: unknown; comentario?: unknown }): Promise<void> {
    const minutos = Number(entrada.minutos);
    if (!Number.isInteger(minutos) || minutos < 1 || minutos > 720) throw new JornadaError(400, 'El tiempo va de 1 minuto a 12 horas.');
    const comentario = typeof entrada.comentario === 'string' ? entrada.comentario.trim().slice(0, 1000) : '';
    await this.llamar(userId, 'task.elapseditem.add', { TASKID: taskId, ARFIELDS: { SECONDS: minutos * 60, COMMENT_TEXT: comentario } });
  }

  // ── Eventos ───────────────────────────────────────────────────────────────

  async agregarEvento(
    userId: string, entrada: { titulo?: unknown; desde?: unknown; hasta?: unknown; fueraDeOficina?: unknown }, ahora = new Date(),
  ): Promise<void> {
    const tz = this.tz();
    const titulo = typeof entrada.titulo === 'string' ? entrada.titulo.trim() : '';
    if (!titulo || titulo.length > 250) throw new JornadaError(400, 'El evento necesita un nombre (hasta 250 caracteres).');
    const hoy = localDateString(ahora, tz);
    const desde = horaLocal(hoy, entrada.desde, tz);
    const hasta = horaLocal(hoy, entrada.hasta, tz);
    if (!desde || !hasta) throw new JornadaError(400, 'Las horas tienen que ser como 14:30.');
    if (hasta <= desde) throw new JornadaError(400, 'El evento tiene que terminar después de empezar.');

    const bid = await this.miBitrix(userId);
    const seccion = await this.seccionDeCalendario(userId, bid);
    await this.llamar(userId, 'calendar.event.add', {
      type: 'user', ownerId: bid, section: seccion, name: titulo,
      from: isoConZona(desde, tz), to: isoConZona(hasta, tz), timezone_from: tz, timezone_to: tz, skip_time: 'N',
      accessibility: entrada.fueraDeOficina === true ? 'absent' : 'busy',
    });
  }

  // ── Reporte semanal / mensual ─────────────────────────────────────────────

  async reporte(userId: string, periodo: 'semana' | 'mes', anchor: Date, ahora = new Date()): Promise<Resumen & { titulo: string; texto: string }> {
    const tz = this.tz();
    const limites = periodBounds(anchor, periodo === 'semana' ? 'week' : 'month', tz);
    const span = { start: limites.start, end: limites.end < ahora ? limites.end : ahora };
    const desde = localDateString(limites.start, tz);
    const hasta = localDateString(limites.end, tz);

    const oficina = await this.oficinaPorDia(userId, span);
    const filas = await this.ctx.query<any>(
      `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, reporte, inicio, fin, trabajado_seg
         FROM office_reportes_diarios WHERE user_id = $1 AND fecha BETWEEN $2::date AND $3::date ORDER BY fecha`,
      [userId, desde, hasta],
    );
    const informes: FilaInforme[] = filas.map(f => ({
      fecha: f.fecha, reporte: f.reporte,
      inicio: f.inicio ? new Date(f.inicio).toISOString() : null,
      fin: f.fin ? new Date(f.fin).toISOString() : null,
      trabajadoSeg: Number(f.trabajado_seg) || 0,
    }));
    const bid = await this.miBitrix(userId);
    const cerradas = await this.completadasDesde(userId, bid, span.start, localDayEnd(span.end, tz));

    const resumen = armarResumen({ desde, hasta, oficina, informes, tareasCerradas: cerradas });
    const titulo = periodo === 'semana'
      ? `Semana del ${fechaCorta(desde)} al ${fechaCorta(hasta)}`
      : `${MESES[Number(desde.slice(5, 7)) - 1].replace(/^./, c => c.toUpperCase())} ${desde.slice(0, 4)}`;
    return { ...resumen, titulo, texto: textoResumen(resumen, titulo) };
  }

  // ── Internos ──────────────────────────────────────────────────────────────

  /** Todo lo del día de una vez, de a una llamada: el portal aguanta ~2 por segundo. */
  private async delDia(userId: string, ahora: Date) {
    const bid = await this.miBitrix(userId);
    const jornada = await this.estado(userId, ahora);
    const abiertas = await this.tareasAbiertas(userId, bid);
    const hechasHoy = await this.completadasDesde(userId, bid, localDayStart(ahora, this.tz()));
    // El plan de Bitrix es un extra: si falla, queda el de la oficina.
    const planBitrix = await this.llamar(userId, 'task.planner.getlist').catch(() => []);
    const eventos = await this.eventosDeHoy(userId, bid, ahora);

    const deOficina = await this.planDeOficina(userId, ahora);
    const ids = idsDelPlan(planBitrix, deOficina);
    const porId = new Map<number, Tarea>();
    for (const t of [...abiertas, ...hechasHoy]) porId.set(t.id, t);
    const enPlan = new Set(ids);
    const plan = ids.map(id => porId.get(id)).filter((t): t is Tarea => !!t)
      .sort((a, b) => Number(a.estado === 'completada') - Number(b.estado === 'completada'));
    return {
      jornada, plan, tareas: abiertas.filter(t => !enPlan.has(t.id)), eventos, hechasHoy,
      planOficina: { ids: deOficina, planBitrix },
    };
  }

  private async miBitrix(userId: string): Promise<number> {
    const bid = await this.bitrixIdDe(userId);
    if (!bid) throw new JornadaError(409, 'Tu usuario no está asociado a Bitrix. Avisale a tu administrador.');
    return bid;
  }

  private async tareasAbiertas(userId: string, bid: number): Promise<Tarea[]> {
    return this.listarTareas(userId, { RESPONSIBLE_ID: bid, REAL_STATUS: [2, 3] }, { DEADLINE: 'asc' });
  }

  private async completadasDesde(userId: string, bid: number, desde: Date, hasta?: Date): Promise<Tarea[]> {
    const tz = this.tz();
    const filtro: Record<string, unknown> = { RESPONSIBLE_ID: bid, '>=CLOSED_DATE': isoConZona(desde, tz) };
    if (hasta) filtro['<=CLOSED_DATE'] = isoConZona(hasta, tz);
    const t = await this.listarTareas(userId, filtro, { CLOSED_DATE: 'asc' });
    return t.filter(x => x.estado === 'completada');
  }

  /** `callAsUser` no devuelve `next`: se pide de a páginas hasta que una venga incompleta. */
  private async listarTareas(userId: string, filter: Record<string, unknown>, order: Record<string, string>): Promise<Tarea[]> {
    const todas: Tarea[] = [];
    for (let p = 0; p < PAGINAS_MAXIMAS; p++) {
      const r = await this.llamar(userId, 'tasks.task.list', { filter, select: CAMPOS_TAREA, order, start: p * POR_PAGINA });
      const pagina = leerTareas(r);
      todas.push(...pagina);
      if (pagina.length < POR_PAGINA) break;
    }
    return todas;
  }

  private async eventosDeHoy(userId: string, bid: number, ahora: Date): Promise<Evento[]> {
    const hoy = localDateString(ahora, this.tz());
    const crudo = await this.llamar(userId, 'calendar.event.get', { type: 'user', ownerId: bid, from: hoy, to: hoy }).catch(() => []);
    const inicio = localDayStart(ahora, this.tz()).toISOString();
    const fin = localDayEnd(ahora, this.tz()).toISOString();
    // El calendario puede traer eventos que solo rozan el día (de ayer a la noche).
    return leerEventos(crudo, this.tz()).filter(e => e.hasta > inicio && e.desde <= fin);
  }

  private async planDeOficina(userId: string, ahora: Date): Promise<number[]> {
    const filas = await this.ctx.query<{ task_id: number }>(
      `SELECT task_id FROM office_plan_dia WHERE user_id = $1 AND fecha = $2::date ORDER BY creado_en`,
      [userId, localDateString(ahora, this.tz())],
    );
    return filas.map(f => Number(f.task_id));
  }

  /** `calendar.event.add` exige una sección: la primera del calendario personal. Se recuerda un día. */
  private async seccionDeCalendario(userId: string, bid: number): Promise<number> {
    const clave = `jornada:seccion:${userId}`;
    const guardada = Number(await this.ctx.redis.get(clave));
    if (guardada > 0) return guardada;
    const secciones = await this.llamar<any[]>(userId, 'calendar.section.get', { type: 'user', ownerId: bid });
    const id = Number((Array.isArray(secciones) ? secciones : [])[0]?.ID);
    if (!(id > 0)) throw new JornadaError(409, 'No encontramos tu calendario en Bitrix.');
    await this.ctx.redis.set(clave, String(id), 86_400);
    return id;
  }
}

function fechaCorta(fecha: string): string {
  const [, m, d] = fecha.split('-').map(Number);
  return `${d}/${m}`;
}
