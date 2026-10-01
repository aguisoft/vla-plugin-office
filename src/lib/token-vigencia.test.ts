import { describe, it, expect } from 'vitest';
import { necesitaRefresco, esAccesoRevocado, validarConexion } from './token-vigencia';

const AHORA = 1_000_000_000_000;

describe('necesitaRefresco', () => {
  it('un token vencido se refresca', () => {
    expect(necesitaRefresco(AHORA - 1, AHORA)).toBe(true);
  });

  it('uno que vence dentro del margen también: vencería en vuelo', () => {
    expect(necesitaRefresco(AHORA + 30_000, AHORA)).toBe(true);
  });

  it('uno vigente no', () => {
    expect(necesitaRefresco(AHORA + 10 * 60_000, AHORA)).toBe(false);
  });

  it('el borde exacto del margen ya refresca', () => {
    expect(necesitaRefresco(AHORA + 60_000, AHORA)).toBe(true);
    expect(necesitaRefresco(AHORA + 60_001, AHORA)).toBe(false);
  });

  it('respeta un margen distinto', () => {
    expect(necesitaRefresco(AHORA + 5_000, AHORA, 1_000)).toBe(false);
  });
});

describe('esAccesoRevocado', () => {
  it('reconoce invalid_grant venga como venga', () => {
    expect(esAccesoRevocado(new Error('OAuth error: invalid_grant — revocado'))).toBe(true);
    expect(esAccesoRevocado('INVALID_GRANT')).toBe(true);
  });

  it('un corte de red no es una revocación: no hay que borrar los tokens', () => {
    expect(esAccesoRevocado(new Error('fetch failed'))).toBe(false);
    expect(esAccesoRevocado(new Error('[im.recent.get] QUERY_LIMIT_EXCEEDED: '))).toBe(false);
  });
});

describe('validarConexion', () => {
  it('el mismo usuario de Bitrix: se guarda', () => {
    expect(validarConexion(949, '949')).toBe('ok');
  });

  /** Una compu compartida con la sesión de Bitrix de otra persona abierta. */
  it('otro usuario de Bitrix: se rechaza', () => {
    expect(validarConexion(949, '1001')).toBe('otra_cuenta');
  });

  it('si Bitrix no dijo quién autorizó, no se puede confiar', () => {
    expect(validarConexion(949, null)).toBe('otra_cuenta');
  });

  it('sin mapeo no hay con qué comparar', () => {
    expect(validarConexion(null, '949')).toBe('sin_mapeo');
  });
});
