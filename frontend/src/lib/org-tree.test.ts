import { describe, it, expect } from 'vitest';
import { buildOrgTree, cadenaDeMando, saludOrg, horaLocalDe, type PersonaChart } from './org-tree';

const p = (
  userId: string, nombre: string | null, managerUserId: string | null = null, departamento: string | null = null,
): PersonaChart => ({ userId, nombre, managerUserId, departamento });

/** Nombres de un nivel, para comparar sin arrastrar toda la estructura. */
const nombres = (lista: { persona: PersonaChart }[]) => lista.map(n => n.persona.nombre);

describe('buildOrgTree — jerarquía', () => {
  it('quien no tiene jefe queda en la cima', () => {
    const t = buildOrgTree([p('a', 'Ana'), p('b', 'Beto')]);
    expect(nombres(t.cima)).toEqual(['Ana', 'Beto']);
    expect(t.huerfanos).toEqual([]);
    expect(t.ciclos).toEqual([]);
  });

  it('cuelga a cada persona de su jefe', () => {
    const t = buildOrgTree([p('a', 'Ana'), p('b', 'Beto', 'a'), p('c', 'Caro', 'a')]);
    expect(nombres(t.cima)).toEqual(['Ana']);
    expect(nombres(t.cima[0].equipo)).toEqual(['Beto', 'Caro']);
  });

  it('anida a cualquier profundidad', () => {
    const t = buildOrgTree([
      p('a', 'Ana'), p('b', 'Beto', 'a'), p('c', 'Caro', 'b'), p('d', 'Dani', 'c'),
    ]);
    expect(t.cima[0].equipo[0].equipo[0].equipo[0].persona.nombre).toBe('Dani');
  });

  it('cuenta la gente que cuelga de cada quien, directa e indirecta', () => {
    const t = buildOrgTree([
      p('a', 'Ana'), p('b', 'Beto', 'a'), p('c', 'Caro', 'b'), p('d', 'Dani', 'b'),
    ]);
    expect(t.cima[0].totalAbajo).toBe(3);          // Beto, Caro y Dani
    expect(t.cima[0].equipo[0].totalAbajo).toBe(2); // Caro y Dani
  });

  it('dos dueños en la cima, cada uno con su rama', () => {
    // El caso real: Verónica y Josué son gerentes generales, no tienen jefe.
    const t = buildOrgTree([
      p('v', 'Verónica'), p('j', 'Josué'),
      p('x', 'Equipo de V', 'v'), p('y', 'Equipo de J', 'j'),
    ]);
    expect(nombres(t.cima)).toEqual(['Josué', 'Verónica']);
    expect(t.cima.every(n => n.equipo.length === 1)).toBe(true);
  });
});

describe('buildOrgTree — huérfanos', () => {
  it('quien apunta a un jefe que no está en la lista no se pierde', () => {
    // Pasa cuando desactivan al jefe: sigue referenciado pero ya no viene.
    const t = buildOrgTree([p('a', 'Ana'), p('b', 'Beto', 'inactivo')]);
    expect(nombres(t.cima)).toEqual(['Ana']);
    expect(nombres(t.huerfanos)).toEqual(['Beto']);
  });

  it('un huérfano conserva a su propio equipo', () => {
    const t = buildOrgTree([p('b', 'Beto', 'inactivo'), p('c', 'Caro', 'b')]);
    expect(nombres(t.huerfanos)).toEqual(['Beto']);
    expect(nombres(t.huerfanos[0].equipo)).toEqual(['Caro']);
  });
});

