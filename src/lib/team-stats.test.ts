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
});
