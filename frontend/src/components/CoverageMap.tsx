import type { Matriz } from '../types';

/**
 * Mapa de cobertura horaria del equipo: quién está conectado a qué hora,
 * fecha por fecha.
 *
 * Ningún total contesta «¿puedo agendar algo a las 3?» ni «¿quién abre la
 * mañana?». Un equipo donde los cuatro se conectan a las 11 tiene las 8am
 * descubiertas y eso no se ve en ninguna suma -- esa es la razón de ser de
 * este mapa. Las celdas salen ya armadas de `coverageMatrix` en el backend
 * (`lib/coverage.ts`); acá solo se dibujan.
 *
 * Cero personas en una celda DENTRO del rango horario (`horaMin`..`horaMax`)
 * se pinta como un punto gris (`·`); una hora fuera de ese rango ni siquiera
 * es una columna de la tabla. Las dos cosas no pueden verse igual -- un cero
 * real ("nadie estaba conectado a esa hora") no es lo mismo que "esta hora
 * no entra en el rango que el mapa mide".
 */

const DIA_FMT = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric' });

/**
 * Encabezado de fila, p. ej. "lun 21". Reconstruye el `Date` sin `Z`
 * (medianoche LOCAL) a partir de `YYYY-MM-DD` -- nunca `toISOString()`, mismo
 * patrón que `fmtDateOnly` en `format.ts` -- para que la fecha no se corra un
 * día en zonas al oeste de UTC.
 */
function diaAbreviado(fecha: string): string {
  return DIA_FMT.format(new Date(`${fecha}T00:00:00`));
}

export function CoverageMap({ matriz }: { matriz: Matriz }) {
  // Sin fechas no hay nada que dibujar: nadie tuvo sesiones en el período.
  if (matriz.fechas.length === 0) return null;

  const horas: number[] = [];
  for (let h = matriz.horaMin; h <= matriz.horaMax; h++) horas.push(h);

  const porCelda = new Map<string, number>();
  for (const c of matriz.celdas) porCelda.set(`${c.fecha}|${c.hora}`, c.personas);

  const maximo = Math.max(1, ...matriz.celdas.map(c => c.personas));

  return (
    <div className="rounded-2xl border border-gray-100 p-4">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        Cobertura horaria
      </p>
      <p className="mb-3 text-[11px] text-gray-400">
        Cuánta gente del equipo estaba conectada en cada hora.
      </p>

      {/* Scroll horizontal propio: con varias fechas y varias horas la
          cuadrícula no entra en un teléfono, y la página entera no debe
          desplazarse de lado. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="border-collapse text-[10px]">
          <thead>
            <tr>
              <th scope="col" className="px-1 py-1 text-left" />
              {horas.map(h => (
                <th
                  key={h}
                  scope="col"
                  className="px-1 py-1 text-center font-medium text-gray-400"
                >
                  {h}h
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matriz.fechas.map(fecha => (
              <tr key={fecha}>
                <th
                  scope="row"
                  className="whitespace-nowrap px-1 py-1 text-left font-medium text-gray-500"
                >
                  {diaAbreviado(fecha)}
                </th>
                {horas.map(h => {
                  const personas = porCelda.get(`${fecha}|${h}`) ?? 0;
                  const intensidad = personas / maximo;
                  return (
                    <td key={h} className="p-0.5">
                      {personas === 0 ? (
                        // Punto gris: cero personas DENTRO del rango medido,
                        // no ausencia de dato. Nunca un "0" numérico -- se
                        // confundiría con una celda con datos reales.
                        <div
                          className="flex h-6 w-6 items-center justify-center rounded bg-gray-50 text-gray-300"
                          aria-label={`${diaAbreviado(fecha)}, ${h}h: nadie conectado`}
                        >
                          ·
                        </div>
                      ) : (
                        <div
                          className="flex h-6 w-6 items-center justify-center rounded font-semibold tabular-nums"
                          style={{
                            backgroundColor: `rgba(16, 185, 129, ${0.18 + intensidad * 0.72})`,
                            color: intensidad > 0.55 ? '#ffffff' : '#065f46',
                          }}
                          aria-label={`${diaAbreviado(fecha)}, ${h}h: ${personas} ${personas === 1 ? 'persona' : 'personas'}`}
                        >
                          {personas}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
