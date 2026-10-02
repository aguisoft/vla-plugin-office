import { describe, it, expect, vi } from 'vitest';
import { JornadaService, JornadaError } from './jornada.service';

const TZ = 'America/Costa_Rica';
// Viernes 2-oct-2026, 16:30 en Costa Rica.
const AHORA = new Date('2026-10-02T22:30:00Z');

const ABIERTA = { STATUS: 'OPENED', TIME_START: '2026-10-02T08:00:00-06:00', TIME_FINISH: null, DURATION: '00:00:00', TIME_LEAKS: '00:15:00' };
const CERRADA = { STATUS: 'CLOSED', TIME_START: '2026-10-02T08:00:00-06:00', TIME_FINISH: '2026-10-02T16:30:00-06:00', DURATION: '08:15:00', TIME_LEAKS: '00:15:00' };

type Respuestas = Record<string, (params: any) => unknown>;

function armar(respuestas: Respuestas = {}, opciones: { bitrixId?: number | null } = {}) {
  const llamadas: Array<{ method: string; params: any }> = [];
  let status: any = ABIERTA;
  const base: Respuestas = {
    'timeman.status': () => status,
    'timeman.close': () => { status = CERRADA; return true; },
    'timeman.pause': () => { status = { ...status, STATUS: 'PAUSED', TIME_FINISH: '2026-10-02T16:30:00-06:00' }; return true; },
    'timeman.open': () => { status = { ...status, STATUS: 'OPENED', TIME_FINISH: null }; return true; },
    'tasks.task.list': () => ({ tasks: [] }),
    'task.planner.getlist': () => [],
    'calendar.event.get': () => [],
    ...respuestas,
  };
  const llamar = vi.fn(async (_u: string, method: string, params: any = {}) => {
    llamadas.push({ method, params });
    const r = base[method];
    if (!r) throw new Error(`[${method}] no esperado en la prueba`);
    return r(params) as any;
  });
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  const plan: number[] = [];
  const ctx = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      consultas.push({ sql, params });
      if (/^\s*INSERT INTO office_plan_dia/.test(sql)) plan.push(params[2] as number);
      if (/FROM office_plan_dia/.test(sql)) return plan.map(task_id => ({ task_id }));
      if (/FROM office_reportes_diarios/.test(sql)) return [{ fecha: '2026-09-29', reporte: 'Cerré Acme', inicio: '2026-09-29T14:00:00Z', fin: '2026-09-29T23:00:00Z', trabajado_seg: 30000 }];
      return [];
    }),
    redis: (() => { const m = new Map<string, string>(); return { get: vi.fn(async (k: string) => m.get(k) ?? null), set: vi.fn(async (k: string, v: string) => { m.set(k, v); }) }; })(),
    logger: { warn: vi.fn(), error: vi.fn(), log: vi.fn() },
  };
  const salir = vi.fn(async () => undefined);
  const oficina = vi.fn(async () => [{ date: '2026-09-28', minutes: 480 }, { date: '2026-09-29', minutes: 500 }]);
  const svc = new JornadaService(ctx as any, llamar as any, () => TZ, async () => (opciones.bitrixId === undefined ? 949 : opciones.bitrixId), oficina, salir);
  return { svc, llamar, llamadas, consultas, salir, ctx, oficina, ponerStatus: (s: any) => { status = s; } };
}

/** La trampa de ctx.query: un Date o un arreglo como parámetro revienta recién en producción. */
function paramsSeguros(consultas: Array<{ params: unknown[] }>) {
  for (const c of consultas) for (const p of c.params) {
    expect(p instanceof Date || Array.isArray(p) || (typeof p === 'object' && p !== null)).toBe(false);
  }
}

const tarea = (id: number, title: string, status: string, extra: Record<string, unknown> = {}) => ({ id: String(id), title, status, ...extra });

