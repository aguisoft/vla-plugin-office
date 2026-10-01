import { describe, it, expect } from 'vitest';
import { TRAZOS_ESTADO } from './StatusIcon';
import { STATUS_CFG, type ResolvedStatus } from '../statusConfig';

/**
 * Los íconos sustituyeron a las figuras geométricas para que el estado se
 * entienda antes de leer la etiqueta. Al hacerlo había que conservar lo que
 * las figuras sí garantizaban: que ninguno dependa del color.
 *
 * Varios íconos contienen un círculo —disponible, concentrado, vuelvo pronto,
 * desconectado— y se separan por lo que ocurre dentro. Si dos terminaran con
 * el mismo trazado, para quien no distingue tonos serían el mismo estado, y
 * nada más lo avisaría.
 */

const CLAVES = Object.keys(STATUS_CFG) as ResolvedStatus[];

describe('cada estado tiene su propio ícono', () => {
  it('hay un trazado por estado, sin faltantes ni sobrantes', () => {
    expect(Object.keys(TRAZOS_ESTADO).sort()).toEqual([...CLAVES].sort());
  });

  it('ningún estado se quedó sin dibujo', () => {
    for (const k of CLAVES) {
      expect(TRAZOS_ESTADO[k].d, `${k} sin trazado`).toBeTruthy();
    }
  });

  /** La prueba que importa: dos siluetas iguales anulan la diferenciación. */
  it('ningún trazado completo se repite entre dos estados', () => {
    const vistos = new Map<string, ResolvedStatus>();
    for (const k of CLAVES) {
      const firma = TRAZOS_ESTADO[k].d + '|' + (TRAZOS_ESTADO[k].extra ?? '');
      const previo = vistos.get(firma);
      expect(previo, `${k} y ${previo} dibujan exactamente lo mismo`).toBeUndefined();
      vistos.set(firma, k);
    }
    expect(vistos.size).toBe(CLAVES.length);
  });

  /**
   * Cuatro íconos arrancan con el mismo círculo exterior a propósito. Lo que
   * los separa es el segundo trazo, así que ese no puede faltar: un círculo
   * pelado sería indistinguible del otro círculo pelado.
   */
  it('los que comparten el círculo exterior traen un segundo trazo que los separa', () => {
    const porBase = new Map<string, ResolvedStatus[]>();
    for (const k of CLAVES) {
      const base = TRAZOS_ESTADO[k].d;
      porBase.set(base, [...(porBase.get(base) ?? []), k]);
    }
    for (const [, hermanos] of porBase) {
      if (hermanos.length < 2) continue;
      for (const k of hermanos) {
        expect(
          TRAZOS_ESTADO[k].extra,
          `${k} comparte la base con ${hermanos.filter(h => h !== k).join(', ')} y no trae trazo propio`,
        ).toBeTruthy();
      }
      // Y esos trazos propios tampoco pueden coincidir entre sí.
      const extras = hermanos.map(k => TRAZOS_ESTADO[k].extra);
      expect(new Set(extras).size, `trazos repetidos entre ${hermanos.join(', ')}`).toBe(hermanos.length);
    }
  });

  it('los trazados son rutas SVG válidas, no texto suelto', () => {
    for (const k of CLAVES) {
      const todo = TRAZOS_ESTADO[k].d + ' ' + (TRAZOS_ESTADO[k].extra ?? '');
      expect(todo, `${k} no arranca con un comando de ruta`).toMatch(/^[Mm]/);
      expect(todo, `${k} tiene caracteres que no son de ruta SVG`).not.toMatch(/[^MmLlHhVvCcSsQqTtAaZz0-9.,\s-]/);
    }
  });
});
