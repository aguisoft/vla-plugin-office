import { describe, it, expect } from 'vitest';
import { armarContactos } from './im-contactos';

const personas = [
  { userId: 'yo', firstName: 'Carlos', lastName: 'Aguinaga', status: 'AVAILABLE' },
  { userId: 'b', firstName: 'Verónica', lastName: 'Vasquez', status: 'FOCUS' },
  { userId: 'a', firstName: 'Ana', lastName: 'Pérez', status: 'LUNCH', isCheckedIn: true, statusEndsAt: '2026-10-01T19:30:00.000Z' },
  { userId: 'sin', firstName: 'Sin', lastName: 'Bitrix', status: 'AVAILABLE' },
];
const mapeos = [{ userId: 'yo', bitrixUserId: 949 }, { userId: 'a', bitrixUserId: 1001 }, { userId: 'b', bitrixUserId: 1002 }];

describe('armarContactos', () => {
  it('ordena por nombre, sin mí ni quien no tiene Bitrix', () => {
    expect(armarContactos(personas, mapeos, 'yo').map(c => c.nombre)).toEqual(['Ana Pérez', 'Verónica Vasquez']);
  });

  it('trae el diálogo de Bitrix y el estado de cada uno', () => {
    expect(armarContactos(personas, mapeos, 'yo')[0]).toEqual({
      userId: 'a', nombre: 'Ana Pérez', bitrixUserId: '1001', status: 'LUNCH',
      enOficina: true, hasta: '2026-10-01T19:30:00.000Z', detalle: null,
    });
  });

  it('una ausencia manda sobre el horario del estado y se ve quién no está en la oficina', () => {
    const c = armarContactos([{ userId: 'a', firstName: 'Ana', lastName: 'P', status: 'VACACIONES', isCheckedIn: false, absenceEndsAt: '2026-10-05T06:00:00.000Z', statusEndsAt: 'x' }], mapeos, 'yo')[0];
    expect(c).toMatchObject({ enOficina: false, hasta: '2026-10-05T06:00:00.000Z' });
  });
});
