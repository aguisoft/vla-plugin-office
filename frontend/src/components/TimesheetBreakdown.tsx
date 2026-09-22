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

/**
 * Key propia para el tramo "Sin registrar" -- no tiene `status` (es un
 * cálculo, no un valor de la tabla). Usar la etiqueta como key rompía con
 * estados desconocidos: `cfgOf` colapsa cualquier status no reconocido al
 * mismo fallback OFFLINE ("Desconectado"), así que dos statuses distintos
 * sin mapear producían la misma key -- warning de React y dos líneas
 * idénticas en la leyenda. El `status` real es único por tramo (el backend
 * ya agrupa `breakdown` por status en `reconcile`), así que sirve de key.
 */
const SIN_REGISTRAR_KEY = '__sin_registrar__';

export function TimesheetBreakdown({ slices, unaccountedMinutes, totalMinutes }: {
  slices: StatusSlice[];
  unaccountedMinutes: number;
  totalMinutes: number;
}) {
  if (totalMinutes <= 0) {
    return <p className="py-6 text-center text-xs text-gray-400">Sin tiempo conectado en este período.</p>;
  }

  const tramos = [
    ...slices.map(s => ({ key: s.status, label: cfgOf(s.status).label, color: cfgOf(s.status).color, minutes: s.minutes })),
    ...(unaccountedMinutes > 0
      ? [{ key: SIN_REGISTRAR_KEY, label: 'Sin registrar', color: SIN_REGISTRAR, minutes: unaccountedMinutes }]
      : []),
  ];

  const pct = (m: number) => (m / totalMinutes) * 100;

  /**
   * Porcentajes mostrados en el título del segmento y en la leyenda.
   * `Math.round` aplicado tramo por tramo no garantiza sumar 100 (tres
   * tercios dan 33+33+33=99; otras proporciones dan 101), y un admin que
   * suma las cifras lo lee como un error del reporte. Mismo criterio que ya
   * usa el backend en `reconcile` (src/lib/timesheet.ts): se redondea todo
   * menos el último tramo, y el último se calcula como el resto para que la
   * suma cierre exacta. El ancho de la barra (`style.width` abajo) no pasa
   * por acá -- usa el porcentaje crudo sin redondear, por eso nunca tuvo
   * este problema.
   */
  const pctRedondeado = tramos.map((t, i) => {
    if (i < tramos.length - 1) return Math.round(pct(t.minutes));
    const sumaAnteriores = tramos.slice(0, -1).reduce((acc, s) => acc + Math.round(pct(s.minutes)), 0);
    return 100 - sumaAnteriores;
  });

  return (
    <div>
      <div className="flex h-6 w-full overflow-hidden rounded-xl">
        {tramos.map((t, i) => (
          <div
            key={t.key}
            style={{ width: `${pct(t.minutes)}%`, backgroundColor: t.color }}
            title={`${t.label}: ${pctRedondeado[i]}%`}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1">
        {tramos.map((t, i) => (
          <li key={t.key} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ backgroundColor: t.color }} />
            <span className="flex-1 text-gray-600">{t.label}</span>
            <span className="tabular-nums text-gray-500">{pctRedondeado[i]}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
