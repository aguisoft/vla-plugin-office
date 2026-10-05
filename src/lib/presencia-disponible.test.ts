import { describe, it, expect } from 'vitest';
import { disponibles } from './presencia-disponible';

describe('disponibles', () => {
  it('solo Disponible y Concentrado, en la oficina, sin ausencia, y de la lista pedida', () => {
    const personas = [
      { bitrixUserId: '1', isCheckedIn: true, status: 'AVAILABLE', ausente: false },
      { bitrixUserId: '2', isCheckedIn: true, status: 'LUNCH', ausente: false },
      { bitrixUserId: '3', isCheckedIn: false, status: 'OFFLINE', ausente: false },
      { bitrixUserId: '4', isCheckedIn: true, status: 'FOCUS', ausente: false },
      { bitrixUserId: '5', isCheckedIn: true, status: 'AVAILABLE', ausente: true },
      { bitrixUserId: '6', isCheckedIn: true, status: 'IN_MEETING_EXTERNAL', ausente: false },
      { bitrixUserId: '7', isCheckedIn: true, status: 'AVAILABLE', ausente: false },
    ];
    expect(disponibles(personas, ['1', '2', '3', '4', '5', '6', '9'])).toEqual(['1', '4']);
  });
});
