/**
 * Aritmética de fechas del calendario de feriados. Módulo puro y sin JSX para
 * que las pruebas lo cubran sin DOM.
 *
 * Vive aparte del componente por una razón concreta: **ninguna de estas
 * funciones puede pasar por UTC.** `Holiday.date` es una columna `@db.Date`
 * que Prisma serializa como medianoche UTC; leerla con `new Date(iso)` en
 * UTC−6 devuelve el día anterior, y escribir con `toISOString()` lo corre
 * para el otro lado. Ya pasó dos veces en este plugin (ver `format.ts` y el
 * Fix #4 de la revisión final), así que acá el corrimiento se previene por
 * construcción: se arman y se leen strings `YYYY-MM-DD` con componentes
 * locales y nunca se instancia un `Date` a partir de un ISO con `Z`.
 */

/** `YYYY-MM-DD` a partir de componentes locales. `month` es 0..11. */
export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Índice de día de semana con el LUNES en 0, como los calendarios de acá.
 * `Date.getDay()` pone el domingo en 0, que desplazaría toda la grilla un día.
 */
export function mondayFirst(jsDay: number): number {
  return (jsDay + 6) % 7;
}

/** Días que tiene el mes. `month` es 0..11. */
export function daysInMonth(year: number, month: number): number {
  // Día 0 del mes siguiente es el último del actual, y `new Date(y, m, d)`
  // usa componentes locales — sin conversión de zona.
  return new Date(year, month + 1, 0).getDate();
}

/** Cuántas celdas vacías van antes del día 1, con el lunes primero. */
export function leadingBlanks(year: number, month: number): number {
  return mondayFirst(new Date(year, month, 1).getDay());
}

/** ¿Cae sábado o domingo? Con el lunes en 0, son los índices 5 y 6. */
export function isWeekend(year: number, month: number, day: number): boolean {
  return mondayFirst(new Date(year, month, day).getDay()) >= 5;
}

/** Parte de fecha de un valor que puede venir como `YYYY-MM-DD` o ISO completo. */
export function dateKey(value: string): string {
  return (value ?? '').slice(0, 10);
}

/** Mes 0..11 de un `YYYY-MM-DD`, leyendo los caracteres y no un `Date`. */
export function monthOf(value: string): number {
  return Number(dateKey(value).slice(5, 7)) - 1;
}

/** Día del mes de un `YYYY-MM-DD`, sin ceros a la izquierda. */
export function dayOf(value: string): number {
  return Number(dateKey(value).slice(8, 10));
}
