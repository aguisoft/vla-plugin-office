import { useEffect, useMemo, useRef, useState } from 'react';
import { listHolidays, createHoliday, deleteHoliday, getOrgRoster, ApiError } from '../api';
import type { StatusError } from '../api';
import { COUNTRIES, countryOf } from '../countries';
import { monthOf, dayOf } from '../calendar';
import { fmtDateOnly, hoyLocal } from '../format';
import { feriadoVigente } from '../feriadosUx';
import { HolidayCalendar } from './HolidayCalendar';
import type { FiltroPersonas } from './PersonasAdmin';
import type { Holiday, RosterUser } from '../types';

/**
 * Pantalla de feriados: RRHH carga el calendario por país y marca a quién le
 * aplica cada uno.
 *
 * Reemplaza a `HolidayAdminPanel`, que funcionaba pero pedía el país como
 * texto libre de dos letras y no mostraba nunca el año completo ni a cuánta
 * gente afectaba un feriado. Lo importante que agrega esta versión es el
 * **origen del país**: hoy los 35 colaboradores tienen `country = null` en
 * Bitrix, así que todos caen al default del plugin. Un calendario de feriados
 * ticos cargado sobre ese estado le aplica a los 35 — incluida la gente que
 * no está en Costa Rica — y nada en la interfaz anterior lo delataba.
 *
 * *Qué* días son feriados se carga acá; *a quién* le tocan (el país de cada
 * persona) se corrige en Personas, que es su propia pantalla desde el
 * 12-oct-2026: esa tabla también fija el jefe, el departamento y la zona, que
 * no tienen nada que ver con feriados. Acá quedan los avisos que mandan allá.
 */

const MES_NOMBRE = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function errorMessage(e: unknown, fallback: string): string {
  const detail = e instanceof ApiError ? (e.detail as StatusError | undefined) : undefined;
  return detail?.errors?.[0]?.message ?? detail?.message ?? fallback;
}

