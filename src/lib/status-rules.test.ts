import { describe, it, expect } from 'vitest';
import { validateStatusInput, MIN_JUSTIFICATION } from './status-rules';
import { DEFAULT_TZ } from './local-date';

const TZ = DEFAULT_TZ;
const ok = (input: any) => validateStatusInput(input, TZ);
const fields = (input: any) => ok(input).map(e => e.field);

describe('validateStatusInput — estado', () => {
  it('acepta AVAILABLE sin nada más', () => {
    expect(ok({ status: 'AVAILABLE' })).toEqual([]);
  });

  it('rechaza un estado que no existe en el enum', () => {
    expect(fields({ status: 'PARRANDA' })).toContain('status');
  });

  it('rechaza BUSY, que se eliminó', () => {
    expect(fields({ status: 'BUSY' })).toContain('status');
  });

  it('rechaza OFFLINE: lo escribe solo el sistema', () => {
    const errs = ok({ status: 'OFFLINE' });
    expect(errs.map(e => e.field)).toContain('status');
    expect(errs[0].message).toMatch(/sistema/i);
  });
});

describe('validateStatusInput — justificación', () => {
  const needsIt = ['FOCUS', 'IN_MEETING_INTERNAL', 'IN_MEETING_EXTERNAL', 'BRB'];

  for (const status of needsIt) {
    it(`${status} sin justificación falla`, () => {
      expect(fields({ status })).toContain('justification');
    });

    it(`${status} con ${MIN_JUSTIFICATION} caracteres pasa`, () => {
      const base: any = { status, justification: 'a'.repeat(MIN_JUSTIFICATION) };
      if (status === 'IN_MEETING_INTERNAL') base.participantIds = [];
      expect(ok(base)).toEqual([]);
    });
  }

  it(`falla con ${MIN_JUSTIFICATION - 1} caracteres`, () => {
    expect(fields({
      status: 'FOCUS',
      justification: 'a'.repeat(MIN_JUSTIFICATION - 1),
    })).toContain('justification');
  });

  it('no cuenta los espacios de los extremos', () => {
    expect(fields({ status: 'FOCUS', justification: '   corto   ' }))
      .toContain('justification');
  });

  it('AVAILABLE no la exige', () => {
    expect(ok({ status: 'AVAILABLE' })).toEqual([]);
  });

  it('LUNCH no la exige', () => {
    expect(ok({
      status: 'LUNCH',
      startsAt: '2026-09-14T18:00:00Z',
      endsAt: '2026-09-14T19:00:00Z',
    })).toEqual([]);
  });
});

describe('validateStatusInput — rango de LUNCH', () => {
  it('exige los dos extremos', () => {
    expect(fields({ status: 'LUNCH' })).toContain('startsAt');
  });

  it('exige que el fin sea posterior al inicio', () => {
    expect(fields({
      status: 'LUNCH',
      startsAt: '2026-09-14T19:00:00Z',
      endsAt: '2026-09-14T18:00:00Z',
    })).toContain('endsAt');
  });

  it('rechaza extremos iguales', () => {
    expect(fields({
      status: 'LUNCH',
      startsAt: '2026-09-14T18:00:00Z',
      endsAt: '2026-09-14T18:00:00Z',
    })).toContain('endsAt');
  });

  it('exige que los dos caigan el mismo día local', () => {
    // 18:00Z del 14 es mediodía local del 14; 08:00Z del 15 son las 02:00 del 15
    expect(fields({
      status: 'LUNCH',
      startsAt: '2026-09-14T18:00:00Z',
      endsAt: '2026-09-15T08:00:00Z',
    })).toContain('endsAt');
  });

  it('rechaza el rango en un estado que no es LUNCH', () => {
    expect(fields({
      status: 'AVAILABLE',
      startsAt: '2026-09-14T18:00:00Z',
      endsAt: '2026-09-14T19:00:00Z',
    })).toContain('startsAt');
  });
});

describe('validateStatusInput — participantes', () => {
  const just = 'reunión de seguimiento semanal';

  it('IN_MEETING_INTERNAL los acepta', () => {
    expect(ok({
      status: 'IN_MEETING_INTERNAL',
      justification: just,
      participantIds: ['u1', 'u2'],
    })).toEqual([]);
  });

  it('otro estado los rechaza', () => {
    expect(fields({
      status: 'IN_MEETING_EXTERNAL',
      justification: just,
      participantIds: ['u1'],
    })).toContain('participantIds');
  });

  it('rechaza ids duplicados', () => {
    expect(fields({
      status: 'IN_MEETING_INTERNAL',
      justification: just,
      participantIds: ['u1', 'u1'],
    })).toContain('participantIds');
  });
});
