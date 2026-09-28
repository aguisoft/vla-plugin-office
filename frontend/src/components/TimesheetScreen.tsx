import { useEffect, useState } from 'react';
import { getTimesheetScope, getOfficeTime, getTimesheetTeam, ApiError } from '../api';
import type { TimesheetScope, TimesheetOfficeResponse, TimesheetTeamResponse } from '../types';
import { fmtDateOnly, fmtDuration as hhmm, hoyLocal as hoy } from '../format';
import { PeriodPicker } from './PeriodPicker';
import type { Period } from './PeriodPicker';
import { TimesheetBreakdown } from './TimesheetBreakdown';
import { TeamTable } from './TeamTable';
import { CoverageMap } from './CoverageMap';
import { cfgOf } from '../statusConfig';

/**
 * Pantalla de tiempos: cuánto estuvo cada quien en la oficina, por día,
 * semana o mes.
 *
 * No es un modal -- reemplaza al mapa dentro del mismo `PluginShell` (ver
 * `App.tsx`). Es un reporte que se consulta y se comparte por URL
 * (`?view=tiempos`), no un diálogo que se cierra sobre otra pantalla; por
 * eso no lleva overlay ni backdrop, solo la tarjeta blanca de siempre.
 */

function errorMessage(e: unknown, fallback: string): string {
  const detail = e instanceof ApiError ? (e.detail as { message?: string } | undefined) : undefined;
  return detail?.message ?? fallback;
}

/**
 * Un `fetch` abortado rechaza con un `AbortError`. No es un fallo que mostrar:
 * la cancelación la pidió la propia pantalla al cambiar de persona o período.
 *
 * Se mira solo el `name`, sin `instanceof Error`: lo que se lanza es un
 * `DOMException`, y que herede de `Error` no es universal (Safari viejo). Donde
 * no hereda, el `instanceof` dejaba pasar la cancelación como fallo y devolvía
 * el parpadeo de «no se pudo cargar» que este filtro vino a quitar.
 */
function esCancelacion(e: unknown): boolean {
  return (e as any)?.name === 'AbortError';
}

