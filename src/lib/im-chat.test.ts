import { describe, it, expect } from 'vitest';
import { reaccionValida, idMensajeValido, bytesDeBase64, nombreArchivoSeguro } from './im-chat';

describe('reaccionValida', () => {
  it.each([['like'], ['laugh'], ['facepalm']])('acepta %s', (r) => expect(reaccionValida(r)).toBe(true));
  it.each([['love'], [''], [null], ['LIKE']])('rechaza %p', (r) => expect(reaccionValida(r)).toBe(false));
});

describe('idMensajeValido', () => {
  it('números y texto numérico', () => {
    expect(idMensajeValido('19733281')).toBe(true);
    expect(idMensajeValido(19733281)).toBe(true);
  });
  it('nada raro', () => {
    expect(idMensajeValido('1; DROP')).toBe(false);
    expect(idMensajeValido(-1)).toBe(false);
    expect(idMensajeValido(undefined)).toBe(false);
  });
});

describe('bytesDeBase64', () => {
  it('cuenta los bytes reales', () => {
    expect(bytesDeBase64(Buffer.from('hola').toString('base64'))).toBe(4);
    expect(bytesDeBase64(Buffer.from('holas').toString('base64'))).toBe(5);
    expect(bytesDeBase64(Buffer.from('hola!!').toString('base64'))).toBe(6);
  });
  it('lo que no es base64 da null', () => {
    expect(bytesDeBase64('no es base64!')).toBeNull();
    expect(bytesDeBase64('')).toBeNull();
    expect(bytesDeBase64(42)).toBeNull();
  });
});

describe('nombreArchivoSeguro', () => {
  it('saca la ruta y lo que Windows no acepta', () => {
    expect(nombreArchivoSeguro('C:\\Users\\ana\\informe: final?.pdf')).toBe('informe final.pdf');
    expect(nombreArchivoSeguro('../../etc/passwd')).toBe('passwd');
  });
  it('vacío o solo puntos no sirve', () => {
    expect(nombreArchivoSeguro('..')).toBeNull();
    expect(nombreArchivoSeguro('   ')).toBeNull();
  });
  it('recorta los nombres larguísimos conservando la extensión', () => {
    const n = nombreArchivoSeguro('a'.repeat(300) + '.pdf')!;
    expect(n.length).toBe(120);
    expect(n.endsWith('.pdf')).toBe(true);
  });
});
