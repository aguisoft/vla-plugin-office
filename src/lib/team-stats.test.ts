import { describe, it, expect } from 'vitest';
import { diasConRegistro, diasHabiles, estadoRegistro } from './team-stats';

const TZ = 'America/Costa_Rica';
const span = { start: new Date('2026-09-21T06:00:00Z'), end: new Date('2026-09-28T05:59:59Z') };

describe('estadoRegistro', () => {
  it('sin ninguna sesion que interseque el periodo -> sin-registrar', () => {
    expect(estadoRegistro([], span)).toBe('sin-registrar');
  });

  it('una sesion enteramente ANTES del periodo no cuenta', () => {
    const vieja = [{ start: new Date('2026-09-01T14:00:00Z'), end: new Date('2026-09-01T22:00:00Z') }];
    expect(estadoRegistro(vieja, span)).toBe('sin-registrar');
  });

  it('una sesion que interseca aunque sea un minuto -> con-registro', () => {
    const borde = [{ start: new Date('2026-09-20T20:00:00Z'), end: new Date('2026-09-21T06:01:00Z') }];
    expect(estadoRegistro(borde, span)).toBe('con-registro');
  });

  it('sin-registrar NO es lo mismo que cero minutos: la distincion es el punto', () => {
    // Una sesion degenerada (inicio == fin) existe pero no aporta minutos.
    // Tiene registro: la persona marco. Mostrarla como "sin registrar" seria
    // tan falso como mostrar 0m a quien nunca marco.
    const degenerada = [{ start: new Date('2026-09-22T14:00:00Z'), end: new Date('2026-09-22T14:00:00Z') }];
    expect(estadoRegistro(degenerada, span)).toBe('con-registro');
  });

  it('una sesion que termina EXACTAMENTE en el arranque del periodo es borde, no interseccion: sin-registrar', () => {
    // Concuerda con clipSpan, del que depende diasConRegistro: un contacto
    // exacto no cuenta como interseccion. Si estadoRegistro usara bordes
    // inclusivos aqui, una sesion asi saldria "con-registro" y aportaria cero
    // dias, contradiciendo a diasConRegistro sobre la misma sesion.
    const tocaElBorde = [{ start: new Date('2026-09-21T00:00:00Z'), end: span.start }];
    expect(estadoRegistro(tocaElBorde, span)).toBe('sin-registrar');
  });
});

describe('diasConRegistro', () => {
  it('cuenta el DIA, no la sesion: tres sesiones en un dia son un dia', () => {
    const tres = [
      { start: new Date('2026-09-22T14:00:00Z'), end: new Date('2026-09-22T16:00:00Z') },
      { start: new Date('2026-09-22T17:00:00Z'), end: new Date('2026-09-22T19:00:00Z') },
      { start: new Date('2026-09-22T20:00:00Z'), end: new Date('2026-09-22T22:00:00Z') },
    ];
    expect(diasConRegistro(tres, span, TZ)).toEqual(['2026-09-22']);
  });

  it('una sesion que cruza medianoche local cuenta los dos dias', () => {
    // 22:00 a 02:00 hora local = dos dias locales distintos.
    const cruza = [{ start: new Date('2026-09-23T04:00:00Z'), end: new Date('2026-09-23T08:00:00Z') }];
    expect(diasConRegistro(cruza, span, TZ)).toEqual(['2026-09-22', '2026-09-23']);
  });

  it('recorta contra el periodo: lo de afuera no suma dias', () => {
    const desborda = [{ start: new Date('2026-09-19T14:00:00Z'), end: new Date('2026-09-22T16:00:00Z') }];
    expect(diasConRegistro(desborda, span, TZ)).toEqual(['2026-09-21', '2026-09-22']);
  });

  it('sin sesiones da lista vacia', () => {
    expect(diasConRegistro([], span, TZ)).toEqual([]);
  });
});

describe('diasHabiles', () => {
  it('una semana de lunes a domingo da 5 dias habiles', () => {
    expect(diasHabiles(span, TZ)).toEqual([
      '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25',
    ]);
  });

  it('un periodo de un solo sabado da cero', () => {
    const sabado = { start: new Date('2026-09-26T06:00:00Z'), end: new Date('2026-09-27T05:59:59Z') };
    expect(diasHabiles(sabado, TZ)).toEqual([]);
  });

  it('un arranque no alineado a medianoche local (hora UTC < 6) no pierde el primer dia', () => {
    // within.start = 2026-09-23T02:00:00Z = martes 22-sep 20:00 hora local.
    // El dia UTC del instante (23) va un dia adelante del dia local real (22).
    // Anclar el cursor al dia UTC de within.start en vez de a su dia LOCAL
    // hacia que este primer dia habil se perdiera sin dejar rastro.
    const tarde = { start: new Date('2026-09-23T02:00:00Z'), end: new Date('2026-09-23T20:00:00Z') };
    expect(diasHabiles(tarde, TZ)).toEqual(['2026-09-22', '2026-09-23']);
  });

  it('cruza fin de mes: los dias habiles de setiembre y octubre', () => {
    const cruzaMes = { start: new Date('2026-09-28T06:00:00Z'), end: new Date('2026-10-03T05:59:59Z') };
    expect(diasHabiles(cruzaMes, TZ)).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02',
    ]);
  });

  it('cruza fin de anio: los dias habiles de diciembre y enero', () => {
    // 2026-12-30 miercoles a 2027-01-02 sabado (local). El sabado 2-ene queda
    // afuera; no hay feriados cargados, asi que 1-ene cuenta como habil.
    const cruzaAnio = { start: new Date('2026-12-30T06:00:00Z'), end: new Date('2027-01-03T05:59:59Z') };
    expect(diasHabiles(cruzaAnio, TZ)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
  });

  it('un periodo de un solo dia habil da ese dia', () => {
    const unDia = { start: new Date('2026-09-22T06:00:00Z'), end: new Date('2026-09-23T05:59:59Z') };
    expect(diasHabiles(unDia, TZ)).toEqual(['2026-09-22']);
  });
});
