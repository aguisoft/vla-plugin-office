import { describe, it, expect } from 'vitest';
import {
  segundosDe, leerJornada, trabajadoSegundos, duracionTexto, horaLocal, problemaConSalida, isoConZona,
  leerTareas, leerEventos, idsDelPlan, armarBorrador, armarResumen, textoResumen, horaTexto, horaDelTexto,
} from './jornada';

const TZ = 'America/Costa_Rica';
// 2-oct-2026 10:30 en Costa Rica.
const AHORA = new Date('2026-10-02T16:30:00Z');

describe('segundosDe', () => {
  it.each([['00:00:00', 0], ['01:02:03', 3723], ['26:00:00', 93600], ['', 0], [null, 0], ['1:2:3', 0], ['08:61:00', 0]])(
    '%p → %p', (v, s) => expect(segundosDe(v)).toBe(s));
});

describe('leerJornada', () => {
  // El caso real del sondeo del 2-oct-2026: abierta a las 08:00, DURATION en cero.
  const ABIERTA = { STATUS: 'OPENED', TIME_START: '2026-10-02T08:00:08-06:00', TIME_FINISH: null, DURATION: '00:00:00', TIME_LEAKS: '00:00:00' };

  it('abierta: cuenta desde la entrada hasta ahora (DURATION no se actualiza mientras corre)', () => {
    const j = leerJornada(ABIERTA, AHORA, TZ);
    expect(j).toMatchObject({ estado: 'trabajando', fecha: '2026-10-02', pausasSeg: 0 });
    expect(j.trabajadoSeg).toBe(2 * 3600 + 30 * 60 - 8);
  });

  it('las pausas cerradas se descuentan', () => {
    const j = leerJornada({ ...ABIERTA, TIME_LEAKS: '00:30:00' }, AHORA, TZ);
    expect(j.trabajadoSeg).toBe(2 * 3600 - 8);
  });

  it('en pausa: el reloj se congela en el comienzo de la pausa', () => {
    const j = leerJornada({ ...ABIERTA, STATUS: 'PAUSED', TIME_FINISH: '2026-10-02T10:00:08-06:00' }, AHORA, TZ);
    expect(j.estado).toBe('en_pausa');
    expect(j.trabajadoSeg).toBe(2 * 3600);
    expect(trabajadoSegundos(j, new Date(AHORA.getTime() + 3_600_000))).toBe(2 * 3600);
  });

  // El caso real del 2-oct-2026: en pausa, Bitrix no manda TIME_FINISH.
  it('en pausa sin TIME_FINISH: se congela en la marca que dejó la oficina al pausar', () => {
    const pausada = { ...ABIERTA, STATUS: 'PAUSED' };
    const j = leerJornada(pausada, AHORA, TZ, '2026-10-02T16:00:08.000Z');
    expect(j).toMatchObject({ estado: 'en_pausa', fin: '2026-10-02T16:00:08.000Z', trabajadoSeg: 2 * 3600 });
    // Una hora más tarde, sigue igual.
    expect(leerJornada(pausada, new Date(AHORA.getTime() + 3_600_000), TZ, '2026-10-02T16:00:08.000Z').trabajadoSeg).toBe(2 * 3600);
  });

  it('en pausa sin marca (pausó desde Bitrix): usa DURATION si viene', () => {
    expect(leerJornada({ ...ABIERTA, STATUS: 'PAUSED', DURATION: '01:10:00' }, AHORA, TZ).trabajadoSeg).toBe(70 * 60);
  });

  it('una marca de pausa no cambia una jornada que corre, ni una marca anterior a la entrada', () => {
    expect(leerJornada(ABIERTA, AHORA, TZ, '2026-10-02T15:00:00Z').fin).toBeNull();
    expect(leerJornada({ ...ABIERTA, STATUS: 'PAUSED' }, AHORA, TZ, '2026-10-01T15:00:00Z').fin).toBeNull();
  });

  it('terminada hoy: usa la duración que calculó Bitrix', () => {
    const j = leerJornada({ ...ABIERTA, STATUS: 'CLOSED', TIME_FINISH: '2026-10-02T17:00:00-06:00', DURATION: '08:15:00', TIME_LEAKS: '00:45:00' }, AHORA, TZ);
    expect(j).toMatchObject({ estado: 'terminada', trabajadoSeg: 8 * 3600 + 15 * 60, pausasSeg: 45 * 60 });
  });

  it('la jornada cerrada de ayer no es la de hoy: hoy no empezó', () => {
    const j = leerJornada({ ...ABIERTA, STATUS: 'CLOSED', TIME_START: '2026-10-01T08:00:00-06:00', TIME_FINISH: '2026-10-01T17:00:00-06:00' }, AHORA, TZ);
    expect(j.estado).toBe('sin_iniciar');
  });

  it('entrada a las 23:30 locales de ayer, ya pasada la medianoche UTC: la fecha es la local', () => {
    const j = leerJornada({ ...ABIERTA, STATUS: 'EXPIRED', TIME_START: '2026-10-01T23:30:00-06:00' }, AHORA, TZ);
    expect(j).toMatchObject({ estado: 'vencida', fecha: '2026-10-01', trabajadoSeg: 0 });
  });

  it.each([[null], [{}], [{ STATUS: 'OPENED' }], [{ STATUS: 'RARO', TIME_START: '2026-10-02T08:00:00-06:00' }]])(
    'sin datos utilizables: sin iniciar (%p)', (s) => expect(leerJornada(s as any, AHORA, TZ).estado).toBe('sin_iniciar'));
});

