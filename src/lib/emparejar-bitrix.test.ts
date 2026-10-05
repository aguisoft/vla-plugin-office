import { describe, it, expect } from 'vitest';
import { emparejarUsuarios } from './emparejar-bitrix';

const bx = [
  { ID: '238079', EMAIL: 'yamila.personal@gmail.com' },
  { ID: '100', EMAIL: 'ana@grupovla.com' },
  { ID: '200', EMAIL: 'sin.cuenta@grupovla.com' },
];

describe('emparejarUsuarios', () => {
  it('el vínculo guardado gana aunque el email no coincida (caso Yamila)', () => {
    const r = emparejarUsuarios(bx, new Map([['238079', 'u-yamila']]), new Map([['ygoncebat@grupovla.com', 'u-yamila']]));
    expect(r.find(x => x.userId === 'u-yamila')).toMatchObject({ por: 'vinculo', bitrix: { ID: '238079' } });
  });
  it('sin vínculo, por email (sin importar mayúsculas)', () => {
    const r = emparejarUsuarios([{ ID: '100', EMAIL: 'Ana@GrupoVLA.com' }], new Map(), new Map([['ana@grupovla.com', 'u-ana']]));
    expect(r).toEqual([{ bitrix: { ID: '100', EMAIL: 'Ana@GrupoVLA.com' }, userId: 'u-ana', por: 'email' }]);
  });
  it('nadie se empareja dos veces; quien no está en system queda afuera', () => {
    const r = emparejarUsuarios(
      [...bx, { ID: '101', EMAIL: 'ana@grupovla.com' }],
      new Map([['238079', 'u-yamila']]),
      new Map([['ana@grupovla.com', 'u-ana']]),
    );
    expect(r.map(x => `${x.bitrix.ID}:${x.userId}`)).toEqual(['238079:u-yamila', '100:u-ana']);
  });
  it('un Bitrix vinculado a otra persona no se usa por email', () => {
    const r = emparejarUsuarios([{ ID: '100', EMAIL: 'ana@grupovla.com' }], new Map([['100', 'u-otra']]), new Map([['ana@grupovla.com', 'u-ana']]));
    expect(r).toEqual([{ bitrix: { ID: '100', EMAIL: 'ana@grupovla.com' }, userId: 'u-otra', por: 'vinculo' }]);
  });
});
