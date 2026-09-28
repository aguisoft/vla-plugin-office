import { describe, it, expect } from 'vitest';
import { coverageMatrix } from './coverage';
import { DEFAULT_TZ } from './local-date';

const TZ = DEFAULT_TZ;
/** Instante UTC a partir de hora local de Costa Rica (UTC-6, sin horario de verano). */
const cr = (iso: string) => new Date(`${iso}-06:00`);

/** Un día local completo, para usar como `within` en los casos de un solo día. */
const diaCompleto = { start: cr('2026-09-21T00:00:00'), end: cr('2026-09-21T23:59:59.999') };

describe('coverageMatrix — una persona conectada marca sus horas, no la de salida', () => {
  it('08:00 a 12:00 local marca las horas 8, 9, 10 y 11 con personas: 1, y no la 12', () => {
    const matriz = coverageMatrix(
      [{ userId: 'u1', sesiones: [{ start: cr('2026-09-21T08:00:00'), end: cr('2026-09-21T12:00:00') }] }],
      diaCompleto,
      TZ,
    );

    expect(matriz.horaMin).toBe(8);
    expect(matriz.horaMax).toBe(11);
    expect(matriz.fechas).toEqual(['2026-09-21']);
    expect(matriz.celdas).toEqual([
      { fecha: '2026-09-21', hora: 8, personas: 1 },
      { fecha: '2026-09-21', hora: 9, personas: 1 },
      { fecha: '2026-09-21', hora: 10, personas: 1 },
      { fecha: '2026-09-21', hora: 11, personas: 1 },
    ]);
  });
});

describe('coverageMatrix — cuenta personas, no sesiones', () => {
  it('dos personas distintas solapadas en la misma hora dan personas: 2', () => {
    const matriz = coverageMatrix(
      [
        { userId: 'u1', sesiones: [{ start: cr('2026-09-21T09:00:00'), end: cr('2026-09-21T09:30:00') }] },
        { userId: 'u2', sesiones: [{ start: cr('2026-09-21T09:15:00'), end: cr('2026-09-21T09:45:00') }] },
      ],
      diaCompleto,
      TZ,
    );

    const celdaHora9 = matriz.celdas.find(c => c.hora === 9);
    expect(celdaHora9?.personas).toBe(2);
  });

  it('la misma persona con dos sesiones en esa hora da personas: 1, no 2', () => {
    const matriz = coverageMatrix(
      [
        {
          userId: 'u1',
          sesiones: [
            { start: cr('2026-09-21T09:00:00'), end: cr('2026-09-21T09:10:00') },
            { start: cr('2026-09-21T09:20:00'), end: cr('2026-09-21T09:30:00') },
          ],
        },
      ],
      diaCompleto,
      TZ,
    );

    const celdaHora9 = matriz.celdas.find(c => c.hora === 9);
    expect(celdaHora9?.personas).toBe(1);
  });
});

describe('coverageMatrix — el rango de horas se deriva de los datos', () => {
  it('alguien que trabaja de 22:00 a 23:00 da horaMin: 22 y horaMax: 22, no una constante', () => {
    const matriz = coverageMatrix(
      [{ userId: 'u1', sesiones: [{ start: cr('2026-09-21T22:00:00'), end: cr('2026-09-21T23:00:00') }] }],
      diaCompleto,
      TZ,
    );

    // Si el rango fuera una constante tipo "horario de oficina" (p. ej.
    // 6-20), esta sesión nocturna quedaría fuera del todo. Acá tiene que
    // aparecer, y el rango tiene que ceñirse exactamente a ella.
    expect(matriz.horaMin).toBe(22);
    expect(matriz.horaMax).toBe(22);
    expect(matriz.celdas).toEqual([{ fecha: '2026-09-21', hora: 22, personas: 1 }]);
  });
});

describe('coverageMatrix — sin sesiones no dibuja nada', () => {
  it('porPersona vacío devuelve fechas: [] y celdas: []', () => {
    const matriz = coverageMatrix([], diaCompleto, TZ);
    expect(matriz).toEqual({ horaMin: 0, horaMax: 0, fechas: [], celdas: [] });
  });

  it('gente en el equipo pero sin ninguna sesión también devuelve fechas: [] y celdas: []', () => {
    const matriz = coverageMatrix(
      [{ userId: 'u1', sesiones: [] }, { userId: 'u2', sesiones: [] }],
      diaCompleto,
      TZ,
    );
    expect(matriz).toEqual({ horaMin: 0, horaMax: 0, fechas: [], celdas: [] });
  });
});

describe('coverageMatrix — una sesión que cruza medianoche local reparte sus horas en los dos días', () => {
  it('23:00 de un día a 01:00 del siguiente aporta a hora 23 de un día y hora 0 del otro', () => {
    const dosDias = { start: cr('2026-09-21T00:00:00'), end: cr('2026-09-22T23:59:59.999') };
    const matriz = coverageMatrix(
      [{ userId: 'u1', sesiones: [{ start: cr('2026-09-21T23:00:00'), end: cr('2026-09-22T01:00:00') }] }],
      dosDias,
      TZ,
    );

    expect(matriz.fechas).toEqual(['2026-09-21', '2026-09-22']);

    const hora23Dia1 = matriz.celdas.find(c => c.fecha === '2026-09-21' && c.hora === 23);
    const hora0Dia2 = matriz.celdas.find(c => c.fecha === '2026-09-22' && c.hora === 0);
    expect(hora23Dia1?.personas).toBe(1);
    expect(hora0Dia2?.personas).toBe(1);

    // El resto de las horas del rango está en cero -- no ausente -- porque
    // el rango 0..23 sí toca ambos días. Una celda en cero DENTRO del rango
    // se ve distinta de una hora fuera de él en la interfaz (ver Task 8).
    const hora12Dia1 = matriz.celdas.find(c => c.fecha === '2026-09-21' && c.hora === 12);
    expect(hora12Dia1?.personas).toBe(0);
  });
});
