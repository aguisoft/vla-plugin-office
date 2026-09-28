import type { Excepciones, FilaEquipo, Variacion } from '../types';
import { isoDate } from '../calendar';
import { fmtDateOnly, fmtDuration } from '../format';

/**
 * Tabla del equipo: una fila por persona a cargo (más el propio jefe), con
 * su tiempo del período, cómo se compara contra su propia norma, y cuándo
 * se le vio por última vez.
 *
 * Existe para un problema concreto: en producción 9 de 22 personas activas
 * no marcan entrada en Bitrix. La versión anterior de esta pantalla las
 * mostraba con "0m" y "Sin tiempo registrado en este período", y un gerente
 * lee eso como "no trabajó". Acá `estado` tiene TRES valores y cada uno se
 * ve distinto -- ver `CeldaEstado` -- para que "no marcó" (un hecho sobre la
 * persona) nunca se confunda con "no se pudo leer la base" (un hecho sobre
 * el sistema).
 *
 * Recibe `filas`/`excepciones` ya cargados -- no hace su propio fetch. Quien
 * llama (`TimesheetScreen`) es dueño del `AbortController` y del período,
 * igual que ya hacía con el detalle individual.
 */

/** Ícono de aviso, monocromo vía `currentColor` para heredar el color del texto. */
function IconoAviso({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`h-3.5 w-3.5 flex-shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.947-3.374L13.949 4.75c-.866-1.5-3.032-1.5-3.898 0L2.697 16.5zM12 15.75h.007v.008H12v-.008z"
      />
    </svg>
  );
}

/** Hoy como `YYYY-MM-DD` local -- mismo patrón que el resto del plugin, nunca `toISOString()`. */
function hoyLocal(): string {
  const d = new Date();
  return isoDate(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * "hoy" / "ayer" / "hace N días" / "nunca", a partir de una fecha
 * `YYYY-MM-DD` local (la misma forma en la que el backend entrega
 * `ultimoRegistro`, ver `localDateString`). Se comparan las dos fechas
 * ancladas al mediodía UTC -- mismo truco que `esDiaHabil` en
 * `lib/team-stats.ts` -- para que ningún desplazamiento de zona horaria
 * cambie el día calculado.
 */
function ultimoRelativo(fecha: string | null): string {
  if (!fecha) return 'nunca';
  const hoyIso = hoyLocal();
  if (fecha === hoyIso) return 'hoy';
  const dias = Math.round(
    (new Date(`${hoyIso}T12:00:00Z`).getTime() - new Date(`${fecha}T12:00:00Z`).getTime()) / 86_400_000,
  );
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  return `hace ${dias} días`;
}

/**
 * Celda de "Período": los tres valores de `estado` se ven distinto a
 * propósito.
 *
 * `sin-registrar` y `no-disponible` NUNCA muestran `0m` -- ese es justo el
 * defecto que esta tabla existe para corregir. Y no pueden verse igual entre
 * sí: uno es un hecho sobre la persona, el otro sobre el sistema, y
 * confundirlos le atribuye a alguien una conducta que no tuvo.
 */
function CeldaEstado({ fila }: { fila: FilaEquipo }) {
  if (fila.estado === 'con-registro') {
    return <span className="text-xs font-semibold tabular-nums text-gray-800">{fmtDuration(fila.totalMinutes)}</span>;
  }
  if (fila.estado === 'sin-registrar') {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500">
          <IconoAviso className="text-gray-400" />
          sin registrar
        </span>
        <span className="text-[10px] leading-tight text-gray-400">no marcó entrada — no es cero</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-amber-700">no disponible</span>
      <span className="text-[10px] leading-tight text-amber-600">
        no se pudo leer el registro — no es un dato sobre esta persona
      </span>
    </div>
  );
}

/**
 * Celda de "vs. su promedio". Flecha y color solo si `destacar` es `true` --
 * si todo se señala, nada se lee.
 */
function CeldaVariacion({ v }: { v: Variacion }) {
  if (v.tipo === 'sin-base') {
    return <span className="text-xs text-gray-400">sin base</span>;
  }
  const texto = `${v.pct >= 0 ? '+' : '−'}${Math.abs(v.pct)}%`;
  if (!v.destacar) {
    return <span className="text-xs tabular-nums text-gray-600">{texto}</span>;
  }
  const positivo = v.pct > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums ${
        positivo ? 'text-emerald-600' : 'text-red-600'
      }`}
    >
      {positivo ? '↑' : '↓'} {texto}
    </span>
  );
}

