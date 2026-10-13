import { describe, expect, it } from 'vitest';
import { guiasPara } from './guiasUx';

describe('guiasPara — qué guías ofrece el libro', () => {
  it('un colaborador ve solo la suya', () => {
    expect(guiasPara(false).map(g => g.id)).toEqual(['colaboradores']);
  });

  it('quien aprueba ve la de colaboradores y la de jefes', () => {
    expect(guiasPara(true).map(g => g.id)).toEqual(['colaboradores', 'jefes']);
  });

  it('la dirección de la guía de colaboradores no cambia (ya se compartió)', () => {
    expect(guiasPara(false)[0].archivo).toBe('ayuda/colaboradores.html');
  });
});
