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

/*
 * Las pruebas de diferenciación por FORMA vivían acá cuando el catálogo traía
 * un campo `glifo`. Al reemplazar las figuras geométricas por íconos SVG, esa
 * garantía se mudó con ellos: ahora la verifica `StatusIcon.test.ts`, que es
 * donde está el dibujo. Dejar acá un campo que nadie usa, sostenido solo por
 * su propia prueba, era código muerto con coartada.
 */

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

/**
 * Contraste de las ETIQUETAS de estado sobre fondo blanco.
 *
 * Esta prueba nace de una medición, no de una sospecha: siete de los once
 * `text-*` no llegaban al 4.5:1 que exige WCAG AA para texto normal. El peor
 * era «Desconectado» a 2.54, poco más de la mitad del mínimo, y «Disponible»
 * —la etiqueta más frecuente de todo el plugin— estaba en 3.30.
 *
 * Estas clases se usan en todas las pantallas, así que el fallo no era de una
 * vista sino del catálogo. Un tono elegido «porque se ve bien» en un monitor
 * bueno es exactamente el error que una prueba atrapa y un ojo no.
 *
 * Solo aplica a `text`. `color` y `dot` pintan anillos y puntos, que son
 * elementos no textuales y rigen por otra regla (3:1).
 */
describe('las etiquetas de estado se pueden leer', () => {
  /** Los hex de Tailwind que usa el catálogo. */
  const TW: Record<string, string> = {
    'text-green-700': '#15803d', 'text-blue-600': '#2563eb', 'text-purple-600': '#9333ea',
    'text-violet-700': '#6d28d9', 'text-orange-700': '#c2410c', 'text-yellow-700': '#a16207',
    'text-gray-500': '#6b7280', 'text-slate-600': '#475569', 'text-sky-700': '#0369a1',
    'text-red-600': '#dc2626', 'text-amber-700': '#b45309',
  };

  const luminancia = (hex: string) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  /** Contra blanco, que es el fondo de las pantallas del plugin. */
  const contraste = (hex: string) => (1 + 0.05) / (luminancia(hex) + 0.05);

  it('todas las clases usadas están mapeadas acá', () => {
    for (const k of CLAVES) {
      expect(TW[STATUS_CFG[k].text], `falta el hex de ${STATUS_CFG[k].text} (${k})`).toBeDefined();
    }
  });

  it.each(CLAVES)('%s alcanza 4.5:1 sobre blanco', k => {
    const hex = TW[STATUS_CFG[k].text];
    const r = contraste(hex);
    expect(r, `${STATUS_CFG[k].label} (${STATUS_CFG[k].text}) está en ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  });
});
