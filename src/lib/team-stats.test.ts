import { describe, it, expect } from 'vitest';
import { computeNorm, diasConRegistro, diasHabiles, estadoRegistro, PERIODOS_NORMA, variacion } from './team-stats';

const TZ = 'America/Costa_Rica';
const span = { start: new Date('2026-09-21T06:00:00Z'), end: new Date('2026-09-28T05:59:59Z') };

describe('estadoRegistro', () => {
  it('sin ninguna sesión que interseque el período -> sin-registrar', () => {
    expect(estadoRegistro([], span)).toBe('sin-registrar');
  });

  it('una sesión enteramente ANTES del período no cuenta', () => {
    const vieja = [{ start: new Date('2026-09-01T14:00:00Z'), end: new Date('2026-09-01T22:00:00Z') }];
    expect(estadoRegistro(vieja, span)).toBe('sin-registrar');
  });

  it('una sesión que interseca aunque sea un minuto -> con-registro', () => {
    const borde = [{ start: new Date('2026-09-20T20:00:00Z'), end: new Date('2026-09-21T06:01:00Z') }];
    expect(estadoRegistro(borde, span)).toBe('con-registro');
  });

  it('sin-registrar NO es lo mismo que cero minutos: la distinción es el punto', () => {
    // Una sesión degenerada (inicio == fin) existe pero no aporta minutos.
    // Tiene registro: la persona marcó. Mostrarla como «sin registrar» sería
    // tan falso como mostrar 0m a quien nunca marcó.
    const degenerada = [{ start: new Date('2026-09-22T14:00:00Z'), end: new Date('2026-09-22T14:00:00Z') }];
    expect(estadoRegistro(degenerada, span)).toBe('con-registro');
  });

  it('una sesión que termina EXACTAMENTE en el arranque del período es borde, no intersección: sin-registrar', () => {
    // Concuerda con clipSpan, del que depende diasConRegistro: un contacto
    // exacto no cuenta como intersección. Si estadoRegistro usara bordes
    // inclusivos aquí, una sesión así saldría «con-registro» y aportaría cero
    // días, contradiciendo a diasConRegistro sobre la misma sesión.
    const tocaElBorde = [{ start: new Date('2026-09-21T00:00:00Z'), end: span.start }];
    expect(estadoRegistro(tocaElBorde, span)).toBe('sin-registrar');
  });
});

describe('diasConRegistro', () => {
  it('cuenta el DÍA, no la sesión: tres sesiones en un día son un día', () => {
    const tres = [
      { start: new Date('2026-09-22T14:00:00Z'), end: new Date('2026-09-22T16:00:00Z') },
      { start: new Date('2026-09-22T17:00:00Z'), end: new Date('2026-09-22T19:00:00Z') },
      { start: new Date('2026-09-22T20:00:00Z'), end: new Date('2026-09-22T22:00:00Z') },
    ];
    expect(diasConRegistro(tres, span, TZ)).toEqual(['2026-09-22']);
  });

  it('una sesión que cruza medianoche local cuenta los dos días', () => {
    // 22:00 a 02:00 hora local = dos días locales distintos.
    const cruza = [{ start: new Date('2026-09-23T04:00:00Z'), end: new Date('2026-09-23T08:00:00Z') }];
    expect(diasConRegistro(cruza, span, TZ)).toEqual(['2026-09-22', '2026-09-23']);
  });

  it('recorta contra el período: lo de afuera no suma días', () => {
    const desborda = [{ start: new Date('2026-09-19T14:00:00Z'), end: new Date('2026-09-22T16:00:00Z') }];
    expect(diasConRegistro(desborda, span, TZ)).toEqual(['2026-09-21', '2026-09-22']);
  });

  it('sin sesiones da lista vacía', () => {
    expect(diasConRegistro([], span, TZ)).toEqual([]);
  });
});

describe('diasHabiles', () => {
  it('una semana de lunes a domingo da 5 días hábiles', () => {
    expect(diasHabiles(span, TZ)).toEqual([
      '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25',
    ]);
  });

  it('un período de un solo sábado da cero', () => {
    const sabado = { start: new Date('2026-09-26T06:00:00Z'), end: new Date('2026-09-27T05:59:59Z') };
    expect(diasHabiles(sabado, TZ)).toEqual([]);
  });

  it('un arranque no alineado a medianoche local (hora UTC < 6) no pierde el primer día', () => {
    // within.start = 2026-09-23T02:00:00Z = martes 22-sep 20:00 hora local.
    // El día UTC del instante (23) va un día adelante del día local real (22).
    // Anclar el cursor al día UTC de within.start en vez de a su día LOCAL
    // hacía que este primer día hábil se perdiera sin dejar rastro.
    const tarde = { start: new Date('2026-09-23T02:00:00Z'), end: new Date('2026-09-23T20:00:00Z') };
    expect(diasHabiles(tarde, TZ)).toEqual(['2026-09-22', '2026-09-23']);
  });

  it('cruza fin de mes: los días hábiles de setiembre y octubre', () => {
    const cruzaMes = { start: new Date('2026-09-28T06:00:00Z'), end: new Date('2026-10-03T05:59:59Z') };
    expect(diasHabiles(cruzaMes, TZ)).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02',
    ]);
  });

  it('cruza fin de año: los días hábiles de diciembre y enero', () => {
    // 2026-12-30 miércoles a 2027-01-02 sábado (local). El sábado 2-ene queda
    // afuera; no hay feriados cargados, así que 1-ene cuenta como hábil.
    const cruzaAnio = { start: new Date('2026-12-30T06:00:00Z'), end: new Date('2027-01-03T05:59:59Z') };
    expect(diasHabiles(cruzaAnio, TZ)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
  });

  it('un período de un solo día hábil da ese día', () => {
    const unDia = { start: new Date('2026-09-22T06:00:00Z'), end: new Date('2026-09-23T05:59:59Z') };
    expect(diasHabiles(unDia, TZ)).toEqual(['2026-09-22']);
  });
});

