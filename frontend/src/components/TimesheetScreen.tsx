import { useEffect, useState } from 'react';
import { getTimesheetScope, getOfficeTime, ApiError } from '../api';
import type { TimesheetScope, TimesheetOfficeResponse } from '../types';
import { isoDate } from '../calendar';
import { fmtDateOnly } from '../format';
import { PeriodPicker } from './PeriodPicker';
import type { Period } from './PeriodPicker';

/**
 * Pantalla de tiempos: cuánto estuvo cada quien en la oficina, por día,
 * semana o mes.
 *
 * No es un modal -- reemplaza al mapa dentro del mismo `PluginShell` (ver
 * `App.tsx`). Es un reporte que se consulta y se comparte por URL
 * (`?view=tiempos`), no un diálogo que se cierra sobre otra pantalla; por
 * eso no lleva overlay ni backdrop, solo la tarjeta blanca de siempre.
 */

/** `Xh Ym`, sin la parte en cero: "45m", "2h", "2h 15m". */
function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Hoy como `YYYY-MM-DD` local -- mismo patrón que `isoDate`, nunca `toISOString()`. */
function hoy(): string {
  const d = new Date();
  return isoDate(d.getFullYear(), d.getMonth(), d.getDate());
}

function errorMessage(e: unknown, fallback: string): string {
  const detail = e instanceof ApiError ? (e.detail as { message?: string } | undefined) : undefined;
  return detail?.message ?? fallback;
}

export function TimesheetScreen({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState(hoy());
  const [scope, setScope] = useState<TimesheetScope | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [data, setData] = useState<TimesheetOfficeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Alcance primero: hasta no saber quién soy y a quién puedo ver, no hay
  // `userId` válido para pedir el reporte.
  useEffect(() => {
    getTimesheetScope()
      .then(s => { setScope(s); setUserId(s.viewerId); })
      .catch(e => {
        setError(errorMessage(e, 'No se pudo cargar el alcance'));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    getOfficeTime(period, anchor, userId)
      .then(setData)
      .catch(e => {
        setData(null);
        setError(errorMessage(e, 'No se pudo cargar el tiempo en oficina'));
      })
      .finally(() => setLoading(false));
  }, [period, anchor, userId]);

  const persona = scope?.users.find(u => u.id === userId);
  // Con una sola persona en el alcance (el caso normal: nadie a cargo) el
  // selector no aporta nada, solo confirma quién es.
  const soloUno = (scope?.users.length ?? 0) <= 1;

  const byDay = data?.office.byDay ?? [];
  const maxMinutes = Math.max(1, ...byDay.map(d => d.minutes));
  // `data` queda en null tanto si todavía no llegó la respuesta como si la
  // última llamada falló (403 fuera de alcance, etc.) -- sin `!error` acá,
  // un error se leía como "0m / sin tiempo registrado", que es la lectura
  // falsa que la spec quería evitar con el 403 en primer lugar.
  const sinDatos = !loading && !error && (data?.office.totalMinutes ?? 0) === 0;

  return (
    <div className="h-full overflow-y-auto p-3 md:p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-sm">
        {/* Encabezado */}
        <div className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-4 md:px-6">
          <span className="text-xl">⏱️</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-gray-800">Tiempos</h2>
            <p className="text-[11px] text-gray-400">Tiempo en oficina por período.</p>
          </div>

          <PeriodPicker period={period} anchor={anchor} onChange={(p, a) => { setPeriod(p); setAnchor(a); }} />

          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Selector de persona */}
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Persona</span>
          {soloUno ? (
            <span className="text-xs font-medium text-gray-700">
              {persona ? `${persona.firstName} ${persona.lastName}` : '—'}
            </span>
          ) : (
            <select
              value={userId ?? ''}
              onChange={e => setUserId(e.target.value)}
              aria-label="Persona"
              className="rounded-xl border border-gray-200 bg-white px-2 py-1 text-xs focus:border-gray-400 focus:outline-none"
            >
              {scope?.users.map(u => (
                <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
              ))}
            </select>
          )}
        </div>

        {error && (
          <div className="mx-4 mt-3 flex-shrink-0 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600 md:mx-6">
            {error}
          </div>
        )}

        {/* Contenido */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
          {loading ? (
            <p className="py-12 text-center text-xs text-gray-400">Cargando…</p>
          ) : error ? null : (
            // Con error ya no hay nada más que mostrar acá -- el banner rojo
            // de arriba es todo el feedback. Ni números ni un vacío que se
            // pueda confundir con "no marcó horas".
            <div className="rounded-2xl border border-gray-100 p-4">
              <div className="mb-4 flex items-baseline justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Tiempo en oficina
                </p>
                <p className="text-lg font-bold text-gray-800">{hhmm(data?.office.totalMinutes ?? 0)}</p>
              </div>

              {sinDatos ? (
                <p className="py-8 text-center text-xs text-gray-400">
                  Sin tiempo registrado en este período.
                </p>
              ) : (
                <div className="space-y-2">
                  {byDay.map(d => (
                    <div key={d.date} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                      <span className="flex-shrink-0 text-[10px] text-gray-500 sm:w-24">
                        {fmtDateOnly(d.date)}
                      </span>
                      <div className="h-2 min-w-0 flex-1 rounded-full bg-gray-100">
                        <div
                          className="h-2 rounded-full bg-emerald-400"
                          style={{ width: `${Math.round((d.minutes / maxMinutes) * 100)}%` }}
                        />
                      </div>
                      <span className="flex-shrink-0 text-[10px] font-medium text-gray-600 sm:w-12 sm:text-right">
                        {hhmm(d.minutes)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