describe('buildOrgTree — ciclos', () => {
  /**
   * Estas tres pruebas existen porque un recorrido recursivo ingenuo sobre un
   * ciclo NO da un resultado equivocado: cuelga la pestaña. `resolveManager`
   * cubre el caso de ser su propio jefe y el PUT valida los ciclos de dos,
   * pero nada valida los de tres o más.
   */
  it('un ciclo de dos no cuelga y sale nombrado', () => {
    const t = buildOrgTree([p('a', 'Ana', 'b'), p('b', 'Beto', 'a')]);
    expect(t.ciclos).toHaveLength(1);
    expect(t.ciclos[0].map(x => x.nombre).sort()).toEqual(['Ana', 'Beto']);
    expect(t.cima).toEqual([]);
  });

  it('un ciclo de tres tampoco cuelga', () => {
    const t = buildOrgTree([p('a', 'Ana', 'b'), p('b', 'Beto', 'c'), p('c', 'Caro', 'a')]);
    expect(t.ciclos).toHaveLength(1);
    expect(t.ciclos[0].map(x => x.nombre).sort()).toEqual(['Ana', 'Beto', 'Caro']);
  });

  it('el ciclo se reporta UNA vez, no una por cada integrante', () => {
    const t = buildOrgTree([p('a', 'Ana', 'b'), p('b', 'Beto', 'c'), p('c', 'Caro', 'a')]);
    expect(t.ciclos).toHaveLength(1);
  });

  it('un ciclo no se lleva puesto al resto del organigrama', () => {
    const t = buildOrgTree([
      p('a', 'Ana', 'b'), p('b', 'Beto', 'a'),          // ciclo
      p('z', 'Zoe'), p('y', 'Yago', 'z'),               // rama sana
    ]);
    expect(t.ciclos).toHaveLength(1);
    expect(nombres(t.cima)).toEqual(['Zoe']);
    expect(nombres(t.cima[0].equipo)).toEqual(['Yago']);
  });

  it('quien depende de alguien atrapado en un ciclo sale como huérfano, no desaparece', () => {
    const t = buildOrgTree([
      p('a', 'Ana', 'b'), p('b', 'Beto', 'a'),   // ciclo
      p('c', 'Caro', 'a'),                        // su jefe está en el ciclo
    ]);
    expect(t.ciclos).toHaveLength(1);
    expect(nombres(t.huerfanos)).toEqual(['Caro']);
  });
});

describe('buildOrgTree — bordes', () => {
  it('una lista vacía da un árbol vacío, no revienta', () => {
    expect(buildOrgTree([])).toEqual({ cima: [], huerfanos: [], ciclos: [] });
  });

  it('quien no tiene nombre va al final y no intercalado en el alfabeto', () => {
    const t = buildOrgTree([p('a', 'Ana'), p('x', null), p('z', 'Zoe')]);
    expect(nombres(t.cima)).toEqual(['Ana', 'Zoe', null]);
  });

  it('ordena respetando acentos del español', () => {
    const t = buildOrgTree([p('1', 'Zulema'), p('2', 'Ángela'), p('3', 'Bruno')]);
    expect(nombres(t.cima)).toEqual(['Ángela', 'Bruno', 'Zulema']);
  });

  it('alguien que se apunta a sí mismo como jefe no se cuelga de sí mismo', () => {
    // resolveManager ya lo impide del lado del servidor; acá se verifica que
    // la pantalla no dependa de esa garantía.
    const t = buildOrgTree([p('a', 'Ana', 'a')]);
    expect(t.cima.concat(t.huerfanos).some(n => n.equipo.length > 0)).toBe(false);
    expect(t.ciclos.length + t.huerfanos.length).toBeGreaterThan(0);
  });
});