describe('terminar la jornada', () => {
  it('manda el informe a Bitrix, guarda la copia y sale de la oficina', async () => {
    const { svc, llamadas, consultas, salir } = armar();
    const j = await svc.terminar('ana', { reporte: '  Cerré la cotización Acme  ' }, AHORA);

    const cierre = llamadas.find(l => l.method === 'timeman.close')!;
    expect(cierre.params).toEqual({ REPORT: 'Cerré la cotización Acme' });
    const insert = consultas.find(c => /INSERT INTO office_reportes_diarios/.test(c.sql))!;
    expect(insert.params).toEqual(['ana', '2026-10-02', '2026-10-02T14:00:00.000Z', '2026-10-02T22:30:00.000Z', 8 * 3600 + 15 * 60, 15 * 60, 'Cerré la cotización Acme']);
    expect(salir).toHaveBeenCalledWith('ana');
    expect(j.estado).toBe('terminada');
    paramsSeguros(consultas);
  });

  it('con hora de salida, la manda con el desfase de Costa Rica', async () => {
    const { svc, llamadas } = armar();
    await svc.terminar('ana', { reporte: 'Listo', hora: '16:00' }, AHORA);
    expect(llamadas.find(l => l.method === 'timeman.close')!.params).toEqual({ REPORT: 'Listo', TIME: '2026-10-02T16:00:00-06:00' });
  });

  it.each([
    [{ reporte: '' }, 400, /Escribí qué hiciste/],
    [{ reporte: '   ' }, 400, /Escribí qué hiciste/],
    [{ reporte: 'x'.repeat(5001) }, 400, /muy largo/],
    [{ reporte: 'ok', hora: '7:00' }, 400, /como 17:45/],
    [{ reporte: 'ok', hora: '07:00' }, 400, /después de la entrada \(08:00\)/],
    [{ reporte: 'ok', hora: '18:00' }, 400, /más tarde que ahora/],
  ])('rechaza %p sin tocar Bitrix', async (entrada, status, mensaje) => {
    const { svc, llamadas, salir } = armar();
    const e = await svc.terminar('ana', entrada, AHORA).catch(x => x);
    expect(e).toBeInstanceOf(JornadaError);
    expect(e).toMatchObject({ status });
    expect(e.message).toMatch(mensaje);
    expect(llamadas.some(l => l.method === 'timeman.close')).toBe(false);
    expect(salir).not.toHaveBeenCalled();
  });

  it('una jornada ya cerrada no se vuelve a cerrar', async () => {
    const { svc, llamadas, ponerStatus } = armar();
    ponerStatus(CERRADA);
    await expect(svc.terminar('ana', { reporte: 'ok' }, AHORA)).rejects.toMatchObject({ status: 409 });
    expect(llamadas.some(l => l.method === 'timeman.close')).toBe(false);
  });

  it('una jornada vencida de ayer pide la hora, se cierra ese día y NO saca de la oficina de hoy', async () => {
    const { svc, llamadas, salir, consultas, ponerStatus } = armar({
      'timeman.close': () => true,
    });
    ponerStatus({ STATUS: 'EXPIRED', TIME_START: '2026-10-01T08:00:00-06:00', TIME_FINISH: null, DURATION: '00:00:00', TIME_LEAKS: '00:00:00' });
    await expect(svc.terminar('ana', { reporte: 'ok' }, AHORA)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/2026-10-01.*a qué hora/) });

    await svc.terminar('ana', { reporte: 'Lo de ayer', hora: '17:30' }, AHORA);
    expect(llamadas.find(l => l.method === 'timeman.close')!.params.TIME).toBe('2026-10-01T17:30:00-06:00');
    expect(consultas.find(c => /INSERT INTO office_reportes_diarios/.test(c.sql))!.params[1]).toBe('2026-10-01');
    expect(salir).not.toHaveBeenCalled();
  });

  it('si la copia local no se guarda, igual responde bien: Bitrix ya lo tiene', async () => {
    const a = armar();
    a.ctx.query.mockRejectedValueOnce(new Error('se cayó la base'));
    await expect(a.svc.terminar('ana', { reporte: 'ok' }, AHORA)).resolves.toMatchObject({ estado: 'terminada' });
    expect(a.ctx.logger.error).toHaveBeenCalled();
  });
});

describe('pausa', () => {
  it('pausa y reanuda con los métodos de Bitrix, solo desde el estado que corresponde', async () => {
    const { svc, llamadas } = armar();
    expect((await svc.pausar('ana')).estado).toBe('en_pausa');
    await expect(svc.pausar('ana')).rejects.toMatchObject({ status: 409 });
    expect((await svc.reanudar('ana')).estado).toBe('trabajando');
    await expect(svc.reanudar('ana')).rejects.toMatchObject({ status: 409 });
    expect(llamadas.filter(l => /timeman\.(pause|open)/.test(l.method)).map(l => l.method)).toEqual(['timeman.pause', 'timeman.open']);
  });
});