describe('duracionTexto', () => {
  it.each([[0, '0 min'], [59, '0 min'], [45 * 60, '45 min'], [7 * 3600 + 5 * 60, '7 h 05 min'], [-10, '0 min']])(
    '%p → %p', (s, t) => expect(duracionTexto(s)).toBe(t));
});

describe('hora de salida', () => {
  const inicio = new Date('2026-10-02T14:00:00Z'); // 08:00 local

  it('«17:45» del día local es 23:45 UTC', () => {
    expect(horaLocal('2026-10-02', '17:45', TZ)?.toISOString()).toBe('2026-10-02T23:45:00.000Z');
  });

  it.each([['7:45'], ['24:00'], ['17:60'], [''], [undefined], ['17:45:00']])('rechaza %p', (h) => {
    expect(horaLocal('2026-10-02', h, TZ)).toBeNull();
  });

  it('antes de la entrada no sirve, y lo dice con la hora de entrada', () => {
    expect(problemaConSalida(horaLocal('2026-10-02', '07:00', TZ)!, inicio, AHORA, TZ)).toContain('08:00');
  });

  it('en el futuro no sirve, salvo el minuto de gracia', () => {
    expect(problemaConSalida(new Date(AHORA.getTime() + 5 * 60_000), inicio, AHORA, TZ)).toMatch(/más tarde que ahora/);
    expect(problemaConSalida(new Date(AHORA.getTime() + 30_000), inicio, AHORA, TZ)).toBeNull();
  });

  it('una hora razonable sirve', () => {
    expect(problemaConSalida(horaLocal('2026-10-02', '10:00', TZ)!, inicio, AHORA, TZ)).toBeNull();
  });

  it('el instante va con el desfase de Costa Rica para timeman.close', () => {
    expect(isoConZona(new Date('2026-10-02T23:45:00Z'), TZ)).toBe('2026-10-02T17:45:00-06:00');
    expect(isoConZona(new Date('2026-10-03T05:59:59Z'), TZ)).toBe('2026-10-02T23:59:59-06:00');
  });
});

describe('leerTareas', () => {
  it('lee la forma de tasks.task.list (camelCase) y traduce el estado', () => {
    const t = leerTareas({ tasks: [
      { id: '10', title: ' Informe ', status: '3', deadline: '2026-10-03T17:00:00-06:00', timeSpentInLogs: '3600', group: { name: 'Ventas' } },
      { id: '11', title: 'Lista', status: '4', closedDate: '2026-10-02T09:00:00-06:00' },
      { id: '12', title: '', status: '2' },
      { title: 'sin id' },
    ] });
    expect(t).toEqual([
      { id: 10, titulo: 'Informe', estado: 'en_curso', vence: '2026-10-03T23:00:00.000Z', cerrada: null, tiempoSeg: 3600, grupo: 'Ventas' },
      { id: 11, titulo: 'Lista', estado: 'completada', vence: null, cerrada: '2026-10-02T15:00:00.000Z', tiempoSeg: 0, grupo: null },
      { id: 12, titulo: 'Tarea 12', estado: 'pendiente', vence: null, cerrada: null, tiempoSeg: 0, grupo: null },
    ]);
  });

  it.each([[null], [{}], ['x'], [{ tasks: 'x' }]])('lo que no es una lista da vacío: %p', (c) => expect(leerTareas(c)).toEqual([]));
});

