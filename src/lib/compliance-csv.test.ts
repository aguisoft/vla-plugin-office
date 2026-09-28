import { describe, it, expect } from 'vitest';
import { cumplimientoToCsv } from './compliance-csv';
import type { Cumplimiento } from '../services/compliance.service';
import type { FilaEquipo } from '../services/team.service';

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
  porDepartamento: [{ departamentoId: 'd1', departamento: 'Ventas', total: 5, sinMarcar: 1 }],
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

/**
 * I7: el spec pide "CSV de la tabla del equipo MÁS las banderas de
 * cumplimiento" y lo implementado no traía ni una columna de persona. Estas
 * pruebas verifican que las columnas de `TeamTable` sí lleguen, y que los
 * TRES estados de fila se distingan también en el CSV -- no solo en la
 * pantalla.
 */
describe('cumplimientoToCsv — tabla del equipo (I7)', () => {
  const conRegistro: FilaEquipo = {
    userId: 'u1', firstName: 'María José', lastName: 'Sáenz', email: 'maria@vla.com',
    estado: 'con-registro', totalMinutes: 270, openSessionCapped: false,
    variacion: { tipo: 'calculada', pct: 12, destacar: false },
    diasConRegistro: 5, diasHabiles: 5, diasFinDeSemana: 0,
    entradaHabitual: '08:10', ultimoRegistro: '2026-09-25', ultimoDisponible: true,
  };
  const sinRegistrar: FilaEquipo = {
    userId: 'u2', firstName: 'Pedro', lastName: 'López', email: 'pedro@vla.com',
    estado: 'sin-registrar', totalMinutes: 0, openSessionCapped: false,
    variacion: { tipo: 'sin-base' },
    diasConRegistro: 0, diasHabiles: 5, diasFinDeSemana: 0,
    entradaHabitual: null, ultimoRegistro: null, ultimoDisponible: true,
  };
  const noDisponible: FilaEquipo = {
    userId: 'u3', firstName: 'Ana', lastName: 'Ruiz', email: 'ana@vla.com',
    estado: 'no-disponible', totalMinutes: 0, openSessionCapped: false,
    variacion: { tipo: 'sin-base' },
    diasConRegistro: 0, diasHabiles: 5, diasFinDeSemana: 0,
    entradaHabitual: null, ultimoRegistro: null, ultimoDisponible: false,
  };

  it('trae las columnas de la tabla del equipo, con una fila con-registro completa', () => {
    const csv = cumplimientoToCsv(COMPLETO, [conRegistro]);
    expect(csv).toContain('Persona,Email,Estado,Minutos del período,vs. su promedio,Días con registro,Días hábiles,Días fin de semana,Entrada habitual,Último registro');
    // "+12%" empieza con "+", el mismo prefijo que neutraliza fórmulas
    // (ARRANQUE_DE_FORMULA) -- se aplica parejo a TODAS las columnas, no
    // solo a nombres, así que sale con la comilla simple delante.
    expect(csv).toContain("María José Sáenz,maria@vla.com,con registro,270,'+12%,5,5,0,08:10,2026-09-25");
  });

  it('va ANTES de la sección de cumplimiento', () => {
    const csv = cumplimientoToCsv(COMPLETO, [conRegistro]);
    const lineas = csv.split('\r\n');
    // La primera línea lleva el BOM (`﻿`) pegado adelante -- `includes`
    // y no `startsWith`, para no acoplar esta prueba a ese detalle.
    const idxEquipo = lineas.findIndex(l => l.includes('Persona,Email,Estado'));
    const idxCumplimiento = lineas.findIndex(l => l.startsWith('Sección,Detalle'));
    expect(idxEquipo).toBeGreaterThanOrEqual(0);
    expect(idxCumplimiento).toBeGreaterThan(idxEquipo);
  });

  it('sin-registrar no escribe 0 en las columnas del período -- son "no aplica"', () => {
    const csv = cumplimientoToCsv(COMPLETO, [sinRegistrar]);
    expect(csv).toContain('Pedro López,pedro@vla.com,sin registrar,no aplica,no aplica,no aplica,no aplica,no aplica,no aplica,nunca');
    expect(csv).not.toContain('Pedro López,pedro@vla.com,sin registrar,0');
  });

  it('no-disponible se distingue de sin-registrar, y no escribe "nunca" sobre el último registro', () => {
    const csv = cumplimientoToCsv(COMPLETO, [noDisponible]);
    expect(csv).toContain('Ana Ruiz,ana@vla.com,no disponible,no aplica,no aplica,no aplica,no aplica,no aplica,no aplica,no disponible');
    expect(csv).not.toContain('Ana Ruiz,ana@vla.com,no disponible,no aplica,no aplica,no aplica,no aplica,no aplica,no aplica,nunca');
  });

  it('sin filas (por omisión, o un arreglo vacío) escribe "Ninguna" y no rompe el resto del CSV', () => {
    const csv = cumplimientoToCsv(COMPLETO);
    expect(csv).toContain('Ninguna,,,,,,,,,');
    expect(csv).toContain('Feriados cargados');
  });
});