describe('cadenaDeMando', () => {
  const equipo = [
    p('jr', 'Josué'), p('dd', 'Daniela', 'jr'), p('jl', 'José', 'dd'), p('fc', 'Facundo', 'jl'),
  ];

  it('va de la raíz hasta la persona, en orden', () => {
    expect(cadenaDeMando(equipo, 'fc').map(x => x.nombre)).toEqual(['Josué', 'Daniela', 'José', 'Facundo']);
  });

  it('para una raíz, la cadena es ella sola', () => {
    expect(cadenaDeMando(equipo, 'jr').map(x => x.nombre)).toEqual(['Josué']);
  });

  it('un id que no existe da cadena vacía', () => {
    expect(cadenaDeMando(equipo, 'nadie')).toEqual([]);
  });

  it('corta donde el jefe ya no está, sin inventar el resto', () => {
    const sueltos = [p('x', 'Equis', 'inactivo')];
    expect(cadenaDeMando(sueltos, 'x').map(n => n.nombre)).toEqual(['Equis']);
  });

  /** Sin el corte por visitados, un ciclo deja este bucle girando para siempre. */
  it('un ciclo no cuelga el recorrido', () => {
    const ciclo = [p('a', 'Ana', 'b'), p('b', 'Beto', 'a')];
    const r = cadenaDeMando(ciclo, 'a');
    expect(r.length).toBeLessThanOrEqual(2);
    expect(r.map(x => x.nombre)).toContain('Ana');
  });
});

describe('saludOrg', () => {
  it('un organigrama correcto se declara sano', () => {
    const gente = [p('jr', 'Josué', null, 'Grupo VLA'), p('dd', 'Daniela', 'jr', 'Finanzas')];
    const s = saludOrg(gente, buildOrgTree(gente));
    expect(s.sana).toBe(true);
    expect(s.sueltos).toEqual([]);
  });

  /**
   * El caso real: Verónica es gerenta general, sin jefe y sin equipo. La regla
   * mecánica la marcaría como suelta; declararla raíz legítima la salva.
   */
  it('una raíz declarada no figura como suelta aunque no tenga equipo', () => {
    const gente = [p('vv', 'Verónica', null, 'RRHH'), p('jr', 'Josué', null, 'Grupo VLA'), p('x', 'Equis', 'jr', 'Ventas')];
    expect(saludOrg(gente, buildOrgTree(gente), new Set(['vv'])).sueltos).toEqual([]);
    // Sin declararla, sí aparece: la regla no adivina quién manda.
    expect(saludOrg(gente, buildOrgTree(gente)).sueltos.map(x => x.nombre)).toEqual(['Verónica']);
  });

  it('quien no tiene jefe pero sí equipo es cima, no un problema', () => {
    const gente = [p('jr', 'Josué', null, 'Grupo VLA'), p('x', 'Equis', 'jr', 'Ventas')];
    expect(saludOrg(gente, buildOrgTree(gente)).sueltos).toEqual([]);
  });

  it('señala a quien quedó sin jefe activo', () => {
    const gente = [p('b', 'Beto', 'inactivo', 'Ventas')];
    const s = saludOrg(gente, buildOrgTree(gente));
    expect(s.huerfanos.map(x => x.nombre)).toEqual(['Beto']);
    expect(s.sana).toBe(false);
  });

  it('señala los ciclos y a quien no tiene departamento', () => {
    const gente = [p('a', 'Ana', 'b', 'Ventas'), p('b', 'Beto', 'a', null)];
    const s = saludOrg(gente, buildOrgTree(gente));
    expect(s.ciclos).toHaveLength(1);
    expect(s.sinDepartamento.map(x => x.nombre)).toEqual(['Beto']);
    expect(s.sana).toBe(false);
  });
});

describe('horaLocalDe', () => {
  const instante = new Date('2026-10-01T18:00:00Z');

  it('convierte a la zona del país', () => {
    expect(horaLocalDe('CR', instante)).toBe('12:00');  // UTC-6
    expect(horaLocalDe('CO', instante)).toBe('13:00');  // UTC-5
    expect(horaLocalDe('AR', instante)).toBe('15:00');  // UTC-3
  });

  it('sin país no inventa una hora', () => {
    expect(horaLocalDe(null, instante)).toBeNull();
    expect(horaLocalDe(undefined, instante)).toBeNull();
  });

  it('un país fuera del catálogo tampoco inventa', () => {
    expect(horaLocalDe('ZZ', instante)).toBeNull();
  });

  it('acepta el ISO en minúsculas', () => {
    expect(horaLocalDe('ar', instante)).toBe('15:00');
  });
});
