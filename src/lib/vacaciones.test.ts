import { describe, it, expect } from 'vitest';
import {
  diaDeReintegro, resumenRango,
  diasHabiles, mesesCumplidos, calcularSaldo, validarSolicitud, ajustePara,
  SALDO_INICIAL, DEVENGO_MENSUAL, TOPE_ALERTA,
} from './vacaciones';

const TZ = 'America/Costa_Rica';
/** Mediodía local: lo que ve el servidor al anclar una fecha del formulario. */
const dia = (f: string) => new Date(f + 'T18:00:00.000Z');

describe('diasHabiles', () => {
  it('cuenta de lunes a viernes', () => {
    // 2026-10-05 lunes … 2026-10-09 viernes
    expect(diasHabiles('2026-10-05', '2026-10-09', [], TZ)).toBe(5);
  });

  it('salta el fin de semana', () => {
    // lunes 5 a viernes 16: dos semanas de trabajo, no 12 días
    expect(diasHabiles('2026-10-05', '2026-10-16', [], TZ)).toBe(10);
  });

  it('un solo día cuenta uno', () => {
    expect(diasHabiles('2026-10-07', '2026-10-07', [], TZ)).toBe(1);
  });

  it('un sábado solo no cuenta nada', () => {
    expect(diasHabiles('2026-10-10', '2026-10-10', [], TZ)).toBe(0);
  });

  it('descuenta los feriados que caen en día hábil', () => {
    expect(diasHabiles('2026-10-05', '2026-10-09', ['2026-10-07'], TZ)).toBe(4);
  });

  it('un feriado en sábado no descuenta de más', () => {
    // ese día ya no contaba: restarlo otra vez daría 9
    expect(diasHabiles('2026-10-05', '2026-10-16', ['2026-10-10'], TZ)).toBe(10);
  });

  it('rango invertido da cero en vez de contar al revés', () => {
    expect(diasHabiles('2026-10-09', '2026-10-05', [], TZ)).toBe(0);
  });

  it('un año entero no se cuelga ni se desvía', () => {
    // 2026 tiene 261 días de lunes a viernes
    expect(diasHabiles('2026-01-01', '2026-12-31', [], TZ)).toBe(261);
  });
});

describe('mesesCumplidos', () => {
  it('el mismo día no cumple nada', () => {
    expect(mesesCumplidos(dia('2026-10-06'), dia('2026-10-06'), TZ)).toBe(0);
  });

  it('un día antes del aniversario todavía no cumple', () => {
    expect(mesesCumplidos(dia('2026-10-20'), dia('2026-11-19'), TZ)).toBe(0);
  });

  it('el día del aniversario cumple', () => {
    expect(mesesCumplidos(dia('2026-10-20'), dia('2026-11-20'), TZ)).toBe(1);
  });

  it('cuenta a través del cambio de año', () => {
    expect(mesesCumplidos(dia('2026-10-06'), dia('2027-10-06'), TZ)).toBe(12);
  });

  it('una fecha anterior al corte no devuelve negativos', () => {
    expect(mesesCumplidos(dia('2026-10-06'), dia('2026-01-01'), TZ)).toBe(0);
  });
});

describe('calcularSaldo', () => {
  const corte = dia('2026-10-06');

  it('arranca en el saldo inicial', () => {
    const s = calcularSaldo({ corte, ahora: dia('2026-10-06'), tz: TZ });
    expect(s.saldo).toBe(SALDO_INICIAL);
    expect(s.mesesDevengados).toBe(0);
    expect(s.superaTope).toBe(false);
  });

  it('suma 1,25 por mes cumplido', () => {
    const s = calcularSaldo({ corte, ahora: dia('2026-12-06'), tz: TZ });
    expect(s.devengado).toBe(SALDO_INICIAL + 2 * DEVENGO_MENSUAL);   // 17,5
    expect(s.saldo).toBe(17.5);
  });

  it('a los cuatro meses sin tomar nada llega al tope, y al quinto lo supera', () => {
    const s = calcularSaldo({ corte, ahora: dia('2027-02-06'), tz: TZ });
    expect(s.saldo).toBe(20);
    expect(s.superaTope).toBe(false);          // 20 justo todavía no lo supera
    const s2 = calcularSaldo({ corte, ahora: dia('2027-03-06'), tz: TZ });
    expect(s2.saldo).toBe(21.25);
    expect(s2.superaTope).toBe(true);
  });

  it('descuenta lo aprobado', () => {
    const s = calcularSaldo({
      corte, ahora: dia('2026-12-06'), tz: TZ,
      aprobadas: [{ desde: '2026-11-02', hasta: '2026-11-06' }],     // 5 hábiles
    });
    expect(s.tomados).toBe(5);
    expect(s.saldo).toBe(12.5);
  });

  it('el feriado dentro de unas vacaciones no se gasta', () => {
    const s = calcularSaldo({
      corte, ahora: dia('2026-12-06'), tz: TZ,
      aprobadas: [{ desde: '2026-11-02', hasta: '2026-11-06' }],
      feriados: ['2026-11-04'],
    });
    expect(s.tomados).toBe(4);
  });

  it('aplica los ajustes de RRHH, en los dos sentidos', () => {
    const base = { corte, ahora: dia('2026-10-06'), tz: TZ };
    const suma = calcularSaldo({ ...base, ajustes: [
      { dias: 3, motivo: 'traía acumulado', porUserId: 'rrhh', creadoEn: dia('2026-10-06') },
    ] });
    expect(suma.saldo).toBe(18);
    const resta = calcularSaldo({ ...base, ajustes: [
      { dias: -5, motivo: 'adelanto de diciembre', porUserId: 'rrhh', creadoEn: dia('2026-10-06') },
    ] });
    expect(resta.saldo).toBe(10);
  });

  it('no arrastra basura decimal tras muchos meses', () => {
    const s = calcularSaldo({ corte, ahora: dia('2029-10-06'), tz: TZ });
    expect(s.devengado).toBe(60);              // 15 + 36 × 1,25
    expect(String(s.saldo)).toBe('60');
  });
});

