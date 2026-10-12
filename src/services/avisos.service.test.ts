import { describe, it, expect, vi } from 'vitest';
import type { PluginContext } from '@vla/plugin-sdk';
import { AvisosService } from './avisos.service';

/** Base en memoria que entiende las consultas del servicio. */
function armar(o: { conEscritorio?: string[]; bitrixFalla?: boolean; correoFalla?: boolean } = {}) {
  const filas: any[] = [];
  let n = 0;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const p = params as any[];
    if (sql.startsWith('INSERT INTO office_avisos')) {
      const f = { id: String(++n), user_id: p[0], tipo: p[1], titulo: p[2], cuerpo: p[3], url: p[4], creado_en: new Date(Date.UTC(2026, 9, 12, 15, 0, n)), leido_en: null };
      filas.push(f); return [f];
    }
    if (sql.startsWith('SELECT count(*)')) return [{ n: filas.filter(f => f.user_id === p[0] && !f.leido_en).length }];
    if (sql.startsWith('SELECT id::text')) return filas.filter(f => f.user_id === p[0]).sort((a, b) => b.creado_en - a.creado_en);
    if (sql.startsWith('UPDATE office_avisos')) {
      const ids = p.slice(1);
      const tocadas = filas.filter(f => f.user_id === p[0] && !f.leido_en && (!sql.includes(' IN (') || ids.includes(f.id)));
      for (const f of tocadas) f.leido_en = new Date();
      return tocadas.map(f => ({ id: f.id }));
    }
    throw new Error(`consulta no esperada: ${sql.slice(0, 60)}`);
  });
  const doAction = vi.fn(async () => undefined);
  const ctx = { query, hooks: { doAction }, logger: { warn: vi.fn(), log: vi.fn(), error: vi.fn() } } as unknown as PluginContext;
  const enVivo: Array<{ userId: string; payload: any }> = [];
  const vivo = {
    broadcastToUser: (userId: string, payload: object) => { enVivo.push({ userId, payload }); },
    escritorioConectado: (userId: string) => (o.conEscritorio ?? []).includes(userId),
  };
  const bitrix = vi.fn(async () => { if (o.bitrixFalla) throw new Error('Bitrix caído'); });
  const correo = vi.fn(async () => { if (o.correoFalla) throw new Error('SES caído'); });
  return { svc: new AvisosService(ctx, vivo, bitrix, correo), filas, enVivo, doAction, bitrix, correo, ctx };
}

const AVISO = { tipo: 'solicitud.nueva', titulo: 'Solicitud de tu equipo', cuerpo: 'Ana pidió vacaciones del 26 al 30 oct', url: '/dashboard/office?solicitudes=1' };

