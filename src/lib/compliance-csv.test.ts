import { describe, it, expect } from 'vitest';
import { cumplimientoToCsv } from './compliance-csv';
import type { Cumplimiento } from '../services/compliance.service';

/**
 * `cumplimientoToCsv` es la única consumidora de `ComplianceService` en
 * Task 10 -- el CSV que RRHH abre en Excel. Dos cosas no pueden fallar
 * calladas: el BOM (sin él, Excel rompe cada tilde y cada ñ) y la
 * distinción entre `null` ("no disponible") y `[]` ("de verdad no hay
 * nada"), que es la misma regla de "no inventar un cero" que el resto del
 * plugin viene aplicando, ahora en la exportación.
 */

const COMPLETO: Cumplimiento = {
  sinMarcar30Dias: [{ userId: 'u1', nombre: 'María José Sáenz', departamento: 'Ventas' }],
  sesionesAbiertas: [{ userId: 'u2', nombre: 'Pedro López', desde: '2026-09-20' }],
  sinJefe: [{ userId: 'u3', nombre: 'Ana Ruiz' }],
  sinDepartamento: [{ userId: 'u4', nombre: 'Beto Solís' }],
  feriadosCargados: 12,
  ausenciasDelPeriodo: 3,
  historialEstadosDesde: '2026-08-01',
  porDepartamento: [{ departamento: 'Ventas', total: 5, sinMarcar: 1 }],
};

describe('cumplimientoToCsv — BOM y formato', () => {
  it('empieza con el BOM UTF-8', () => {
    const csv = cumplimientoToCsv(COMPLETO);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('usa \\r\\n entre líneas, como espera Excel', () => {
    const csv = cumplimientoToCsv(COMPLETO);
    expect(csv).toContain('\r\n');
    expect(csv.split('\r\n').length).toBeGreaterThan(5);
  });

  it('conserva tildes y ñ tal cual, sin escaparlas', () => {
    const csv = cumplimientoToCsv(COMPLETO);
    expect(csv).toContain('María José Sáenz');
  });

  it('encierra en comillas un campo que trae una coma', () => {
    const conComa: Cumplimiento = {
      ...COMPLETO,
      sinJefe: [{ userId: 'u5', nombre: 'Solís, Roberto' }],
    };
    const csv = cumplimientoToCsv(conComa);
    expect(csv).toContain('"Solís, Roberto"');
  });
});

describe('cumplimientoToCsv — no disponible vs. vacío de verdad', () => {
  it('un contador en null se escribe como "no disponible", nunca como celda vacía ni 0', () => {
    const degradado: Cumplimiento = {
      ...COMPLETO,
      feriadosCargados: null,
      sinMarcar30Dias: null,
    };
    const csv = cumplimientoToCsv(degradado);
    expect(csv).toContain('Feriados cargados,,,no disponible');
    expect(csv).toContain('Sin marcar en 30 días,no disponible,,,');
    // Ningún "0" inventado en la línea del contador que falló.
    const lineaFeriados = csv.split('\r\n').find(l => l.includes('Feriados cargados'));
    expect(lineaFeriados).not.toMatch(/,0$/);
  });

  it('un arreglo genuinamente vacío se escribe como "Ninguna", distinto de "no disponible"', () => {
    const limpio: Cumplimiento = {
      ...COMPLETO,
      sinJefe: [],
      sinDepartamento: [],
    };
    const csv = cumplimientoToCsv(limpio);
    expect(csv).toContain('Sin jefe,Ninguna,,,');
    expect(csv).toContain('Sin departamento,Ninguna,,,');
    expect(csv).not.toContain('Sin jefe,no disponible');
  });

  it('historialEstadosDesde en null se escribe como "no disponible"', () => {
    const csv = cumplimientoToCsv({ ...COMPLETO, historialEstadosDesde: null });
    expect(csv).toContain('Historial de estados desde,,,no disponible');
  });
});

describe('cumplimientoToCsv — inyección de fórmulas', () => {
  /**
   * Los nombres salen de Bitrix, donde cualquiera escribe lo que quiere en su
   * perfil. Un nombre que empiece con `=` hace que Excel EJECUTE el contenido
   * al abrir el archivo — y esto lo abre gente de RRHH en su máquina para
   * evaluaciones y planillas.
   */
  const conFormula = (nombre: string): Cumplimiento => ({
    ...COMPLETO,
    sinJefe: [{ userId: 'u9', nombre }],
  });

  for (const arranque of ['=', '+', '-', '@']) {
    it(`neutraliza un nombre que empieza con "${arranque}"`, () => {
      const csv = cumplimientoToCsv(conFormula(`${arranque}HYPERLINK("http://x")`));
      expect(csv).toContain(`'${arranque}HYPERLINK`);
      // Sin la comilla simple, Excel lo ejecuta en vez de mostrarlo.
      expect(csv).not.toMatch(new RegExp(`,\\${arranque}HYPERLINK`));
    });
  }

  it('la comilla simple va ANTES de entrecomillar, no adentro', () => {
    // Un valor con fórmula Y con coma necesita las dos protecciones, y en ese
    // orden: al revés la comilla simple queda dentro de las comillas dobles,
    // donde Excel ya no la trata como marca de texto.
    const csv = cumplimientoToCsv(conFormula('=SUMA(1,2)'));
    expect(csv).toContain(`"'=SUMA(1,2)"`);
  });

  it('un nombre normal no se toca', () => {
    const csv = cumplimientoToCsv(conFormula('María José Sáenz'));
    expect(csv).toContain('María José Sáenz');
    expect(csv).not.toContain(`'María`);
  });
});