describe('panel del día', () => {
  const respuestas: Respuestas = {
    'tasks.task.list': (p) => p.filter.REAL_STATUS
      ? { tasks: [tarea(1, 'Abierta en plan', '3'), tarea(2, 'Abierta suelta', '2')] }
      : { tasks: [tarea(3, 'Hecha hoy en plan', '5', { closedDate: '2026-10-02T10:00:00-06:00' })] },
    'task.planner.getlist': () => ['3'],
  };

  it('el plan junta el de Bitrix y el de la oficina, con lo completado al final', async () => {
    const { svc } = armar(respuestas);
    await svc.agregarAlPlan('ana', { taskId: 1 }, AHORA);
    const p = await svc.panel('ana', AHORA);
    expect(p.plan.map(t => [t.id, t.estado])).toEqual([[1, 'en_curso'], [3, 'completada']]);
    expect(p.tareas.map(t => t.id)).toEqual([2]);
    expect(p.jornada.estado).toBe('trabajando');
  });

  it('pide las tareas propias y las cerradas desde el comienzo del día local', async () => {
    const { svc, llamadas } = armar(respuestas);
    await svc.panel('ana', AHORA);
    const listas = llamadas.filter(l => l.method === 'tasks.task.list');
    expect(listas[0].params.filter).toEqual({ RESPONSIBLE_ID: 949, REAL_STATUS: [2, 3] });
    expect(listas[1].params.filter).toEqual({ RESPONSIBLE_ID: 949, '>=CLOSED_DATE': '2026-10-02T00:00:00-06:00' });
  });

  it('si el planificador de Bitrix falla, queda el plan de la oficina', async () => {
    const { svc } = armar({ ...respuestas, 'task.planner.getlist': () => { throw new Error('[task.planner.getlist] ERROR'); } });
    await svc.agregarAlPlan('ana', { taskId: 2 }, AHORA);
    expect((await svc.panel('ana', AHORA)).plan.map(t => t.id)).toEqual([2]);
  });

  it('sin usuario de Bitrix asociado lo dice, sin llamar a Bitrix', async () => {
    const { svc, llamar } = armar({}, { bitrixId: null });
    await expect(svc.panel('ana', AHORA)).rejects.toMatchObject({ status: 409 });
    expect(llamar).not.toHaveBeenCalled();
  });

  it('pagina las tareas de a 50 hasta una página incompleta', async () => {
    let pedidas = 0;
    const { svc, llamadas } = armar({
      'tasks.task.list': (p) => {
        if (!p.filter.REAL_STATUS) return { tasks: [] };
        pedidas++;
        const n = p.start === 0 ? 50 : 3;
        return { tasks: Array.from({ length: n }, (_, i) => tarea(p.start + i + 1, `T${i}`, '2')) };
      },
    });
    expect((await svc.panel('ana', AHORA)).tareas).toHaveLength(53);
    expect(pedidas).toBe(2);
    expect(llamadas.filter(l => l.method === 'tasks.task.list' && l.params.filter.REAL_STATUS).map(l => l.params.start)).toEqual([0, 50]);
  });
});

describe('borrador del informe', () => {
  it('trae lo cerrado hoy (aunque no estuviera en el plan), lo pendiente del plan y las reuniones', async () => {
    const { svc } = armar({
      'tasks.task.list': (p) => p.filter.REAL_STATUS
        ? { tasks: [tarea(1, 'Informe mensual', '3')] }
        : { tasks: [tarea(7, 'Cotización Acme', '5', { closedDate: '2026-10-02T11:00:00-06:00' })] },
      'calendar.event.get': () => [{ ID: 1, NAME: 'Daily', DATE_FROM_TS_UTC: String(Date.parse('2026-10-02T15:00:00Z') / 1000), DATE_TO_TS_UTC: String(Date.parse('2026-10-02T15:30:00Z') / 1000) }],
    });
    await svc.agregarAlPlan('ana', { taskId: 1 }, AHORA);
    const b = await svc.borrador('ana', AHORA);
    expect(b.reporte).toBe('Tareas completadas:\n- Cotización Acme\n\nTareas en curso:\n- Informe mensual\n\nReuniones y eventos:\n- 09:00–09:30 Daily');
    expect(b).toMatchObject({ pideHora: false, horaSugerida: '16:30' });
  });
});

describe('plan, tareas y tiempo', () => {
  it('una tarea nueva se crea en Bitrix a nombre de la persona y entra al plan de hoy', async () => {
    const { svc, llamadas, consultas } = armar({ 'tasks.task.add': () => ({ task: { id: '321' } }) });
    expect(await svc.agregarAlPlan('ana', { titulo: '  Llamar a Acme ' }, AHORA)).toEqual({ taskId: 321 });
    expect(llamadas.find(l => l.method === 'tasks.task.add')!.params).toEqual({ fields: { TITLE: 'Llamar a Acme', RESPONSIBLE_ID: 949 } });
    expect(consultas.find(c => /INSERT INTO office_plan_dia/.test(c.sql))!.params).toEqual(['ana', '2026-10-02', 321]);
    paramsSeguros(consultas);
  });

  it.each([[{ titulo: '' }], [{ titulo: 'x'.repeat(251) }], [{ taskId: 'abc' }], [{ taskId: -1 }], [{}]])('rechaza %p', async (entrada) => {
    const { svc, llamar } = armar();
    await expect(svc.agregarAlPlan('ana', entrada as any, AHORA)).rejects.toMatchObject({ status: 400 });
    expect(llamar).not.toHaveBeenCalled();
  });

  it('el tiempo se carga en segundos con los nombres que espera task.elapseditem.add', async () => {
    const { svc, llamadas } = armar({ 'task.elapseditem.add': () => 55 });
    await svc.registrarTiempo('ana', 12, { minutos: 90, comentario: ' Revisión ' });
    expect(llamadas[0]).toEqual({ method: 'task.elapseditem.add', params: { TASKID: 12, ARFIELDS: { SECONDS: 5400, COMMENT_TEXT: 'Revisión' } } });
  });

  it.each([[0], [721], [1.5], ['x']])('rechaza %p minutos', async (minutos) => {
    const { svc, llamar } = armar();
    await expect(svc.registrarTiempo('ana', 12, { minutos })).rejects.toMatchObject({ status: 400 });
    expect(llamar).not.toHaveBeenCalled();
  });

  it('completar usa tasks.task.complete', async () => {
    const { svc, llamadas } = armar({ 'tasks.task.complete': () => ({ task: {} }) });
    await svc.completar('ana', 12);
    expect(llamadas).toEqual([{ method: 'tasks.task.complete', params: { taskId: 12 } }]);
  });
});

