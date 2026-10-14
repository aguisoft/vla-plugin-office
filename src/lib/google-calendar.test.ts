import { describe, it, expect } from 'vitest';
import {
  dominioPermitido, firmarEstado, leerEstado, eventosDeAusencias, firmaDe, planDeAusencias,
  reunionEnCurso, decidirEstado, ocupadoHasta, coincide, type EventoGoogle,
} from './google-calendar';

const TZ = 'America/Costa_Rica';
const AHORA = new Date('2026-10-14T16:00:00Z'); // 10:00 en Costa Rica

describe('dominioPermitido', () => {
  it('solo los dos Workspace de VLA', () => {
    expect(dominioPermitido('ana@grupovla.com')).toBe(true);
    expect(dominioPermitido('Ana@VLAcademy.com')).toBe(true);
    expect(dominioPermitido('ana@gmail.com')).toBe(false);
    expect(dominioPermitido('ana@grupovla.com.evil.io')).toBe(false);
  });
});

describe('estado firmado del enlace para conectar', () => {
  const S = 'secreto';
  it('devuelve el userId si es nuestro y no venció', () => {
    expect(leerEstado(firmarEstado('u1', 1000, S), S, 1000 + 60_000)).toBe('u1');
  });
  it('rechaza uno vencido, adulterado o firmado con otra clave', () => {
    const e = firmarEstado('u1', 1000, S);
    expect(leerEstado(e, S, 1000 + 11 * 60_000)).toBeNull();
    expect(leerEstado(e, 'otro', 1000)).toBeNull();
    expect(leerEstado(firmarEstado('u2', 1000, S).split('.')[0] + '.' + e.split('.')[1], S, 1000)).toBeNull();
    expect(leerEstado('basura', S, 1000)).toBeNull();
  });
});

describe('eventosDeAusencias', () => {
  it('las de días van hasta la medianoche siguiente; el título no dice el motivo', () => {
    const ev = eventosDeAusencias([
      { id: 'a1', type: 'VACACIONES', startAt: new Date('2026-12-21T06:00:00Z'), endAt: new Date('2026-12-24T05:59:59.999Z') },
      { id: 'a2', type: 'CITA_MEDICA', startAt: new Date('2026-10-20T20:00:00Z'), endAt: new Date('2026-10-20T21:30:00Z') },
    ], [{ fecha: '2026-12-01', nombre: 'Abolición del Ejército' }], TZ);
    expect(ev).toEqual([
      { clave: 'ausencia:a1', titulo: 'Vacaciones', inicio: '2026-12-21T06:00:00.000Z', fin: '2026-12-24T06:00:00.000Z', privado: false },
      { clave: 'ausencia:a2', titulo: 'Fuera de la oficina', inicio: '2026-10-20T20:00:00.000Z', fin: '2026-10-20T21:30:00.000Z', privado: true },
      { clave: 'feriado:2026-12-01', titulo: 'Feriado · Abolición del Ejército', inicio: '2026-12-01T06:00:00.000Z', fin: '2026-12-02T06:00:00.000Z', privado: false },
    ]);
  });
});

it('el feriado del 31 de diciembre termina el 1 de enero', () => {
  expect(eventosDeAusencias([], [{ fecha: '2026-12-31', nombre: null }], TZ)[0])
    .toMatchObject({ titulo: 'Feriado', inicio: '2026-12-31T06:00:00.000Z', fin: '2027-01-01T06:00:00.000Z' });
});

