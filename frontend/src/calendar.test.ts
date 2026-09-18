import { describe, it, expect } from 'vitest';
import {
  isoDate, mondayFirst, daysInMonth, leadingBlanks, isWeekend,
  dateKey, monthOf, dayOf,
} from './calendar';

describe('isoDate — sin corrimiento de zona', () => {
  it('arma la fecha con ceros a la izquierda', () => {
    expect(isoDate(2026, 0, 1)).toBe('2026-01-01');
    expect(isoDate(2026, 8, 15)).toBe('2026-09-15');
    expect(isoDate(2026, 11, 31)).toBe('2026-12-31');
  });

  it('el 1 de enero NO se corre a diciembre del año anterior', () => {
    // Es el caso que rompió `sameLocalMonth` antes: toISOString() en UTC-6
    // devolvia 2025-12-31 para el 1 de enero local.
    expect(isoDate(2026, 0, 1)).toBe('2026-01-01');
    expect(isoDate(2026, 0, 1).startsWith('2026')).toBe(true);
  });

  it('el 1 de mayo NO se corre al 30 de abril', () => {
    expect(isoDate(2026, 4, 1)).toBe('2026-05-01');
  });

  it('da el mismo resultado que toISOString solo cuando no hay corrimiento', () => {
    // Prueba de contraste: deja explícito que no usamos toISOString.
    const local = isoDate(2026, 0, 1);
    const conUtc = new Date(2026, 0, 1).toISOString().slice(0, 10);
    // En UTC-6 conUtc da '2025-12-31'. La prueba no asume la zona del runner:
    // solo exige que isoDate dé el día local pedido.
    expect(local).toBe('2026-01-01');
    if (conUtc !== local) {
      expect(conUtc).not.toBe('2026-01-01'); // confirma que el riesgo es real
    }
  });
});

describe('mondayFirst', () => {
  it('mueve el domingo del 0 al 6', () => {
    expect(mondayFirst(0)).toBe(6); // domingo
    expect(mondayFirst(1)).toBe(0); // lunes
    expect(mondayFirst(6)).toBe(5); // sabado
  });
});

describe('daysInMonth', () => {
  it('meses de 31, 30 y 28', () => {
    expect(daysInMonth(2026, 0)).toBe(31);  // enero
    expect(daysInMonth(2026, 3)).toBe(30);  // abril
    expect(daysInMonth(2026, 1)).toBe(28);  // febrero 2026
  });

  it('febrero de año bisiesto', () => {
    expect(daysInMonth(2028, 1)).toBe(29);
    expect(daysInMonth(2024, 1)).toBe(29);
  });

  it('año secular no bisiesto', () => {
    expect(daysInMonth(2100, 1)).toBe(28);
  });
});

describe('leadingBlanks', () => {
  it('un mes que arranca lunes no lleva huecos', () => {
    // 1 de junio de 2026 es lunes.
    expect(leadingBlanks(2026, 5)).toBe(0);
  });

  it('un mes que arranca domingo lleva 6 huecos', () => {
    // 1 de febrero de 2026 es domingo.
    expect(leadingBlanks(2026, 1)).toBe(6);
  });

  it('nunca devuelve 7 (eso seria una fila vacia de más)', () => {
    for (let m = 0; m < 12; m++) {
      const b = leadingBlanks(2026, m);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(6);
    }
  });
});

describe('isWeekend', () => {
  it('sabado y domingo son fin de semana', () => {
    expect(isWeekend(2026, 8, 19)).toBe(true); // sabado 19 sept 2026
    expect(isWeekend(2026, 8, 20)).toBe(true); // domingo 20
  });

  it('los dias habiles no', () => {
    expect(isWeekend(2026, 8, 18)).toBe(false); // viernes 18
    expect(isWeekend(2026, 8, 21)).toBe(false); // lunes 21
  });
});

describe('lectura de fechas del servidor', () => {
  it('dateKey corta un ISO completo a la parte de fecha', () => {
    expect(dateKey('2026-09-15T00:00:00.000Z')).toBe('2026-09-15');
    expect(dateKey('2026-09-15')).toBe('2026-09-15');
  });

  it('monthOf y dayOf leen los caracteres, no un Date', () => {
    // Medianoche UTC: new Date() lo leeria como el 14 en UTC-6.
    const delServidor = '2026-09-15T00:00:00.000Z';
    expect(monthOf(delServidor)).toBe(8); // septiembre
    expect(dayOf(delServidor)).toBe(15);  // y NO 14
  });

  it('el 1 de mes leido del servidor no retrocede al mes anterior', () => {
    expect(monthOf('2026-05-01T00:00:00.000Z')).toBe(4); // mayo, no abril
    expect(dayOf('2026-05-01T00:00:00.000Z')).toBe(1);
    expect(monthOf('2026-01-01T00:00:00.000Z')).toBe(0); // enero, no diciembre
  });

  it('ida y vuelta: isoDate -> monthOf/dayOf', () => {
    for (const [y, m, d] of [[2026, 0, 1], [2026, 4, 1], [2026, 11, 31]] as const) {
      const iso = isoDate(y, m, d);
      expect(monthOf(iso)).toBe(m);
      expect(dayOf(iso)).toBe(d);
    }
  });
});
