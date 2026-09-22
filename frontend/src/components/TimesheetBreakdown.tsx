import { cfgOf } from '../statusConfig';
import type { StatusSlice } from '../types';

/**
 * Desglose por estado del tiempo en oficina: barra apilada horizontal más
 * leyenda con porcentajes. Los colores salen de `STATUS_CFG` para que un
 * Concentrado se vea igual acá que en el mapa -- una sola fuente de verdad
 * para el color de cada estado.
 *
 * El tramo "Sin registrar" no es decorativo: `slices` + `unaccountedMinutes`
 * siempre suma `totalMinutes` (invariante del backend), así que ese tramo es
 * la diferencia real entre el tiempo conectado y lo que el historial de
 * estados alcanzó a capturar. Si crece, es señal de que el registro está
 * perdiendo escrituras -- por eso se muestra en vez de absorberlo en un
 * redondeo.
 */
const SIN_REGISTRAR = '#e5e7eb';

export function TimesheetBreakdown({ slices, unaccountedMinutes, totalMinutes }: {
  slices: StatusSlice[];
  unaccountedMinutes: number;
  totalMinutes: number;
}) {
  if (totalMinutes <= 0) {
    return <p className="py-6 text-center text-xs text-gray-400">Sin tiempo conectado en este período.</p>;
  }

  const tramos = [
    ...slices.map(s => ({ label: cfgOf(s.status).label, color: cfgOf(s.status).color, minutes: s.minutes })),
    ...(unaccountedMinutes > 0
      ? [{ label: 'Sin registrar', color: SIN_REGISTRAR, minutes: unaccountedMinutes }]
      : []),
  ];

  const pct = (m: number) => (m / totalMinutes) * 100;

  return (
    <div>
      <div className="flex h-6 w-full overflow-hidden rounded-xl">
        {tramos.map(t => (
          <div
            key={t.label}
            style={{ width: `${pct(t.minutes)}%`, backgroundColor: t.color }}
            title={`${t.label}: ${Math.round(pct(t.minutes))}%`}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1">
        {tramos.map(t => (
          <li key={t.label} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ backgroundColor: t.color }} />
            <span className="flex-1 text-gray-600">{t.label}</span>
            <span className="tabular-nums text-gray-500">{Math.round(pct(t.minutes))}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