describe('eventos', () => {
  it('crea el evento en su calendario, «fuera de la oficina» como ausente, y recuerda la sección', async () => {
    const { svc, llamadas } = armar({ 'calendar.section.get': () => [{ ID: '17', NAME: 'Mi calendario' }], 'calendar.event.add': () => 99 });
    await svc.agregarEvento('ana', { titulo: 'Visita a cliente', desde: '14:00', hasta: '15:30', fueraDeOficina: true }, AHORA);
    await svc.agregarEvento('ana', { titulo: 'Llamada', desde: '16:00', hasta: '16:15' }, AHORA);
    const altas = llamadas.filter(l => l.method === 'calendar.event.add');
    expect(altas[0].params).toEqual({
      type: 'user', ownerId: 949, section: 17, name: 'Visita a cliente',
      from: '2026-10-02T14:00:00-06:00', to: '2026-10-02T15:30:00-06:00', timezone_from: TZ, timezone_to: TZ, skip_time: 'N',
      accessibility: 'absent',
    });
    expect(altas[1].params.accessibility).toBe('busy');
    expect(llamadas.filter(l => l.method === 'calendar.section.get')).toHaveLength(1);
  });

  it.each([
    [{ titulo: '', desde: '10:00', hasta: '11:00' }, /nombre/],
    [{ titulo: 'x', desde: '10', hasta: '11:00' }, /como 14:30/],
    [{ titulo: 'x', desde: '11:00', hasta: '10:00' }, /terminar después/],
  ])('rechaza %p', async (entrada, mensaje) => {
    const { svc, llamar } = armar();
    await expect(svc.agregarEvento('ana', entrada, AHORA)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(mensaje) });
    expect(llamar).not.toHaveBeenCalled();
  });
});

describe('reporte semanal y mensual', () => {
  it('semana de lunes a domingo: tiempo en oficina, informes y tareas cerradas, con texto para copiar', async () => {
    const { svc, consultas, llamadas, oficina } = armar({
      'tasks.task.list': () => ({ tasks: [tarea(5, 'Cotización Acme', '5', { closedDate: '2026-09-29T11:00:00-06:00' })] }),
    });
    const r = await svc.reporte('ana', 'semana', new Date('2026-10-02T12:00:00Z'), AHORA);

    expect(r).toMatchObject({ desde: '2026-09-28', hasta: '2026-10-04', titulo: 'Semana del 28/9 al 4/10', totalMin: 980, diasTrabajados: 2 });
    // El período que incluye hoy se corta en ahora.
    expect((oficina.mock.calls[0] as any[])[1].end.toISOString()).toBe(AHORA.toISOString());
    expect(consultas.find(c => /FROM office_reportes_diarios/.test(c.sql))!.params).toEqual(['ana', '2026-09-28', '2026-10-04']);
    expect(llamadas.find(l => l.method === 'tasks.task.list')!.params.filter).toEqual({
      RESPONSIBLE_ID: 949, '>=CLOSED_DATE': '2026-09-28T00:00:00-06:00', '<=CLOSED_DATE': '2026-10-02T23:59:59-06:00',
    });
    expect(r.texto).toContain('Tareas completadas (1):\n- Cotización Acme');
    expect(r.texto).toContain('martes 29/9:\nCerré Acme');
    paramsSeguros(consultas);
  });

  it('el mes lleva su nombre', async () => {
    const { svc } = armar();
    const r = await svc.reporte('ana', 'mes', new Date('2026-10-02T12:00:00Z'), AHORA);
    expect(r).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-31', titulo: 'Octubre 2026' });
  });
});
