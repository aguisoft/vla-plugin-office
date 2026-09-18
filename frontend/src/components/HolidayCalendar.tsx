import { useMemo } from 'react';
import { isoDate, daysInMonth, leadingBlanks, isWeekend, dateKey } from '../calendar';
import type { Holiday } from '../types';

/**
 * Calendario anual de 12 meses con los feriados marcados. Un click en un día
 * lo propone como fecha del nuevo feriado.
 *
 * Reemplaza al formulario de fecha suelta del panel anterior: cargar un
 * calendario de 12 feriados eran 12 rondas de tipear una fecha en un
 * `<input type="date">`, sin ver nunca el año completo ni notar que dos
 * quedaron el mismo día o que uno cayó domingo.
 *
 * **Fechas sin UTC.** Toda la aritmética vive en `../calendar`, que está
 * cubierto por pruebas: ni `toISOString()` ni `new Date(iso)` aparecen en
 * ninguno de los dos archivos. `Holiday.date` es una columna `@db.Date` que
 * Prisma serializa como medianoche UTC, así que leerla con `new Date()` en
 * UTC−6 daría el día anterior.
 */

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** Lunes primero, como los calendarios de acá. */
const DIAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export function HolidayCalendar({ year, holidays, selectedDate, onPickDate }: {
  year: number;
  /** Ya filtrados por el país que se está editando. */
  holidays: Holiday[];
  selectedDate: string | null;
  onPickDate: (iso: string) => void;
}) {
  // fecha → feriados de ese día. Es una lista y no un único valor porque nada
  // impide cargar dos feriados el mismo día para el mismo país (el índice
  // único es (date, country), así que no puede haber dos iguales, pero sí
  // puede haber uno movido con override y el original).
  const byDate = useMemo(() => {
    const m = new Map<string, Holiday[]>();
    for (const h of holidays) {
      const key = dateKey(h.date);
      const list = m.get(key);
      if (list) list.push(h); else m.set(key, [h]);
    }
    return m;
  }, [holidays]);

  const hoy = new Date();
  const hoyIso = isoDate(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {MESES.map((nombre, mes) => (
        <Mes
          key={mes}
          nombre={nombre}
          year={year}
          mes={mes}
          byDate={byDate}
          hoyIso={hoyIso}
          selectedDate={selectedDate}
          onPickDate={onPickDate}
        />
      ))}
    </div>
  );
}

function Mes({ nombre, year, mes, byDate, hoyIso, selectedDate, onPickDate }: {
  nombre: string;
  year: number;
  mes: number;
  byDate: Map<string, Holiday[]>;
  hoyIso: string;
  selectedDate: string | null;
  onPickDate: (iso: string) => void;
}) {
  const diasEnMes = daysInMonth(year, mes);
  const offset = leadingBlanks(year, mes);

  // Cuántos feriados tiene el mes, para el contador del encabezado.
  let delMes = 0;
  for (let d = 1; d <= diasEnMes; d++) {
    if (byDate.has(isoDate(year, mes, d))) delMes++;
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-3 transition-shadow hover:shadow-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <h4 className="text-xs font-bold text-gray-700">{nombre}</h4>
        {delMes > 0 && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
            {delMes}
          </span>
        )}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {DIAS.map((d, i) => (
          <div key={i} className="pb-1 text-center text-[9px] font-semibold uppercase text-gray-300">
            {d}
          </div>
        ))}

        {Array.from({ length: offset }, (_, i) => <div key={`v${i}`} />)}

        {Array.from({ length: diasEnMes }, (_, i) => {
          const dia = i + 1;
          const iso = isoDate(year, mes, dia);
          const feriados = byDate.get(iso);
          const esFeriado = !!feriados?.length;
          const esHoy = iso === hoyIso;
          const elegido = iso === selectedDate;
          const finDeSemana = isWeekend(year, mes, dia);

          return (
            <button
              key={dia}
              onClick={() => onPickDate(iso)}
              title={esFeriado ? feriados!.map(f => f.name).join(' · ') : `Agregar feriado el ${dia} de ${nombre}`}
              aria-label={esFeriado ? `${dia} de ${nombre}: ${feriados!.map(f => f.name).join(', ')}` : `${dia} de ${nombre}`}
              aria-pressed={elegido}
              className={[
                'relative aspect-square rounded-md text-[10px] font-medium transition-colors',
                esFeriado
                  ? 'bg-amber-300 text-amber-900 hover:bg-amber-400'
                  : finDeSemana
                    ? 'text-gray-300 hover:bg-gray-100'
                    : 'text-gray-600 hover:bg-gray-100',
                elegido ? 'ring-2 ring-gray-800' : '',
                esHoy && !esFeriado ? 'font-bold text-gray-900 underline decoration-2' : '',
              ].join(' ')}
            >
              {dia}
            </button>
          );
        })}
      </div>
    </div>
  );
}
