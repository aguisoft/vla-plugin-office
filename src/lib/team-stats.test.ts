import { describe, it, expect } from 'vitest';
import {
  computeNorm, diasConRegistro, diasFinDeSemana, diasHabiles, entradaHabitual, estadoRegistro,
  PERIODOS_NORMA, variacion,
} from './team-stats';

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

  describe('con feriados (I5)', () => {
    it('un feriado en medio de la semana baja el denominador a 4', () => {
      // Miércoles 23-sep feriado -> quedan lunes, martes, jueves, viernes.
      const feriados = new Set(['2026-09-23']);
      expect(diasHabiles(span, TZ, feriados)).toEqual([
        '2026-09-21', '2026-09-22', '2026-09-24', '2026-09-25',
      ]);
    });

    it('un feriado de OTRO país (fuera del rango pedido) no lo toca', () => {
      // Simula lo que hace TeamService: solo se le pasan los feriados del
      // país de la persona. Una fecha fuera del período no debería aparecer
      // nunca en el set real, pero si apareciera, tampoco tendría efecto.
      const feriados = new Set(['2026-10-05']);
      expect(diasHabiles(span, TZ, feriados)).toEqual([
        '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25',
      ]);
    });

    it('sin feriados (undefined) el resultado no cambia', () => {
      expect(diasHabiles(span, TZ)).toEqual(diasHabiles(span, TZ, undefined));
    });

    it('un set de feriados vacío tampoco cambia nada', () => {
      expect(diasHabiles(span, TZ, new Set())).toEqual(diasHabiles(span, TZ));
    });
  });
});

