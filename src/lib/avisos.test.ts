import { describe, it, expect } from 'vitest';
import { leerPedidoDeAviso, rutaInterna, recortar } from './avisos';

describe('rutaInterna', () => {
  it('acepta rutas del sistema y descarta lo demás', () => {
    expect(rutaInterna('/dashboard/office?solicitudes=1')).toBe('/dashboard/office?solicitudes=1');
    expect(rutaInterna('//evil.com/x')).toBeNull();
    expect(rutaInterna('https://evil.com')).toBeNull();
    expect(rutaInterna(42)).toBeNull();
  });
});

describe('recortar', () => {
  it('deja el texto corto igual y corta el largo con «…»', () => {
    expect(recortar('  hola ', 10)).toBe('hola');
    expect(recortar('abcdefghijk', 5)).toBe('abcd…');
  });
});

describe('leerPedidoDeAviso', () => {
  it('arma el aviso con los valores por defecto', () => {
    expect(leerPedidoDeAviso({ userId: 'u1', tipo: 'leads.nuevos', titulo: '3 leads nuevos', url: '/dashboard/dashboards' })).toEqual({
      userIds: ['u1'],
      aviso: { tipo: 'leads.nuevos', titulo: '3 leads nuevos', cuerpo: '', url: '/dashboard/dashboards', guardar: true, emergente: true, bitrix: null, correo: false },
    });
  });
  it('acepta varios destinos sin repetir y respeta guardar/emergente en falso', () => {
    const r = leerPedidoDeAviso({ userIds: ['a', 'b', 'a', 7], tipo: 'x', titulo: 't', guardar: false, emergente: false, bitrix: 'hola' });
    expect(r?.userIds).toEqual(['a', 'b']);
    expect(r?.aviso).toMatchObject({ guardar: false, emergente: false, bitrix: 'hola' });
  });
  it('sin destino, sin tipo válido o sin título, no hay aviso', () => {
    expect(leerPedidoDeAviso({ tipo: 'x', titulo: 't' })).toBeNull();
    expect(leerPedidoDeAviso({ userId: 'a', tipo: 'con espacios', titulo: 't' })).toBeNull();
    expect(leerPedidoDeAviso({ userId: 'a', tipo: 'x', titulo: '  ' })).toBeNull();
    expect(leerPedidoDeAviso(null)).toBeNull();
  });
  it('una url externa se descarta sin perder el aviso', () => {
    expect(leerPedidoDeAviso({ userId: 'a', tipo: 'x', titulo: 't', url: 'https://otro.com' })?.aviso.url).toBeNull();
  });
});