describe('computeNorm', () => {
  it('promedia los períodos con actividad', () => {
    expect(computeNorm([600, 500, 700])).toEqual({ promedioMinutos: 600, periodosUsados: 3 });
  });

  it('EXCLUYE los períodos en cero: incluirlos arrastra la norma y todo parece un récord', () => {
    // Vacaciones o semanas sin marcar. Con los ceros el promedio daría 300 y una
    // semana normal de 600 se vería como "+100%", que es una alarma falsa.
    expect(computeNorm([600, 0, 600, 0])).toEqual({ promedioMinutos: 600, periodosUsados: 2 });
  });

  it('todos en cero da una norma sin base', () => {
    expect(computeNorm([0, 0, 0])).toEqual({ promedioMinutos: 0, periodosUsados: 0 });
  });

  it('redondea a minuto entero', () => {
    expect(computeNorm([100, 101]).promedioMinutos).toBe(101);
  });

  it('un NaN se excluye del promedio, igual que un cero', () => {
    // spanMinutes siempre da enteros >= 0, pero la función es pública: un NaN
    // no puede colarse como si fuera un período con actividad.
    expect(computeNorm([600, NaN, 700])).toEqual({ promedioMinutos: 650, periodosUsados: 2 });
  });

  it('un Infinity también se excluye: si entrara, la norma quedaría en Infinity', () => {
    expect(computeNorm([600, Infinity, 700])).toEqual({ promedioMinutos: 650, periodosUsados: 2 });
  });

  it('solo valores no finitos da una norma sin base', () => {
    expect(computeNorm([NaN, Infinity])).toEqual({ promedioMinutos: 0, periodosUsados: 0 });
  });
});

describe('variacion', () => {
  it('con menos de 3 períodos comparables NO da porcentaje', () => {
    // Un +300% contra una sola semana previa es ruido que induce a actuar sobre nada.
    expect(variacion(600, { promedioMinutos: 150, periodosUsados: 2 })).toEqual({ tipo: 'sin-base' });
  });

  it('con 3 o más calcula el porcentaje', () => {
    expect(variacion(660, { promedioMinutos: 600, periodosUsados: 3 }))
      .toEqual({ tipo: 'calculada', pct: 10, destacar: false });
  });

  it('no destaca una fluctuación de +-15%: destacar todo entrena a ignorar las flechas', () => {
    expect(variacion(690, { promedioMinutos: 600, periodosUsados: 8 }).tipo).toBe('calculada');
    expect((variacion(690, { promedioMinutos: 600, periodosUsados: 8 } ) as any).destacar).toBe(false);
  });

  it('destaca una caída real', () => {
    expect(variacion(420, { promedioMinutos: 600, periodosUsados: 8 }))
      .toEqual({ tipo: 'calculada', pct: -30, destacar: true });
  });

  it('una norma con promedio en cero no divide, aunque tenga períodos de sobra', () => {
    // periodosUsados: 5 pasa el mínimo, así que la única cosa que puede
    // devolver sin-base aquí es la guarda del promedio. Con
    // periodosUsados: 0 la prueba pasaba por la otra cláusula y la guarda
    // quedaba sin ejercitar: verificado borrándola, las pruebas seguían verdes.
    expect(variacion(600, { promedioMinutos: 0, periodosUsados: 5 })).toEqual({ tipo: 'sin-base' });
  });

  it('una norma con promedio Infinity no da un porcentaje no finito: sin base', () => {
    // Solo puede llegar así si alguien arma el objeto Norma a mano; computeNorm
    // nunca lo produce. Igual variacion es pública y tiene que blindarse.
    expect(variacion(600, { promedioMinutos: Infinity, periodosUsados: 5 })).toEqual({ tipo: 'sin-base' });
  });

  it('un porcentaje que redondea a cero negativo se normaliza a cero positivo', () => {
    const resultado = variacion(997, { promedioMinutos: 1000, periodosUsados: 3 });
    expect(resultado).toEqual({ tipo: 'calculada', pct: 0, destacar: false });
    expect(Object.is((resultado as any).pct, -0)).toBe(false);
  });

  it('las ventanas por tipo de período son las de la spec', () => {
    expect(PERIODOS_NORMA).toEqual({ day: 20, week: 8, month: 6 });
  });
});
