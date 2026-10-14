import { describe, it, expect } from 'vitest';
import { resultadoGoogle, mensajeResultadoGoogle, textoOcupado } from './googleUx';

describe('resultadoGoogle', () => {
  it('lee ?google= del iframe o de la página', () => {
    expect(resultadoGoogle('?google=listo')).toBe('listo');
    expect(resultadoGoogle('', '?x=1&google=dominio')).toBe('dominio');
    expect(resultadoGoogle('?google=otra-cosa')).toBeNull();
    expect(resultadoGoogle(null)).toBeNull();
  });
});

describe('mensajeResultadoGoogle', () => {
  it('dice qué pasó y qué hacer', () => {
    expect(mensajeResultadoGoogle('listo').tono).toBe('ok');
    expect(mensajeResultadoGoogle('dominio').texto).toContain('@grupovla.com o @vlacademy.com');
    expect(resultadoGoogle('?google=sesion')).toBe('sesion');
    expect(resultadoGoogle('?google=api')).toBe('api');
    expect(mensajeResultadoGoogle('api').texto).toContain('administrador');
    expect(mensajeResultadoGoogle('sesion').texto).toContain('tu propia sesión');
  });
});

describe('textoOcupado', () => {
  it('en la hora de Costa Rica', () => {
    expect(textoOcupado('2026-10-14T16:30:00Z')).toBe('Ocupado en Google hasta las 10:30');
  });
});
