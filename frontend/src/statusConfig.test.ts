import { describe, it, expect } from 'vitest';
import { STATUS_CFG, type ResolvedStatus } from './statusConfig';

/**
 * Estas pruebas existen por un fallo concreto y medido.
 *
 * Una propuesta de diseño redujo los once estados a un punto de color de 8px y
 * asignó `rgb(22,163,74)` a «Disponible» y `rgb(21,128,61)` a «Reunión
 * interna»: dos verdes separados por 2 puntos de luminosidad. A esa escala son
 * el mismo punto, y para quien no distingue tonos, los tres naranjas y los
 * tres azules del resto de la paleta colapsaban igual.
 *
 * El color es el eje más fácil de romper sin que nadie lo note, porque quien
 * elige los tonos casi nunca es quien no los distingue. De ahí que la
 * diferenciación no pueda depender de él, y que haya una prueba y no solo una
 * buena intención.
 */

const CLAVES = Object.keys(STATUS_CFG) as ResolvedStatus[];

/** Distancia euclídea en RGB. Burda, pero suficiente para detectar gemelos. */
function distancia(a: string, b: string): number {
  const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

describe('los once estados se distinguen SIN color', () => {
  it('cada estado tiene glifo', () => {
    for (const k of CLAVES) {
      expect(STATUS_CFG[k].glifo, `${k} sin glifo`).toBeTruthy();
    }
  });

  /**
   * La prueba que de verdad importa: si dos estados comparten figura, quien no
   * distingue el color no tiene ningún otro eje para separarlos.
   */
  it('ningún glifo se repite entre dos estados', () => {
    const vistos = new Map<string, ResolvedStatus>();
    for (const k of CLAVES) {
      const g = STATUS_CFG[k].glifo;
      const previo = vistos.get(g);
      expect(previo, `${k} y ${previo} comparten el glifo ${g}`).toBeUndefined();
      vistos.set(g, k);
    }
    expect(vistos.size).toBe(CLAVES.length);
  });

  it('los glifos son de un solo carácter visible, no secuencias raras', () => {
    for (const k of CLAVES) {
      expect([...STATUS_CFG[k].glifo], `${k} usa un glifo compuesto`).toHaveLength(1);
    }
  });
});

describe('la paleta tampoco tiene gemelos', () => {
  it('ningún color se repite literalmente', () => {
    const colores = CLAVES.map(k => STATUS_CFG[k].color.toLowerCase());
    expect(new Set(colores).size).toBe(colores.length);
  });

  /**
   * La separación se exige DENTRO de cada grupo, no entre todos los pares.
   *
   * Un umbral global de 60 marcaba dos pares —Concentrado con Vacaciones, y
   * Vuelvo pronto con Feriado— que en realidad no compiten: cada uno cruza de
   * «día» a «ausencia», y las ausencias llevan ícono además del color, que es
   * la decisión que ya documenta `STATUS_CFG`. Un tono parecido entre un
   * estado del día y una ausencia no confunde a nadie, porque uno trae 🏖 y el
   * otro no.
   *
   * Donde sí importa es entre hermanos del mismo grupo: ahí el color es el
   * único eje que los separa a simple vista. Hoy el par más cercano son
   * Almuerzo y Vuelvo pronto, a 70.
   */
  it('dentro de un mismo grupo, ningún par baja de 60 de distancia en RGB', () => {
    const cerca: string[] = [];
    for (const grupo of ['day', 'absence', 'system'] as const) {
      const delGrupo = CLAVES.filter(k => STATUS_CFG[k].group === grupo);
      for (let i = 0; i < delGrupo.length; i++) {
        for (let j = i + 1; j < delGrupo.length; j++) {
          const d = distancia(STATUS_CFG[delGrupo[i]].color, STATUS_CFG[delGrupo[j]].color);
          if (d < 60) cerca.push(`${delGrupo[i]} y ${delGrupo[j]} en «${grupo}» (distancia ${d.toFixed(0)})`);
        }
      }
    }
    expect(cerca, `colores demasiado parecidos: ${cerca.join('; ')}`).toEqual([]);
  });

  /**
   * El complemento de la prueba de arriba: lo que legitima tener tonos
   * parecidos entre grupos es que las ausencias traigan ícono. Si alguien se
   * lo quitara a una, ese par se volvería indistinguible y nada más lo
   * avisaría.
   */
  it('un color parecido entre grupos solo se tolera si la ausencia tiene ícono', () => {
    for (const a of CLAVES) {
      for (const b of CLAVES) {
        if (a === b || STATUS_CFG[a].group === STATUS_CFG[b].group) continue;
        if (distancia(STATUS_CFG[a].color, STATUS_CFG[b].color) >= 60) continue;
        const conIcono = [a, b].filter(k => STATUS_CFG[k].icon);
        expect(
          conIcono.length,
          `${a} y ${b} tienen colores parecidos y ninguno trae ícono que los separe`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe('forma del catálogo', () => {
  it('son exactamente once estados', () => {
    expect(CLAVES).toHaveLength(11);
  });

  it('cada estado tiene etiqueta en español y grupo', () => {
    for (const k of CLAVES) {
      expect(STATUS_CFG[k].label, `${k} sin label`).toBeTruthy();
      expect(['day', 'absence', 'system']).toContain(STATUS_CFG[k].group);
    }
  });

  it('las cuatro ausencias conservan su ícono además del glifo', () => {
    const ausencias = CLAVES.filter(k => STATUS_CFG[k].group === 'absence');
    expect(ausencias).toHaveLength(4);
    for (const k of ausencias) expect(STATUS_CFG[k].icon, `${k} sin icon`).toBeTruthy();
  });
});