export function TimesheetScreen({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState(hoy());
  const [scope, setScope] = useState<TimesheetScope | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [data, setData] = useState<TimesheetOfficeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Con más de una persona en el alcance, la pantalla abre en la tabla del
  // equipo (`'equipo'`) y no en el detalle de nadie en particular -- clic en
  // una fila es lo que manda a `'detalle'`. Con una sola persona (el caso
  // normal: nadie a cargo) esta variable ni se consulta -- ver `soloUno`.
  const [vista, setVista] = useState<'equipo' | 'detalle'>('equipo');
  const [teamData, setTeamData] = useState<TimesheetTeamResponse | null>(null);
  const [teamLoading, setTeamLoading] = useState(true);
  const [teamError, setTeamError] = useState<string | null>(null);

  // Alcance primero: hasta no saber quién soy y a quién puedo ver, no hay
  // `userId` válido para pedir el reporte de detalle. Con una sola persona en
  // el alcance no hay tabla que mostrar -- se fija el `userId` de una vez,
  // igual que antes de esta tarea. Con más de una, `userId` queda en `null`
  // hasta que se elige una fila; así el efecto de detalle no dispara una
  // carga que nadie pidió todavía.
  useEffect(() => {
    getTimesheetScope()
      .then(s => {
        setScope(s);
        if (s.users.length <= 1) setUserId(s.viewerId);
      })
      .catch(e => {
        setError(errorMessage(e, 'No se pudo cargar el alcance'));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!userId) return;
    // Sin cancelar, cambiar de persona con una respuesta en vuelo puede pintar
    // el tiempo de A bajo el nombre de B.
    const ctrl = new AbortController();
    // `vivo` cubre lo que el `abort()` ya no alcanza: si la respuesta se
    // resolvió justo antes de la limpieza, el `.then` quedó encolado y
    // abortar no lo cancela -- escribiría los datos de A cuando la pantalla
    // ya está mostrando a B.
    let vivo = true;
    setLoading(true);
    setError(null);
    getOfficeTime(period, anchor, userId, ctrl.signal)
      .then(d => { if (!vivo) return; setData(d); setLoading(false); })
      .catch(e => {
        // Un AbortError no es un error que mostrar: es una cancelación
        // esperada. `loading` tampoco se toca -- la llamada que disparó la
        // cancelación ya lo dejó en `true`, y apagarlo acá haría parpadear
        // "no se pudo cargar" cada vez que alguien cambia de persona.
        if (!vivo || esCancelacion(e)) return;
        setData(null);
        setError(errorMessage(e, 'No se pudo cargar el tiempo en oficina'));
        setLoading(false);
      });
    return () => { vivo = false; ctrl.abort(); };
  }, [period, anchor, userId]);

  // Con una sola persona en el alcance (el caso normal: nadie a cargo) el
  // selector no aporta nada, solo confirma quién es.
  const soloUno = (scope?.users.length ?? 0) <= 1;

  // Carga de la tabla del equipo, no del detalle -- mismo patrón de
  // `AbortController` que el efecto de arriba (comentarios completos allá).
  // Se dispara en cuanto se conoce el alcance y hay más de una persona, sin
  // esperar a que `vista` sea `'equipo'`: así volver de un detalle con
  // «← Volver al equipo» no encuentra la tabla en blanco mientras recarga.
  useEffect(() => {
    if (!scope || soloUno) return;
    const ctrl = new AbortController();
    let vivo = true;
    setTeamLoading(true);
    setTeamError(null);
    getTimesheetTeam(period, anchor, ctrl.signal)
      .then(d => { if (!vivo) return; setTeamData(d); setTeamLoading(false); })
      .catch(e => {
        if (!vivo || esCancelacion(e)) return;
        setTeamData(null);
        setTeamError(errorMessage(e, 'No se pudo cargar el equipo'));
        setTeamLoading(false);
      });
    return () => { vivo = false; ctrl.abort(); };
  }, [period, anchor, scope, soloUno]);

  const persona = scope?.users.find(u => u.id === userId);
  const mostrarEquipo = !soloUno && vista === 'equipo';

  // `setLoading(true)` y `setData(null)` acá, de forma síncrona, y no solo
  // dentro del efecto de detalle: el efecto corre DESPUÉS del pintado, así
  // que ir de un detalle a otro (tabla -> Pedro -> «Volver al equipo» ->
  // María) deja `loading` en `false` y `data` todavía con lo de Pedro justo
  // en el frame donde React ya pintó el encabezado de María. El resultado es
  // un frame real con el nombre de una persona y los números de otra. El
  // primer clic desde la tabla se salva solo porque `loading` arranca en
  // `true`; cualquier cambio de detalle a detalle sin esto lo reproduce. El
  // selector de persona que existía antes de esta tarea ya tenía este mismo
  // fix (commit `ce169fb`, 22-sep) -- se perdió al retirarlo y se repone acá.
  const irADetalle = (id: string) => {
    setLoading(true);
    setData(null);
    setUserId(id);
    setVista('detalle');
  };
  const volverAlEquipo = () => { setVista('equipo'); };

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

        {/*
          Selector de persona / navegación de vuelta al equipo.

          En vista `'equipo'` esta fila no se renderiza: la tabla ya nombra
          "Persona" en su propio encabezado (Requisito 1), repetirlo acá sería
          ruido. Solo aparece con una sola persona en el alcance (nunca hubo
          tabla que mostrar) o en el detalle de alguien elegido desde la
          tabla, con el botón para volver.
        */}
        {(soloUno || vista === 'detalle') && (
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
            {soloUno ? (
              <>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Persona</span>
                <span className="text-xs font-medium text-gray-700">
                  {persona ? `${persona.firstName} ${persona.lastName}` : '—'}
                </span>
              </>
            ) : (
              <>
                <button
                  onClick={volverAlEquipo}
                  className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
                >
                  ← Volver al equipo
                </button>
                <span className="text-xs font-medium text-gray-700">
                  {persona ? `· ${persona.firstName} ${persona.lastName}` : ''}
                </span>
              </>
            )}
          </div>
        )}

        {!mostrarEquipo && error && (
          <div className="mx-4 mt-3 flex-shrink-0 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600 md:mx-6">
            {error}
          </div>
        )}

        {mostrarEquipo && teamError && (
          <div className="mx-4 mt-3 flex-shrink-0 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600 md:mx-6">
            {teamError}
          </div>
        )}

        {/* Contenido */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
          {mostrarEquipo ? (
            teamLoading ? (
              <p className="py-12 text-center text-xs text-gray-400">Cargando…</p>
            ) : teamError ? null : (
              <div className="space-y-4">
                <TeamTable
                  filas={teamData?.filas ?? []}
                  excepciones={teamData?.excepciones ?? { sinMarcar30Dias: [], sesionesAbiertas: [] }}
                  onSelect={irADetalle}
                />
                {/* Debajo de la tabla: la tabla responde "¿cuánto trabajó
                    cada quien?", el mapa responde "¿a qué hora hay gente?" --
                    ninguna suma de la tabla contesta eso. Se omite sola si
                    `cobertura.fechas` viene vacío (ver CoverageMap). */}
                {teamData && <CoverageMap matriz={teamData.cobertura} />}
              </div>
            )
          ) : loading ? (
            <p className="py-12 text-center text-xs text-gray-400">Cargando…</p>
          ) : error ? null : (
            // Con error ya no hay nada más que mostrar acá -- el banner rojo
            // de arriba es todo el feedback. Ni números ni un vacío que se
            // pueda confundir con "no marcó horas".
            <div className="space-y-4">
              {/* Aviso de cobertura: durante las primeras semanas casi toda
                  consulta cae parcial o totalmente antes de `coverageStart`,
                  y el tiempo en oficina de abajo sí trae números en ese mismo
                  período -- sin este aviso, un desglose vacío al lado de
                  horas reales se lee como "no hizo nada". */}
              {data?.coverageStart && data.from.slice(0, 10) < data.coverageStart && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <p className="text-[11px] leading-relaxed text-amber-800">
                    El desglose por estado empezó a registrarse el <strong>{fmtDateOnly(data.coverageStart)}</strong>.
                    Antes de esa fecha solo hay tiempo en oficina — un desglose vacío acá no significa
                    que no se trabajó.
                  </p>
                </div>
              )}

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

                {/* La sesión sin marcar salida se acota en el backend (ver
                    capOpenSession): a quien entra de vacaciones nadie se la
                    cierra. Se avisa porque acotar en silencio cambia el número
                    sin que nadie sepa por qué. */}
                {data?.office.openSessionCapped && (
                  <p className="mt-3 text-[10px] text-gray-400">
                    Una sesión quedó abierta sin marcar salida; se acotó a {data.office.openSessionCapHours} horas.
                  </p>
                )}

                {/* Los feriados no se calculan en esta versión (ver comentario
                    de tallyAbsences en lib/timesheet.ts): effectiveByUserId
                    resuelve un instante, no un rango. El aviso vive acá y no en
                    la tarjeta de Ausencias porque los feriados son universales
                    y las ausencias escasas: allá se escondía justo en el caso
                    mayoritario, y lo que califica es este total. */}
                <p className="mt-3 text-[10px] text-gray-400">
                  Los feriados no se descuentan de este total: un período con feriado muestra menos horas.
                </p>
              </div>

              {/* El propio componente resuelve el caso `totalMinutes <= 0`
                  con su mensaje "Sin tiempo conectado" -- no hace falta
                  duplicar esa condición acá. */}
              <div className="rounded-2xl border border-gray-100 p-4">
                <p className="mb-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Desglose por estado
                </p>
                {/* No se pudo leer la tabla de intervalos. Se avisa en vez de
                    dibujar el gráfico: con `breakdown: []` el reconcile manda
                    todo a "sin registrar" y la pantalla acusaría al plugin (o
                    a la persona) de un fallo de infraestructura. */}
                {data?.breakdownUnavailable ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <p className="text-[11px] leading-relaxed text-amber-800">
                      El desglose por estado no está disponible en este momento.
                    </p>
                  </div>
                ) : (
                  <>
                    <TimesheetBreakdown
                      slices={data?.breakdown ?? []}
                      unaccountedMinutes={data?.unaccountedMinutes ?? 0}
                      totalMinutes={data?.office.totalMinutes ?? 0}
                    />
                    {/* Los estados sumaban más que el tiempo conectado. El
                        reescalado del backend cierra el gráfico, pero callarlo
                        presentaba una inconsistencia entre las dos fuentes
                        como reconciliación perfecta.

                        Va FUERA de `TimesheetBreakdown` a propósito: con el
                        tiempo conectado en 0 ese componente se reemplaza por
                        «Sin tiempo conectado» y el aviso quedaría escondido
                        justo en el caso que más lo necesita — intervalos de
                        estado sin `CheckInRecord` que los respalde, donde este
                        número es la única señal de que el dato existe. No lo
                        metas adentro. */}
                    {(data?.overflowMinutes ?? 0) > 0 && (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                        <p className="text-[11px] leading-relaxed text-amber-800">
                          {(data?.office.totalMinutes ?? 0) > 0 ? (
                            <>
                              Los estados suman <strong>{hhmm(data!.overflowMinutes!)}</strong> más que el
                              tiempo conectado; se ajustaron proporcionalmente.
                            </>
                          ) : (
                            <>
                              Hay <strong>{hhmm(data!.overflowMinutes!)}</strong> de estados registrados sin
                              ninguna sesión de oficina que los respalde. El desglose queda en cero porque el
                              tiempo conectado es la fuente del total — pero el registro existe.
                            </>
                          )}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Ausencias: no salen del desglose de arriba -- no viven en
                  PresenceStatus, el snapshot las calcula al vuelo, así que el
                  backend las trae de su propia fuente (AbsenceService). Sin
                  ninguna en el período, la tarjeta no se renderiza: no hay
                  nada que reportar. */}
              {(data?.absences.length ?? 0) > 0 && (
                <div className="rounded-2xl border border-gray-100 p-4">
                  <p className="mb-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    Ausencias
                  </p>
                  <ul className="space-y-2">
                    {data!.absences.map(a => {
                      const cfg = cfgOf(a.type);
                      // Las de día completo (VACACIONES/INCAPACIDAD) muestran
                      // días y horas equivalentes; PERMISO viaja con hora real,
                      // así que solo tiene sentido mostrar su duración -- un
                      // permiso de 2h no es "0 días".
                      const detalle = a.days > 0
                        ? `${a.days} día${a.days === 1 ? '' : 's'} · ${hhmm(a.minutes)}`
                        : hhmm(a.minutes);
                      return (
                        <li key={a.type} className="flex items-center gap-2 text-xs">
                          <span className="text-sm">{cfg.icon}</span>
                          <span className="flex-1 text-gray-600">{cfg.label}</span>
                          <span className="flex-shrink-0 font-medium tabular-nums text-gray-700">
                            {detalle}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