export function HolidayManager({ onClose, onAbrirPersonas }: {
  onClose: () => void;
  /** Abre Personas con un filtro (las excepciones de país se corrigen allá). */
  onAbrirPersonas: (f: FiltroPersonas) => void;
}) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [country, setCountry] = useState('CR');

  const [holidays, setHolidays] = useState<Holiday[] | null>(null);
  const [roster, setRoster] = useState<RosterUser[] | null>(null);
  const [defaultCountry, setDefaultCountry] = useState('CR');
  const [error, setError] = useState<string | null>(null);

  // Alta
  const [date, setDate] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Todos los feriados del año, de todos los países: el contador de cada
  // pestaña de país lo necesita, y son pocas filas.
  const reloadHolidays = async () => {
    try {
      setHolidays(await listHolidays(year));
    } catch (e) {
      setHolidays([]);
      setError(errorMessage(e, 'No se pudieron cargar los feriados'));
    }
  };

  const reloadRoster = async () => {
    try {
      const r = await getOrgRoster();
      setRoster(r.users);
      setDefaultCountry(r.defaultCountry);
    } catch (e) {
      setRoster([]);
      setError(errorMessage(e, 'No se pudo cargar el equipo'));
    }
  };

  useEffect(() => { void reloadHolidays(); }, [year]);
  useEffect(() => { void reloadRoster(); }, []);

  const delPais = useMemo(
    () => (holidays ?? []).filter(h => h.country.toUpperCase() === country),
    [holidays, country],
  );

  // Cuánta gente resuelve a cada país, y cuánta de esa lo tiene solo por
  // defecto. El segundo número es el que importa: mide lo que nadie verificó.
  const porPais = useMemo(() => {
    const total = new Map<string, number>();
    const porDefecto = new Map<string, number>();
    for (const u of roster ?? []) {
      const c = (u.country ?? '').toUpperCase();
      if (!c) continue;
      total.set(c, (total.get(c) ?? 0) + 1);
      if (u.countrySource === 'default') porDefecto.set(c, (porDefecto.get(c) ?? 0) + 1);
    }
    return { total, porDefecto };
  }, [roster]);

  const gente = porPais.total.get(country) ?? 0;
  const genteDefault = porPais.porDefecto.get(country) ?? 0;

  // Países a mostrar como pestaña: los del catálogo con gente o con feriados,
  // más el seleccionado, para que uno vacío recién elegido no desaparezca.
  const paisesVisibles = useMemo(() => {
    const conDatos = new Set<string>([country, defaultCountry.toUpperCase()]);
    for (const [c, n] of porPais.total) if (n > 0) conDatos.add(c);
    for (const h of holidays ?? []) conDatos.add(h.country.toUpperCase());
    return COUNTRIES.filter(c => conDatos.has(c.iso));
  }, [porPais.total, holidays, country, defaultCountry]);

  const pickDate = (iso: string) => {
    setDate(iso);
    setError(null);
    // El foco al nombre: la fecha ya la eligió con el click, lo único que
    // falta escribir es cómo se llama el feriado.
    requestAnimationFrame(() => nameRef.current?.focus());
  };

  async function handleCreate() {
    if (!date || !name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await createHoliday({ date, name: name.trim(), country });
      setName('');
      setDate(null);
      await reloadHolidays();
    } catch (e) {
      setError(errorMessage(e, 'No se pudo crear el feriado'));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await deleteHoliday(id);
      setHolidays(prev => prev?.filter(h => h.id !== id) ?? prev);
      setConfirmDelete(null);
    } catch (e) {
      setError(errorMessage(e, 'No se pudo borrar el feriado'));
      await reloadHolidays();
    }
  }

  // La lista oculta los que pasaron hace más de un mes (ya no aplican); el
  // calendario de arriba los sigue mostrando todos.
  const [verAnteriores, setVerAnteriores] = useState(false);
  const anteriores = useMemo(() => delPais.filter(h => !feriadoVigente(h.date, hoyLocal())).length, [delPais]);
  const enLista = useMemo(
    () => (verAnteriores ? delPais : delPais.filter(h => feriadoVigente(h.date, hoyLocal()))),
    [delPais, verAnteriores],
  );

  const porMes = useMemo(() => {
    const m = new Map<number, Holiday[]>();
    for (const h of enLista) {
      // monthOf lee los caracteres del string; `new Date(iso)` correría un
      // feriado de día 1 al mes anterior en UTC-6.
      const mes = monthOf(h.date);
      const list = m.get(mes);
      if (list) list.push(h); else m.set(mes, [h]);
    }
    for (const list of m.values()) list.sort((a, b) => a.date.localeCompare(b.date));
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [enLista]);

  const cfgPais = countryOf(country);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Encabezado */}
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-gray-100 px-6 py-4">
          <span className="text-xl">🎉</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-gray-800">Feriados</h2>
            <p className="text-[11px] text-gray-400">
              Calendario por país. Quien tenga el día libre aparece como Feriado en el mapa.
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
            <button
              onClick={() => setYear(y => y - 1)}
              aria-label="Año anterior"
              className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-white"
            >
              ‹
            </button>
            <span className="min-w-[3rem] text-center text-xs font-bold text-gray-700">{year}</span>
            <button
              onClick={() => setYear(y => y + 1)}
              aria-label="Año siguiente"
              className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-white"
            >
              ›
            </button>
          </div>

          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Pestañas de país */}
        <div className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-gray-100 px-6 py-2">
          {paisesVisibles.map(c => {
            const n = porPais.total.get(c.iso) ?? 0;
            const fer = (holidays ?? []).filter(h => h.country.toUpperCase() === c.iso).length;
            const activo = c.iso === country;
            return (
              <button
                key={c.iso}
                onClick={() => { setCountry(c.iso); setDate(null); }}
                className={`flex flex-shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs transition-colors ${
                  activo
                    ? 'bg-gray-800 font-semibold text-white'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                <span>{c.flag}</span>
                <span>{c.name}</span>
                <span className={`rounded-full px-1.5 text-[10px] ${activo ? 'bg-white/20' : 'bg-gray-100'}`}>
                  {n} · {fer}🎉
                </span>
              </button>
            );
          })}

          <select
            value=""
            onChange={e => { if (e.target.value) { setCountry(e.target.value); setDate(null); } }}
            aria-label="Agregar otro país"
            className="ml-1 flex-shrink-0 rounded-xl border border-dashed border-gray-300 bg-transparent px-2 py-1.5 text-xs text-gray-400"
          >
            <option value="">+ otro país</option>
            {COUNTRIES.filter(c => !paisesVisibles.some(v => v.iso === c.iso)).map(c => (
              <option key={c.iso} value={c.iso}>{c.flag} {c.name}</option>
            ))}
          </select>
        </div>

        {/* Quién tiene este país: se ve y se corrige en Personas. */}
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-gray-100 px-6 py-2 text-[11px] text-gray-500">
          <span>{gente === 1 ? '1 persona tiene' : `${gente} personas tienen`} {cfgPais.name} como país.</span>
          <button onClick={() => onAbrirPersonas({ pais: country })} className="font-semibold text-sky-700 hover:underline" data-testid="ver-personas-pais">
            Ver y corregir en Personas →
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-3 flex-shrink-0 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </div>
        )}

        {/* El espejo del aviso de abajo: feriados cargados para un país donde
            no hay nadie. Igual de silencioso — el trabajo de cargar el
            calendario se hizo y no le sirve a ninguna persona. Se muestra
            solo si ya hay feriados, para no regañar a quien acaba de elegir
            un país vacío y todavía no cargó nada. */}
        {gente === 0 && delPais.length > 0 && (
          <div className="mx-6 mt-3 flex-shrink-0 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5">
            <p className="text-[11px] leading-relaxed text-orange-800">
              {cfgPais.name} tiene <strong>{delPais.length}</strong>{' '}
              {delPais.length === 1 ? 'feriado cargado' : 'feriados cargados'} y{' '}
              <strong>ninguna persona asignada</strong>: hoy no le dan el día libre a nadie.
              Asigná el país a quien corresponda en{' '}
              <button onClick={() => onAbrirPersonas({})} className="font-semibold underline">
                Personas
              </button>{' '}
              o borralos.
            </p>
          </div>
        )}

        {/* Aviso del origen del país. Es el corazón de la pantalla: sin esto
            RRHH carga un calendario y no sabe a quién le está dando el día. */}
        {genteDefault > 0 && (
          <div className="mx-6 mt-3 flex-shrink-0 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-[11px] leading-relaxed text-amber-800">
              <strong>{genteDefault} de {gente}</strong> {genteDefault === 1 ? 'persona está' : 'personas están'} en{' '}
              {cfgPais.name} solo porque es el país por defecto — nadie verificó ese dato.
              Los feriados que cargues acá les van a aplicar igual.{' '}
              <button onClick={() => onAbrirPersonas({ pais: country, pendiente: 'pais' })} className="font-semibold underline">
                Revisar en Personas
              </button>
            </p>
          </div>
        )}

        {/* Contenido */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_16rem]">
              <div>
                {holidays === null ? (
                  <p className="py-12 text-center text-xs text-gray-400">Cargando…</p>
                ) : (
                  <HolidayCalendar
                    year={year}
                    holidays={delPais}
                    selectedDate={date}
                    onPickDate={pickDate}
                  />
                )}
              </div>

              <div className="space-y-4">
                {/* Alta */}
                <div className="rounded-2xl border border-gray-100 p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    Nuevo feriado
                  </p>
                  {date ? (
                    <>
                      <div className="mb-2 flex items-center justify-between rounded-xl bg-amber-50 px-2.5 py-1.5">
                        <span className="text-xs font-semibold text-amber-800">
                          {fmtDateOnly(date)}
                        </span>
                        <button onClick={() => setDate(null)} className="text-[10px] text-amber-700 underline">
                          cambiar
                        </button>
                      </div>
                      <input
                        ref={nameRef}
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') void handleCreate(); }}
                        placeholder="Día de la Independencia"
                        className="w-full rounded-xl border border-gray-200 p-2 text-xs focus:border-gray-400 focus:outline-none"
                      />
                      <button
                        onClick={() => void handleCreate()}
                        disabled={!name.trim() || creating}
                        className="mt-2 w-full rounded-xl bg-gray-800 py-2 text-xs font-semibold text-white transition-colors disabled:bg-gray-300"
                      >
                        {creating ? 'Guardando…' : `Agregar en ${cfgPais.name}`}
                      </button>
                    </>
                  ) : (
                    <p className="py-2 text-[11px] leading-relaxed text-gray-400">
                      Hacé click en un día del calendario para agregar un feriado ahí.
                    </p>
                  )}
                </div>

                {/* Lista del año */}
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    {delPais.length} en {year}
                  </p>
                  {anteriores > 0 && (
                    <button onClick={() => setVerAnteriores(v => !v)} data-testid="feriados-anteriores"
                      className="mb-2 text-[10px] text-gray-500 underline hover:text-gray-700">
                      {verAnteriores ? 'Ocultar los de hace más de un mes' : `Mostrar ${anteriores} de hace más de un mes`}
                    </button>
                  )}
                  {delPais.length === 0 ? (
                    <p className="text-[11px] leading-relaxed text-gray-400">
                      Sin feriados cargados para {cfgPais.name} en {year}.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {porMes.map(([mes, lista]) => (
                        <div key={mes}>
                          <p className="mb-1 text-[10px] font-semibold text-gray-400">{MES_NOMBRE[mes]}</p>
                          <ul className="space-y-1">
                            {lista.map(h => (
                              <li key={h.id} className="group rounded-xl px-2 py-1.5 hover:bg-gray-50">
                                <div className="flex items-start gap-2">
                                  <span className="mt-0.5 flex-shrink-0 text-[10px] font-bold text-amber-600">
                                    {dayOf(h.date)}
                                  </span>
                                  <span className="min-w-0 flex-1 break-words text-[11px] text-gray-600">
                                    {h.name}
                                  </span>
                                  {confirmDelete === h.id ? (
                                    <span className="flex flex-shrink-0 items-center gap-1">
                                      <button
                                        onClick={() => void handleDelete(h.id)}
                                        className="rounded-lg bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                                      >
                                        borrar
                                      </button>
                                      <button
                                        onClick={() => setConfirmDelete(null)}
                                        className="text-[10px] text-gray-400"
                                      >
                                        no
                                      </button>
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => setConfirmDelete(h.id)}
                                      aria-label={`Borrar ${h.name}`}
                                      className="flex-shrink-0 text-[10px] text-gray-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
        </div>
      </div>
    </div>
  );
}

