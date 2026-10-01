import { describe, it, expect } from 'vitest';
import { armarContactos } from './im-contactos';

const personas = [
  { userId: 'yo', firstName: 'Carlos', lastName: 'Aguinaga', status: 'AVAILABLE' },
  { userId: 'b', firstName: 'Verónica', lastName: 'Vasquez', status: 'FOCUS' },
  { userId: 'a', firstName: 'Ana', lastName: 'Pérez', status: 'LUNCH' },
  { userId: 'sin', firstName: 'Sin', lastName: 'Bitrix', status: 'AVAILABLE' },
];
const mapeos = [{ userId: 'yo', bitrixUserId: 949 }, { userId: 'a', bitrixUserId: 1001 }, { userId: 'b', bitrixUserId: 1002 }];

describe('armarContactos', () => {
  it('ordena por nombre, sin mí ni quien no tiene Bitrix', () => {
    expect(armarContactos(personas, mapeos, 'yo').map(c => c.nombre)).toEqual(['Ana Pérez', 'Verónica Vasquez']);
  });

  it('trae el diálogo de Bitrix y el estado de cada uno', () => {
    expect(armarContactos(personas, mapeos, 'yo')[0]).toEqual({ userId: 'a', nombre: 'Ana Pérez', bitrixUserId: '1001', status: 'LUNCH' });
  });
});