const ENCABEZADOS = ['Persona', 'Período', 'vs. su promedio', 'Días', 'Entrada habitual', 'Último'];

export function TeamTable({ filas, excepciones, onSelect }: {
  filas: FilaEquipo[];
  excepciones: Excepciones;
  onSelect: (userId: string) => void;
}) {
  const hayExcepciones = excepciones.sinMarcar30Dias.length > 0 || excepciones.sesionesAbiertas.length > 0;

  return (
    <div className="space-y-4">
      {/* Franja de excepciones: solo si hay algo que contar. Mismo patrón
          ámbar que ya usa el resto del plugin (ver TimesheetScreen). */}
      {hayExcepciones && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          {excepciones.sinMarcar30Dias.length > 0 && (
            <p className="text-[11px] leading-relaxed text-amber-800">
              <strong>{excepciones.sinMarcar30Dias.length}</strong>{' '}
              {excepciones.sinMarcar30Dias.length === 1 ? 'persona' : 'personas'} sin marcar en los últimos 30 días:{' '}
              {excepciones.sinMarcar30Dias.map(p => p.nombre).join(', ')}.
            </p>
          )}
          {excepciones.sesionesAbiertas.length > 0 && (
            <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
              <strong>{excepciones.sesionesAbiertas.length}</strong>{' '}
              {excepciones.sesionesAbiertas.length === 1 ? 'sesión abierta' : 'sesiones abiertas'} sin marcar salida:{' '}
              {excepciones.sesionesAbiertas.map(s => `${s.nombre} desde ${fmtDateOnly(s.desde)}`).join(', ')}.
            </p>
          )}
        </div>
      )}

      {/* Scroll horizontal propio: seis columnas no entran en un teléfono y
          la página entera no debe desplazarse de lado. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[760px] border-collapse">
          <thead>
            <tr className="border-b border-gray-200">
              {ENCABEZADOS.map(h => (
                <th
                  key={h}
                  scope="col"
                  className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map(fila => {
              // Los tres últimos requisitos numéricos (Requisito 2) se anulan
              // a propósito fuera de `con-registro`: la norma y "Días" del
              // período actual son cero por la misma razón que el total --
              // mostrar ese cero calculado sería el mismo defecto de "0m"
              // trasladado a otra columna.
              const conDatosDelPeriodo = fila.estado === 'con-registro';
              return (
                <tr
                  key={fila.userId}
                  onClick={() => onSelect(fila.userId)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(fila.userId); } }}
                  className="cursor-pointer border-b border-gray-50 align-top hover:bg-gray-50"
                >
                  <td className="px-2 py-2">
                    <p className="truncate text-xs font-medium text-gray-700">
                      {fila.firstName} {fila.lastName}
                    </p>
                    <p className="truncate text-[10px] text-gray-400">{fila.email}</p>
                  </td>
                  <td className="px-2 py-2">
                    <CeldaEstado fila={fila} />
                  </td>
                  <td className="px-2 py-2">
                    {conDatosDelPeriodo ? <CeldaVariacion v={fila.variacion} /> : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="px-2 py-2">
                    <span className="text-xs tabular-nums text-gray-600">
                      {conDatosDelPeriodo ? `${fila.diasConRegistro}/${fila.diasHabiles}` : '—'}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <span className="text-xs tabular-nums text-gray-600">
                      {conDatosDelPeriodo ? (fila.entradaHabitual ?? '—') : '—'}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <span className="text-xs text-gray-600">
                      {/* `no-disponible` es un fallo total de la consulta -- ni
                          siquiera "última vez visto" es un dato confiable acá,
                          así que también se anula. `sin-registrar` sí conserva
                          su valor real: la consulta funcionó, y puede que la
                          persona haya marcado en un período anterior aunque no
                          en este. */}
                      {fila.estado === 'no-disponible' ? '—' : ultimoRelativo(fila.ultimoRegistro)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
