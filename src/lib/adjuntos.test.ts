import { describe, it, expect } from 'vitest';
import { validarAdjuntos, nombreSeguro, bytesDeBase64, MAX_BYTES, MAX_POR_SOLICITUD } from './adjuntos';

const b64De = (bytes: number) => Buffer.alloc(bytes).toString('base64');
const pdf = (bytes = 1000, nombre = 'boleta.pdf') =>
  ({ nombre, tipo: 'application/pdf', contenido: b64De(bytes) });

describe('bytesDeBase64 — mide sin decodificar', () => {
  it.each([0, 1, 2, 3, 100, 5000])('acierta con %i bytes', n => {
    expect(bytesDeBase64(b64De(n))).toBe(n);
  });
  it('tolera saltos de línea', () => {
    const con = b64De(900).replace(/(.{40})/g, '$1\n');
    expect(bytesDeBase64(con)).toBe(900);
  });
});

describe('validarAdjuntos', () => {
  it('acepta un pdf normal', () => {
    expect(validarAdjuntos([pdf()])).toEqual([]);
  });

  it('rechaza lo que no sea documento o imagen', () => {
    const malo = { nombre: 'x.exe', tipo: 'application/x-msdownload', contenido: b64De(10) };
    expect(validarAdjuntos([malo])).toEqual([{ campo: 'adjuntos[0]', error: 'tipo_no_permitido' }]);
  });

  it('rechaza por tamaño', () => {
    expect(validarAdjuntos([pdf(MAX_BYTES + 1)])).toEqual([{ campo: 'adjuntos[0]', error: 'muy_grande' }]);
    expect(validarAdjuntos([pdf(MAX_BYTES)])).toEqual([]);     // justo en el límite entra
  });

  it('rechaza vacíos', () => {
    expect(validarAdjuntos([{ nombre: 'a.pdf', tipo: 'application/pdf', contenido: '' }]))
      .toEqual([{ campo: 'adjuntos[0]', error: 'vacio' }]);
  });

  it('corta en el máximo por solicitud', () => {
    const muchos = Array.from({ length: MAX_POR_SOLICITUD + 1 }, () => pdf());
    expect(validarAdjuntos(muchos)).toEqual([{ campo: 'adjuntos', error: 'demasiados' }]);
  });

  it('señala cuál de varios falla', () => {
    const errs = validarAdjuntos([pdf(), { nombre: 'y.exe', tipo: 'text/html', contenido: b64De(5) }]);
    expect(errs).toEqual([{ campo: 'adjuntos[1]', error: 'tipo_no_permitido' }]);
  });
});

describe('nombreSeguro — lo que se escribe en disco', () => {
  it('quita rutas: un nombre no puede escapar de la carpeta', () => {
    expect(nombreSeguro('../../etc/passwd', 'application/pdf')).toBe('passwd.pdf');
    expect(nombreSeguro('C:\\Users\\x\\boleta.pdf', 'application/pdf')).toBe('boleta.pdf');
  });

  it('la extensión sale del tipo declarado, no del nombre', () => {
    // el clásico "factura.pdf.exe": la extensión real la pone el tipo
    expect(nombreSeguro('factura.pdf.exe', 'image/png')).toBe('factura.pdf.png');
  });

  it('limpia acentos y caracteres raros', () => {
    expect(nombreSeguro('Constancia médica #1 <script>.pdf', 'application/pdf'))
      .toBe('Constancia medica 1 script.pdf');
  });

  it('un nombre que queda vacío recibe uno por defecto', () => {
    expect(nombreSeguro('///.pdf', 'application/pdf')).toBe('documento.pdf');
    expect(nombreSeguro('', 'application/pdf')).toBe('documento.pdf');
  });

  it('acota el largo', () => {
    expect(nombreSeguro('a'.repeat(200) + '.pdf', 'application/pdf').length).toBeLessThanOrEqual(64);
  });
});