describe('planDeAusencias', () => {
  const d = (clave: string, fin = '2026-12-01T00:00:00.000Z', titulo = 'Vacaciones') => ({ clave, titulo, inicio: '2026-11-30T00:00:00.000Z', fin, privado: false });
  const e = (clave: string, x = d(clave)) => ({ clave, eventId: 'g-' + clave, firma: firmaDe(x), fin: x.fin });

  it('crea lo que falta y borra lo que ya no va (anulada, no aprobada)', () => {
    const p = planDeAusencias([d('ausencia:1'), d('ausencia:2')], [e('ausencia:2'), e('ausencia:3')], AHORA);
    expect(p.crear.map(x => x.clave)).toEqual(['ausencia:1']);
    expect(p.borrar).toEqual([{ clave: 'ausencia:3', eventId: 'g-ausencia:3' }]);
  });
  it('si cambiaron las fechas, borra y crea de nuevo', () => {
    const p = planDeAusencias([d('feriado:2026-12-01', '2026-12-02T00:00:00.000Z')], [e('feriado:2026-12-01')], AHORA);
    expect(p.borrar.map(x => x.clave)).toEqual(['feriado:2026-12-01']);
    expect(p.crear.map(x => x.clave)).toEqual(['feriado:2026-12-01']);
  });
  it('no toca lo que ya pasó ni los eventos de reuniones', () => {
    const viejo = d('ausencia:9', '2026-10-01T00:00:00.000Z');
    const p = planDeAusencias([], [e('ausencia:9', viejo), { clave: 'reunion:m1', eventId: 'x', firma: '', fin: '2026-12-01T00:00:00.000Z' }], AHORA);
    expect(p).toEqual({ crear: [], borrar: [] });
  });
});

describe('reunionEnCurso', () => {
  const base = (o: Partial<EventoGoogle> = {}): EventoGoogle => ({
    id: 'e1', summary: 'Demo con Acme',
    start: { dateTime: '2026-10-14T15:30:00Z' }, end: { dateTime: '2026-10-14T16:30:00Z' },
    attendees: [{ email: 'ana@grupovla.com', self: true, responseStatus: 'accepted' }, { email: 'cliente@acme.com', responseStatus: 'accepted' }],
    ...o,
  });
  it('una reunión aceptada con alguien de afuera: externa, con su título', () => {
    expect(reunionEnCurso([base()], AHORA)).toEqual({ id: 'e1', titulo: 'Demo con Acme', fin: new Date('2026-10-14T16:30:00Z'), externa: true });
  });
  it('si todos son de VLA, interna; si es privada, solo «Reunión»', () => {
    const r = reunionEnCurso([base({ visibility: 'private', attendees: [{ email: 'ana@grupovla.com', self: true, responseStatus: 'accepted' }, { email: 'bruno@vlacademy.com' }] })], AHORA);
    expect(r).toMatchObject({ titulo: 'Reunión', externa: false });
  });
  it.each([
    ['sola (sin otra gente)', { attendees: [] }],
    ['de todo el día', { start: { date: '2026-10-14' }, end: { date: '2026-10-15' } }],
    ['marcada como libre', { transparency: 'transparent' }],
    ['de concentración', { eventType: 'focusTime' }],
    ['rechazada', { attendees: [{ email: 'ana@grupovla.com', self: true, responseStatus: 'declined' }, { email: 'b@grupovla.com' }] }],
    ['sin responder', { attendees: [{ email: 'ana@grupovla.com', self: true, responseStatus: 'needsAction' }, { email: 'b@grupovla.com' }] }],
    ['que ya terminó', { end: { dateTime: '2026-10-14T16:00:00Z' } }],
  ])('no cuenta una %s', (_n, o) => {
    expect(reunionEnCurso([base(o as Partial<EventoGoogle>)], AHORA)).toBeNull();
  });
  it('la propia cuenta aunque no figure como aceptada', () => {
    expect(reunionEnCurso([base({ organizer: { self: true }, attendees: [{ email: 'ana@grupovla.com', self: true }, { email: 'b@grupovla.com' }] })], AHORA)).not.toBeNull();
  });
  it('no cuenta las reuniones que armó la oficina (esas ya ponen su estado)', () => {
    expect(reunionEnCurso([base({ extendedProperties: { private: { vlaOficina: 'reunion:m1' } } })], AHORA)).toBeNull();
  });
});

