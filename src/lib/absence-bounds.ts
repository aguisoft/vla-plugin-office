import { localDayStart, localDayEnd } from './local-date';
import { FULL_DAY_TYPES } from './absence-validation';

/**
 * Ancla a mediodía UTC de la fecha indicada por el string recibido -- se usa
 * SOLO la parte de fecha (`slice(0, 10)`), no la hora. Para VACACIONES/
 * INCAPACIDAD el contrato del endpoint pide una fecha PURA ("YYYY-MM-DD"),
 * sin hora ni zona (ver `AbsenceInput` en `absence-validation.ts`), así que
 * en el camino normal no hay hora que descartar. Esta función queda como
 * red de seguridad si de todos modos llega un datetime completo (p. ej. una
 * llamada directa a la API que no siga el contrato): mediodía UTC cae
 * dentro del mismo día calendario en cualquier huso horario real, así que
 * tomar solo la fecha nunca corre el día, sin importar la hora que traiga.
 */
export function dateOnlyAnchor(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T12:00:00.000Z`);
}

/**
 * Límites de una ausencia ya validada, listos para persistir.
 *
 *  - VACACIONES/INCAPACIDAD (día completo): 00:00:00/23:59:59.999 hora de
 *    `tz` -- el spec dice "hora local convertida a UTC". El cliente para
 *    estos dos manda FECHAS PURAS, no instantes, y eso es a propósito: la
 *    regresión que este módulo reemplaza pasaba porque el navegador
 *    convertía "medianoche local" a UTC con SU PROPIA zona
 *    (`new Date(...).toISOString()` en `DateRangeModal.tsx`), y este
 *    anclaje -- que ya asume que solo le llega una fecha -- le aplicaba una
 *    SEGUNDA conversión a un valor que ya había sido corrido una vez. Con
 *    una fecha pura no hay conversión previa que deshacer: `dateOnlyAnchor`
 *    lee el día tal cual lo tipeó la persona y `localDayStart`/`localDayEnd`
 *    son la ÚNICA conversión de zona que corre, y corre con la de la
 *    operación (`tz`), no la del navegador.
 *  - PERMISO: instante real, sin normalizar -- ya viene con la hora exacta
 *    que importa.
 */
export function absenceBounds(
  type: string, startAt: string, endAt: string, tz: string,
): { startAt: Date; endAt: Date } {
  if (FULL_DAY_TYPES.has(type as any)) {
    return {
      startAt: localDayStart(dateOnlyAnchor(startAt), tz),
      endAt: localDayEnd(dateOnlyAnchor(endAt), tz),
    };
  }
  return { startAt: new Date(startAt), endAt: new Date(endAt) };
}