describe('leerEventos', () => {
  it('usa las marcas UTC, ordena, marca «fuera de oficina» y saca las invitaciones rechazadas', () => {
    const e = leerEventos([
      { ID: '2', NAME: 'Almuerzo con cliente', DATE_FROM_TS_UTC: '1790960400', DATE_TO_TS_UTC: '1790964000', ACCESSIBILITY: 'absent', DT_SKIP_TIME: 'N' },
      { ID: '1', NAME: 'Daily', DATE_FROM_TS_UTC: '1790949600', DATE_TO_TS_UTC: '1790951400', ACCESSIBILITY: 'busy' },
      { ID: '3', NAME: 'Rechazada', DATE_FROM_TS_UTC: '1790949600', DATE_TO_TS_UTC: '1790951400', MEETING_STATUS: 'N' },
      { ID: '4', NAME: 'Sin fecha' },
    ], TZ);
    expect(e.map(x => x.id)).toEqual(['1', '2']);
    expect(e[1]).toMatchObject({ titulo: 'Almuerzo con cliente', fueraDeOficina: true, todoElDia: false });
    expect(horaTexto(new Date(e[0].desde), TZ)).toBe('08:00');
  });

  // Lo que se vio en vivo el 2-oct-2026: la marca UTC llega 3 horas antes.
  it('el evento creado en Bitrix a las 12:00 se lee a las 12:00 aunque la marca UTC diga 09:00', () => {
    const [e] = leerEventos([{
      ID: '110193', NAME: 'Prueba VLA Oficina 2', TZ_FROM: TZ, TZ_TO: TZ,
      DATE_FROM: '10/02/2026 12:00:00 pm', DATE_TO: '10/02/2026 01:00:00 pm',
      DATE_FROM_TS_UTC: '1790953200', DATE_TO_TS_UTC: '1790956800',
    }], TZ);
    expect([e.desde, e.hasta]).toEqual(['2026-10-02T18:00:00.000Z', '2026-10-02T19:00:00.000Z']);
  });

  it('y el creado desde la oficina para las 16:00 se lee a las 16:00', () => {
    const [e] = leerEventos([{
      ID: '110191', NAME: 'Prueba', TZ_FROM: TZ, DATE_FROM: '10/02/2026 04:00:00 pm', DATE_TO: '10/02/2026 04:15:00 pm',
      DATE_FROM_TS_UTC: '1790967600', DATE_TO_TS_UTC: '1790968500',
    }], TZ);
    expect(horaTexto(new Date(e.desde), TZ)).toBe('16:00');
    expect(horaTexto(new Date(e.hasta), TZ)).toBe('16:15');
  });

  // Los ejemplos de la documentación de Bitrix, donde la marca UTC sí está bien.
  it.each([
    ['03.12.2024 10:00:00', 'Europe/Kaliningrad', '1733212800', '2024-12-03T08:00:00.000Z'],
    ['06/14/2024 05:00:00 pm', 'Europe/Riga', '1718373600', '2024-06-14T14:00:00.000Z'],
  ])('con la marca UTC correcta da lo mismo: %s en %s', (texto, zona, ts, esperado) => {
    const [e] = leerEventos([{ ID: '1', NAME: 'x', TZ_FROM: zona, DATE_FROM: texto, DATE_TO: texto, DATE_FROM_TS_UTC: ts, DATE_TO_TS_UTC: ts }], TZ);
    expect(e.desde).toBe(esperado);
  });

  it('un evento de todo el día va de medianoche a medianoche local, aunque la marca esté corrida', () => {
    const [e] = leerEventos([{
      ID: '9', NAME: 'Feriado', DT_SKIP_TIME: 'Y', DATE_FROM: '10/02/2026', DATE_TO: '10/02/2026',
      DATE_FROM_TS_UTC: '1790910000', DATE_TO_TS_UTC: '1790910000',
    }], TZ);
    expect([e.desde, e.hasta, e.todoElDia]).toEqual(['2026-10-02T06:00:00.000Z', '2026-10-03T06:00:00.000Z', true]);
  });

  it('una zona que no existe usa la de la oficina; sin hora legible queda la marca', () => {
    const [a] = leerEventos([{ ID: '1', NAME: 'x', TZ_FROM: 'Marte/Base', DATE_FROM: '10/02/2026 12:00:00 pm', DATE_TO: '10/02/2026 12:00:00 pm', DATE_FROM_TS_UTC: '1790953200', DATE_TO_TS_UTC: '1790953200' }], TZ);
    expect(a.desde).toBe('2026-10-02T18:00:00.000Z');
    const [b] = leerEventos([{ ID: '2', NAME: 'x', DATE_FROM: 'ilegible', DATE_TO: 'ilegible', DATE_FROM_TS_UTC: '1790953200', DATE_TO_TS_UTC: '1790953200' }], TZ);
    expect(b.desde).toBe('2026-10-02T15:00:00.000Z');
  });
});