describe('validarSolicitud', () => {
  const saldo = calcularSaldo({ corte: dia('2026-10-06'), ahora: dia('2026-10-06'), tz: TZ });

  it('acepta lo que cabe en el saldo', () => {
    const r = validarSolicitud({ desde: '2026-10-12', hasta: '2026-10-16', saldo, tz: TZ });
    expect(r).toEqual({ ok: true, dias: 5 });
  });

  it('rechaza lo que no cabe, y dice cuánto hay', () => {
    const r = validarSolicitud({ desde: '2026-10-12', hasta: '2026-11-13', saldo, tz: TZ });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe('sin_saldo');
      expect(r.disponible).toBe(15);
      expect(r.dias).toBeGreaterThan(15);
    }
  });

  it('lo pendiente también aparta saldo', () => {
    // 15 disponibles y 14 ya pedidos sin resolver: 5 más no entran
    const r = validarSolicitud({
      desde: '2026-12-07', hasta: '2026-12-11', saldo, tz: TZ,
      pendientes: [{ desde: '2026-11-02', hasta: '2026-11-19' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('sin_saldo');
  });

  it('un rango que cae entero en fin de semana no es una solicitud', () => {
    const r = validarSolicitud({ desde: '2026-10-10', hasta: '2026-10-11', saldo, tz: TZ });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('sin_dias_habiles');
  });

  it('rechaza el rango invertido', () => {
    const r = validarSolicitud({ desde: '2026-10-16', hasta: '2026-10-12', saldo, tz: TZ });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('rango_invalido');
  });

  it('el borde exacto entra', () => {
    const corto = calcularSaldo({
      corte: dia('2026-10-06'), ahora: dia('2026-10-06'), tz: TZ, inicial: 5,
    });
    const r = validarSolicitud({ desde: '2026-10-12', hasta: '2026-10-16', saldo: corto, tz: TZ });
    expect(r.ok).toBe(true);
  });
});

describe('ajustePara', () => {
  it('calcula el delta que hay que guardar', () => {
    expect(ajustePara(12.5, 20)).toBe(7.5);
    expect(ajustePara(20, 12.5)).toBe(-7.5);
    expect(ajustePara(15, 15)).toBe(0);
  });
});

describe('el tope avisa pero no corta', () => {
  it('se sigue devengando por encima de 20', () => {
    const s = calcularSaldo({ corte: dia('2026-10-06'), ahora: dia('2028-10-06'), tz: TZ });
    expect(s.saldo).toBeGreaterThan(TOPE_ALERTA);
    expect(s.devengado).toBe(45);   // 15 + 24 × 1,25
  });
});

describe('diaDeReintegro', () => {
  it('el día hábil siguiente: de un jueves vuelve el viernes, de un viernes el lunes', () => {
    expect(diaDeReintegro('2026-10-08')).toBe('2026-10-09');
    expect(diaDeReintegro('2026-10-09')).toBe('2026-10-12');
  });
  it('salta los feriados', () => {
    expect(diaDeReintegro('2026-10-09', ['2026-10-12'])).toBe('2026-10-13');
  });
});

describe('resumenRango', () => {
  it('una semana de lunes a viernes: 5 hábiles, 5 corridos, vuelve el lunes', () => {
    expect(resumenRango('2026-10-26', '2026-10-30')).toEqual({ diasHabiles: 5, diasCorridos: 5, reintegro: '2026-11-02' });
  });
  it('con un feriado y un fin de semana en el medio', () => {
    expect(resumenRango('2026-10-08', '2026-10-13', ['2026-10-12'])).toEqual({ diasHabiles: 3, diasCorridos: 6, reintegro: '2026-10-14' });
  });
  it('el ejemplo del formulario de papel: 1 día, se reintegra el viernes', () => {
    expect(resumenRango('2026-10-08', '2026-10-08')).toEqual({ diasHabiles: 1, diasCorridos: 1, reintegro: '2026-10-09' });
  });
});
