import { describe, expect, it } from 'vitest';
import { guiasPara } from './guiasUx';

describe('guiasPara — qué guías ofrece el libro', () => {
  it('un colaborador ve solo la suya', () => {
    expect(guiasPara({ aprueba: false, rrhh: false }).map(g => g.id)).toEqual(['colaboradores']);
  });

  it('un jefe ve la de colaboradores y la de jefes', () => {
    expect(guiasPara({ aprueba: true, rrhh: false }).map(g => g.id)).toEqual(['colaboradores', 'jefes']);
  });

  it('RRHH ve las tres', () => {
    expect(guiasPara({ aprueba: true, rrhh: true }).map(g => g.id)).toEqual(['colaboradores', 'jefes', 'rrhh']);
  });

  it('la dirección de la guía de colaboradores no cambia (ya se compartió)', () => {
    expect(guiasPara({ aprueba: false, rrhh: false })[0].archivo).toBe('ayuda/colaboradores.html');
  });
});