describe('horaDelTexto', () => {
  it.each([
    ['10/02/2026 12:00:00 pm', { h: 12, m: 0, s: 0 }],
    ['10/02/2026 12:30:00 am', { h: 0, m: 30, s: 0 }],
    ['10/02/2026 04:15:09 PM', { h: 16, m: 15, s: 9 }],
    ['02.10.2026 16:00:00', { h: 16, m: 0, s: 0 }],
    ['2/10/2026 4:00 p. m.', { h: 16, m: 0, s: 0 }],
  ])('%s', (t, h) => expect(horaDelTexto(t)).toEqual(h));

  it.each([['10/02/2026'], ['25:00:00'], ['13:00:00 pm'], [''], [null]])('no lee %p', (t) => expect(horaDelTexto(t)).toBeNull());
});

describe('idsDelPlan', () => {
  it('une el plan de Bitrix y el de la oficina, sin repetir ni basura', () => {
    expect(idsDelPlan(['5', 7, 'x', -1], [7, 9])).toEqual([5, 7, 9]);
    expect(idsDelPlan(null, [3])).toEqual([3]);
  });
});

describe('armarBorrador', () => {
  const t = (id: number, titulo: string) => ({ id, titulo, estado: 'en_curso' as const, vence: null, cerrada: null, tiempoSeg: 0, grupo: null });
  const ev = (titulo: string, desde: string, hasta: string, todoElDia = false) => ({ id: titulo, titulo, desde, hasta, todoElDia, fueraDeOficina: false });

  it('como el de Bitrix: completadas, en curso y reuniones con hora', () => {
    expect(armarBorrador({
      completadas: [t(1, 'Cotización Acme')],
      enCurso: [t(2, 'Informe mensual')],
      eventos: [ev('Daily', '2026-10-02T15:00:00Z', '2026-10-02T15:30:00Z'), ev('Feriado', '2026-10-02T06:00:00Z', '2026-10-03T06:00:00Z', true)],
      tz: TZ,
    })).toBe('Tareas completadas:\n- Cotización Acme\n\nTareas en curso:\n- Informe mensual\n\nReuniones y eventos:\n- 09:00–09:30 Daily');
  });

  it('sin nada que contar queda vacío para que la persona escriba', () => {
    expect(armarBorrador({ completadas: [], enCurso: [], eventos: [], tz: TZ })).toBe('');
  });
});

describe('resumen del período', () => {
  const r = armarResumen({
    desde: '2026-09-28', hasta: '2026-10-04',
    oficina: [{ date: '2026-09-28', minutes: 480 }, { date: '2026-09-29', minutes: 420 }, { date: '2026-09-30', minutes: 0 }],
    informes: [{ fecha: '2026-09-29', reporte: 'Cerré la cotización', inicio: null, fin: null, trabajadoSeg: 7 * 3600 }, { fecha: '2026-10-01', reporte: 'Capacitación', inicio: null, fin: null, trabajadoSeg: 0 }],
    tareasCerradas: [
      { id: 2, titulo: 'B', estado: 'completada', vence: null, cerrada: '2026-09-30T15:00:00Z', tiempoSeg: 0, grupo: null },
      { id: 1, titulo: 'A', estado: 'completada', vence: null, cerrada: '2026-09-29T15:00:00Z', tiempoSeg: 0, grupo: null },
    ],
  });

  it('suma el tiempo en oficina, cuenta días con tiempo o con informe y promedia', () => {
    expect(r).toMatchObject({ totalMin: 900, diasTrabajados: 3, promedioMinPorDia: 300 });
    expect(r.dias.map(d => d.fecha)).toEqual(['2026-09-28', '2026-09-29', '2026-10-01']);
    expect(r.tareasCerradas.map(t => t.titulo)).toEqual(['A', 'B']);
  });

  it('el texto para copiar trae totales, tareas e informes por día', () => {
    const txt = textoResumen(r, 'Semana del 28/9 al 4/10');
    expect(txt).toContain('Tiempo en la oficina: 15 h 00 min en 3 días (promedio 5 h 00 min por día)');
    expect(txt).toContain('Tareas completadas (2):\n- A\n- B');
    expect(txt).toContain('martes 29/9:\nCerré la cotización');
    expect(txt).toContain('jueves 1/10:\nCapacitación');
  });
});