describe('AvisosService.avisar', () => {
  it('guarda, avisa en vivo, manda al navegador a quien no tiene la app y va por Bitrix', async () => {
    const { svc, filas, enVivo, doAction, bitrix } = armar();
    await svc.avisar(['jefe'], { ...AVISO, bitrix: 'Ana pidió vacaciones' });

    expect(filas).toHaveLength(1);
    expect(enVivo).toEqual([{ userId: 'jefe', payload: { type: 'aviso', emergente: true, aviso: expect.objectContaining({ id: '1', titulo: 'Solicitud de tu equipo', url: '/dashboard/office?solicitudes=1' }) } }]);
    expect(doAction).toHaveBeenCalledWith('core.push.send', { userId: 'jefe', title: 'Solicitud de tu equipo', body: AVISO.cuerpo, url: '/dashboard/office?solicitudes=1' });
    expect(bitrix).toHaveBeenCalledWith('jefe', 'Ana pidió vacaciones');
  });

  it('con la app de escritorio conectada no hay aviso del navegador: un solo aviso de Windows', async () => {
    const { svc, enVivo, doAction } = armar({ conEscritorio: ['jefe'] });
    await svc.avisar(['jefe', 'rrhh'], AVISO);
    expect(enVivo.map(e => e.userId)).toEqual(['jefe', 'rrhh']);
    expect(doAction).toHaveBeenCalledTimes(1);
    expect(doAction).toHaveBeenCalledWith('core.push.send', expect.objectContaining({ userId: 'rrhh' }));
  });

  it('sin guardar ni emergente solo queda el aviso del navegador (lo que la pantalla ya muestra sola)', async () => {
    const { svc, filas, enVivo, doAction } = armar();
    await svc.avisar(['beto'], { tipo: 'reunion.invitacion', titulo: 'Invitación a reunión', cuerpo: 'Ana te invita', guardar: false, emergente: false });
    expect(filas).toHaveLength(0);
    expect(enVivo).toHaveLength(0);
    expect(doAction).toHaveBeenCalledTimes(1);
  });

  it('guardado pero no emergente: la web suma la campana sin cartel', async () => {
    const { svc, enVivo } = armar();
    await svc.avisar(['beto'], { ...AVISO, emergente: false });
    expect(enVivo[0].payload.emergente).toBe(false);
  });

  it('una url externa no sale: el navegador abre la oficina', async () => {
    const { svc, filas, doAction } = armar();
    await svc.avisar(['beto'], { ...AVISO, url: 'https://otro.com' });
    expect(filas[0].url).toBeNull();
    expect(doAction).toHaveBeenCalledWith('core.push.send', expect.objectContaining({ url: '/dashboard/office' }));
  });

  it('si Bitrix falla, lo demás ya salió y la persona siguiente también recibe', async () => {
    const { svc, filas, ctx } = armar({ bitrixFalla: true });
    await svc.avisar(['a', 'b'], { ...AVISO, bitrix: 'x' });
    expect(filas.map(f => f.user_id)).toEqual(['a', 'b']);
    expect(ctx.logger.warn).toHaveBeenCalled();
  });
});

describe('AvisosService: la campana', () => {
  it('lista los últimos primero con cuántos no leyó, y marcar leídos baja el número', async () => {
    const { svc } = armar();
    await svc.avisar(['ana'], { ...AVISO, titulo: 'uno' });
    await svc.avisar(['ana'], { ...AVISO, titulo: 'dos' });
    await svc.avisar(['beto'], { ...AVISO, titulo: 'de otro' });

    const l = await svc.lista('ana');
    expect(l.avisos.map(a => a.titulo)).toEqual(['dos', 'uno']);
    expect(l.sinLeer).toBe(2);

    expect(await svc.marcarLeidos('ana', ['1'])).toBe(1);
    expect((await svc.lista('ana')).sinLeer).toBe(1);
    expect(await svc.marcarLeidos('ana')).toBe(1);
    expect((await svc.lista('ana')).sinLeer).toBe(0);
  });

  it('no marca avisos ajenos ni acepta ids que no son números', async () => {
    const { svc } = armar();
    await svc.avisar(['beto'], AVISO);
    expect(await svc.marcarLeidos('ana', ['1'])).toBe(0);
    expect(await svc.marcarLeidos('beto', ["1' OR 1=1"])).toBe(0);
    expect((await svc.lista('beto')).sinLeer).toBe(1);
  });
});

describe('AvisosService: correo', () => {
  it('solo los avisos que lo piden van por correo', async () => {
    const { svc, correo } = armar();
    await svc.avisar(['jefe'], { ...AVISO, correo: true });
    await svc.avisar(['jefe'], { ...AVISO, titulo: 'sin correo' });
    expect(correo).toHaveBeenCalledTimes(1);
    expect(correo).toHaveBeenCalledWith('jefe', expect.objectContaining({ titulo: 'Solicitud de tu equipo', url: '/dashboard/office?solicitudes=1' }));
  });
  it('si el correo falla, el resto ya salió y queda en el log', async () => {
    const { svc, filas, doAction, ctx } = armar({ correoFalla: true });
    await svc.avisar(['jefe'], { ...AVISO, correo: true });
    expect(filas).toHaveLength(1);
    expect(doAction).toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Correo a jefe falló'));
  });
});