describe('diasFinDeSemana (I6)', () => {
  it('separa el sábado de una lista que ya trae lunes a sábado', () => {
    expect(diasFinDeSemana(['2026-09-21', '2026-09-22', '2026-09-26'])).toBe(1);
  });

  it('una lista sin fin de semana da cero', () => {
    expect(diasFinDeSemana(['2026-09-21', '2026-09-22'])).toBe(0);
  });

  it('una lista vacía da cero', () => {
    expect(diasFinDeSemana([])).toBe(0);
  });

  it('cuenta sábado Y domingo', () => {
    expect(diasFinDeSemana(['2026-09-26', '2026-09-27'])).toBe(2);
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
    // periodosUsados: 5 pasa el mínimo. Con periodosUsados: 0 esta prueba
    // pasaba por la otra cláusula y no ejercitaba nada.
    expect(variacion(600, { promedioMinutos: 0, periodosUsados: 5 })).toEqual({ tipo: 'sin-base' });
  });

  it('una norma con promedio NEGATIVO da sin-base, no un porcentaje al revés', () => {
    // Este es el único caso que aísla de verdad la guarda `promedioMinutos <= 0`:
    // con promedio 0 la división da Infinity y la atrapa la guarda de no-finitos,
    // así que esa prueba pasa aunque se borre la del promedio. Con un promedio
    // negativo el porcentaje sale finito (−700%) y solo esta guarda lo detiene.
    // `computeNorm` no puede producir una norma así, pero `variacion` es pública
    // y acepta cualquier `Norma`.
    expect(variacion(600, { promedioMinutos: -100, periodosUsados: 5 })).toEqual({ tipo: 'sin-base' });
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

describe('entradaHabitual', () => {
  it('usa la MEDIANA, no el promedio: un día a las 4am no corre la hora habitual', () => {
    // 8:00, 8:10, 8:20, 8:30 y un 4:00 suelto. El promedio daría ~7:24; la
    // mediana se queda en 8:10, que es la hora a la que esta persona entra.
    const dias = [
      new Date('2026-09-21T14:00:00Z'), // 08:00 local
      new Date('2026-09-22T14:10:00Z'), // 08:10
      new Date('2026-09-23T14:20:00Z'), // 08:20
      new Date('2026-09-24T14:30:00Z'), // 08:30
      new Date('2026-09-25T10:00:00Z'), // 04:00  <- el outlier
    ];
    expect(entradaHabitual(dias, TZ)).toBe('08:10');
  });

  it('con número par de muestras promedia las dos del medio', () => {
    const dias = [
      new Date('2026-09-21T14:00:00Z'), // 08:00
      new Date('2026-09-22T14:20:00Z'), // 08:20
      new Date('2026-09-23T15:00:00Z'), // 09:00
      new Date('2026-09-24T15:40:00Z'), // 09:40
    ];
    expect(entradaHabitual(dias, TZ)).toBe('08:40');
  });

  it('con menos de 3 días no hay hábito que reportar', () => {
    expect(entradaHabitual([new Date('2026-09-21T14:00:00Z')], TZ)).toBeNull();
    expect(entradaHabitual([], TZ)).toBeNull();
  });

  it('ancla en hora LOCAL, no UTC', () => {
    // 14:00 UTC es 08:00 en UTC-6. Si se leyera en UTC diría "14:00".
    const dias = Array.from({ length: 3 }, (_, i) =>
      new Date(`2026-09-2${1 + i}T14:00:00Z`));
    expect(entradaHabitual(dias, TZ)).toBe('08:00');
  });

  it('una fecha inválida se descarta antes de calcular, no envenena la mediana', () => {
    // new Date('basura') produce un instante NaN. Colarlo en el cálculo haría
    // que Intl.DateTimeFormat lanzara una excepción (o, si se lo tapara sin
    // cuidado, que un NaN se disfrazara de minuto válido). El criterio del
    // proyecto es que un dato que no se puede calcular se descarte, y el
    // resultado sea igual al que darían solo las fechas válidas.
    const validas = [
      new Date('2026-09-21T14:00:00Z'), // 08:00
      new Date('2026-09-22T14:10:00Z'), // 08:10
      new Date('2026-09-23T14:20:00Z'), // 08:20
    ];
    const conInvalida = [...validas, new Date('basura')];
    expect(entradaHabitual(conInvalida, TZ)).toBe(entradaHabitual(validas, TZ));
    expect(entradaHabitual(conInvalida, TZ)).toBe('08:10');
  });

  it('si tras descartar las inválidas quedan menos de 3 días, no hay hábito que reportar', () => {
    const dias = [
      new Date('2026-09-21T14:00:00Z'),
      new Date('2026-09-22T14:10:00Z'),
      new Date('basura'),
    ];
    expect(entradaHabitual(dias, TZ)).toBeNull();
  });

  it('solo fechas inválidas da null, no una hora inventada', () => {
    expect(entradaHabitual([new Date('basura'), new Date('otra basura'), new Date(NaN)], TZ)).toBeNull();
  });

  it('con número par cuyo medio cae en .5, el redondeo es determinista', () => {
    // 08:00 y 08:01 dan una mediana de 480.5. La otra prueba de número par usa
    // dos valores cuya suma es divisible, así que nunca ejercita el redondeo.
    const dosMinutosSeguidos = [
      new Date('2026-09-21T14:00:00Z'), // 08:00 local
      new Date('2026-09-22T14:01:00Z'), // 08:01 local
      new Date('2026-09-23T14:00:00Z'), // 08:00 local
      new Date('2026-09-24T14:01:00Z'), // 08:01 local
    ];
    expect(entradaHabitual(dosMinutosSeguidos, TZ)).toBe('08:01');
  });

  it('la medianoche local sale como 00:00 y no como 24:00', () => {
    // Cubre el `% 24` de minutosLocales. Con hourCycle h23 Intl devuelve "00",
    // pero el módulo está para el caso en que devuelva "24": sin él, la
    // medianoche daría 1440 minutos y la hora saldría como "24:00".
    const medianoche = Array.from({ length: 3 }, (_, i) =>
      new Date(`2026-09-2${1 + i}T06:00:00Z`)); // 00:00 local en UTC-6
    expect(entradaHabitual(medianoche, TZ)).toBe('00:00');
  });
});