describe('coincide', () => {
  const d = { clave: 'ausencia:a1', titulo: 'Vacaciones', inicio: '2026-12-21T06:00:00.000Z', fin: '2026-12-24T06:00:00.000Z', privado: false };
  it('mismo título y horario, aunque Google lo devuelva con otro huso', () => {
    expect(coincide({ id: 'g', summary: 'Vacaciones', start: { dateTime: '2026-12-21T00:00:00-06:00' }, end: { dateTime: '2026-12-24T00:00:00-06:00' } }, d)).toBe(true);
    expect(coincide({ id: 'g', summary: 'Vacaciones', start: { dateTime: '2026-12-21T00:00:00-06:00' }, end: { dateTime: '2026-12-25T00:00:00-06:00' } }, d)).toBe(false);
    expect(coincide({ id: 'g', summary: 'Otra cosa', start: { dateTime: d.inicio }, end: { dateTime: d.fin } }, d)).toBe(false);
  });
});

describe('decidirEstado', () => {
  const reunion = { id: 'e1', titulo: 'Demo', fin: new Date('2026-10-14T16:30:00Z'), externa: true };
  const disp = { isCheckedIn: true, status: 'AVAILABLE', justification: null };
  it('pone «En reunión» solo a quien está en la oficina y Disponible', () => {
    expect(decidirEstado(reunion, disp, null)).toEqual({ tipo: 'poner', status: 'IN_MEETING_EXTERNAL', titulo: 'Demo', fin: reunion.fin, eventId: 'e1' });
    expect(decidirEstado(reunion, { ...disp, status: 'LUNCH' }, null)).toEqual({ tipo: 'nada' });
    expect(decidirEstado(reunion, { ...disp, isCheckedIn: false }, null)).toEqual({ tipo: 'nada' });
  });
  const puesto = { eventId: 'e1', status: 'IN_MEETING_EXTERNAL', titulo: 'Demo' };
  const enReunion = { isCheckedIn: true, status: 'IN_MEETING_EXTERNAL', justification: 'Demo' };
  it('mientras dura, no hace nada; al terminar devuelve a Disponible', () => {
    expect(decidirEstado(reunion, enReunion, puesto)).toEqual({ tipo: 'nada' });
    expect(decidirEstado(null, enReunion, puesto)).toEqual({ tipo: 'devolver' });
  });
  it('si la persona cambió el estado, se olvida y no lo toca', () => {
    expect(decidirEstado(null, { ...enReunion, status: 'LUNCH' }, puesto)).toEqual({ tipo: 'olvidar' });
    expect(decidirEstado(null, { ...enReunion, justification: 'Otra cosa' }, puesto)).toEqual({ tipo: 'olvidar' });
  });
  it('si se puso Disponible con la reunión todavía corriendo, no se la vuelve a poner', () => {
    expect(decidirEstado(reunion, disp, puesto)).toEqual({ tipo: 'soltar' });
    const soltado = { ...puesto, soltado: true };
    expect(decidirEstado(reunion, disp, soltado)).toEqual({ tipo: 'nada' });
    // Cuando esa termina, se olvida; y la siguiente sí se pone.
    expect(decidirEstado(null, disp, soltado)).toEqual({ tipo: 'olvidar' });
    expect(decidirEstado({ ...reunion, id: 'e2' }, disp, soltado)).toMatchObject({ tipo: 'poner', eventId: 'e2' });
  });
  it('si sigue otra reunión pegada, la cambia', () => {
    expect(decidirEstado({ ...reunion, id: 'e2', titulo: 'Siguiente', externa: false }, enReunion, puesto))
      .toMatchObject({ tipo: 'poner', status: 'IN_MEETING_INTERNAL', titulo: 'Siguiente', eventId: 'e2' });
  });
});

describe('ocupadoHasta', () => {
  it('libre, ocupado, y bloques pegados se juntan', () => {
    expect(ocupadoHasta([], AHORA)).toBeNull();
    expect(ocupadoHasta([{ start: '2026-10-14T17:00:00Z', end: '2026-10-14T18:00:00Z' }], AHORA)).toBeNull();
    expect(ocupadoHasta([
      { start: '2026-10-14T15:30:00Z', end: '2026-10-14T16:30:00Z' },
      { start: '2026-10-14T16:30:00Z', end: '2026-10-14T17:00:00Z' },
      { start: '2026-10-14T18:00:00Z', end: '2026-10-14T19:00:00Z' },
    ], AHORA)).toEqual(new Date('2026-10-14T17:00:00Z'));
  });
});
