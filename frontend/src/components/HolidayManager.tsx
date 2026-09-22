import { useEffect, useMemo, useRef, useState } from 'react';
import {
  listHolidays, createHoliday, deleteHoliday, getOrgRoster, setOrg, ApiError,
} from '../api';
import type { StatusError } from '../api';
import { COUNTRIES, countryOf } from '../countries';
import { monthOf, dayOf } from '../calendar';
import { fmtDateOnly } from '../format';
import { HolidayCalendar } from './HolidayCalendar';
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
 * Dos pestañas porque son dos trabajos: *qué* días son feriados, y *a quién*
 * le tocan. Mezclarlos en un formulario fue lo que escondió el problema.
 */

type Tab = 'calendario' | 'personas';

const MES_NOMBRE = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function errorMessage(e: unknown, fallback: string): string {
  const detail = e instanceof ApiError ? (e.detail as StatusError | undefined) : undefined;
  return detail?.errors?.[0]?.message ?? detail?.message ?? fallback;
}

export function HolidayManager({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('calendario');
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
  const [savingUser, setSavingUser] = useState<string | null>(null);

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

  /**
   * Fija (o suelta) el país de una persona.
   *
   * Descarta el cambio si el valor ya es el vigente. Un `<select>` puede
   * emitir `change` sin que nadie eligiera nada — al perder el foco con un
   * valor sin confirmar, o al reordenarse la lista bajo el cursor — y sin
   * este corte esa emisión escribe el país de la fila que quedó en esa
   * posición. Comparar contra el override actual hace la operación
   * idempotente: un evento que no cambia nada no manda nada.
   */
  async function handleSetCountry(userId: string, iso: string | null) {
    const actual = roster?.find(u => u.userId === userId);
    if (!actual) return;
    const vigente = actual.countrySource === 'override' ? (actual.country ?? null) : null;
    if (vigente === iso) return;

    setSavingUser(userId);
    setError(null);
    try {
      await setOrg(userId, { country: iso });
      await reloadRoster();
    } catch (e) {
      setError(errorMessage(e, 'No se pudo guardar el país'));
    } finally {
      setSavingUser(null);
    }
  }

  /**
   * Fija (o suelta) el jefe directo de una persona.
   *
   * Descarta el cambio si el valor ya es el vigente. Un `<select>` puede
   * emitir `change` sin que nadie eligiera nada — al perder el foco con un
   * valor sin confirmar, o al reordenarse la lista bajo el cursor — y sin
   * este corte esa emisión escribe el jefe de la fila que quedó en esa
   * posición. Comparar contra el jefe actual hace la operación idempotente:
   * un evento que no cambia nada no manda nada.
   */
  async function handleSetManager(userId: string, managerUserId: string | null) {
    const actual = roster?.find(u => u.userId === userId);
    if (!actual) return;
    if ((actual.managerUserId ?? null) === managerUserId) return;

    setSavingUser(userId);
    setError(null);
    try {
      await setOrg(userId, { managerUserId });
      await reloadRoster();
    } catch (e) {
      setError(errorMessage(e, 'No se pudo guardar el jefe'));
    } finally {
      setSavingUser(null);
    }
  }

  const porMes = useMemo(() => {
    const m = new Map<number, Holiday[]>();
    for (const h of delPais) {
      // monthOf lee los caracteres del string; `new Date(iso)` correría un
      // feriado de día 1 al mes anterior en UTC-6.
      const mes = monthOf(h.date);
      const list = m.get(mes);
      if (list) list.push(h); else m.set(mes, [h]);
    }
    for (const list of m.values()) list.sort((a, b) => a.date.localeCompare(b.date));
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [delPais]);

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

        {/* Pestañas de sección */}
        <div className="flex flex-shrink-0 gap-4 border-b border-gray-100 px-6">
          {(['calendario', 'personas'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-1 py-2.5 text-xs font-semibold capitalize transition-colors ${
                tab === t
                  ? 'border-gray-800 text-gray-800'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {t === 'calendario' ? 'Calendario' : `Personas (${gente})`}
            </button>
          ))}
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
              <button onClick={() => setTab('personas')} className="font-semibold underline">
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
              <button onClick={() => setTab('personas')} className="font-semibold underline">
                Revisar en Personas
              </button>
            </p>
          </div>
        )}

        {/* Contenido */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {tab === 'calendario' ? (
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
          ) : (
            <PersonasTab
              roster={roster}
              country={country}
              defaultCountry={defaultCountry}
              savingUser={savingUser}
              onSetCountry={handleSetCountry}
              onSetManager={handleSetManager}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Quién está en el país seleccionado y de dónde sale ese dato, con la opción
 * de moverlo. Es la mitad que faltaba: sin poder marcar las excepciones, todo
 * el mundo queda en el país por defecto y los feriados de un país le caen a
 * gente de otro.
 */
function PersonasTab({ roster, country, defaultCountry, savingUser, onSetCountry, onSetManager }: {
  roster: RosterUser[] | null;
  country: string;
  defaultCountry: string;
  savingUser: string | null;
  onSetCountry: (userId: string, iso: string | null) => void;
  onSetManager: (userId: string, managerUserId: string | null) => void;
}) {
  const [soloDefault, setSoloDefault] = useState(false);
  const [verTodos, setVerTodos] = useState(false);

  const aqui = (roster ?? []).filter(u => (u.country ?? '').toUpperCase() === country);

  // Con el país vacío hay que mostrar a todo el equipo o no hay forma de meter
  // a nadie: filtrando por país, la lista sale vacía y el selector que movería
  // a alguien no se renderiza nunca. El aviso de "ninguna persona asignada"
  // mandaba justo acá, así que acá tiene que haber algo que hacer.
  const vacio = aqui.length === 0;
  const mostrarTodos = verTodos || vacio;

  if (roster === null) return <p className="py-12 text-center text-xs text-gray-400">Cargando…</p>;

  const base = mostrarTodos ? roster : aqui;
  const lista = soloDefault ? base.filter(u => u.countrySource === 'default') : base;
  const cfg = countryOf(country);

  const ORIGEN: Record<RosterUser['countrySource'], { texto: string; clase: string }> = {
    override: { texto: 'fijado por RRHH', clase: 'bg-green-100 text-green-700' },
    bitrix:   { texto: 'desde Bitrix',    clase: 'bg-blue-100 text-blue-700' },
    default:  { texto: 'por defecto',     clase: 'bg-amber-100 text-amber-700' },
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-gray-500">
          {aqui.length} {aqui.length === 1 ? 'persona' : 'personas'} en {cfg.flag} {cfg.name}
          {mostrarTodos && <span className="text-gray-400"> · mostrando todo el equipo ({roster.length})</span>}
        </p>
        <div className="flex items-center gap-3">
          {/* Con el país vacío el interruptor queda forzado: apagarlo dejaría
              una lista vacía y sin salida. */}
          <label className={`flex items-center gap-1.5 text-[11px] ${vacio ? 'text-gray-300' : 'text-gray-500'}`}>
            <input
              type="checkbox"
              checked={mostrarTodos}
              disabled={vacio}
              onChange={e => setVerTodos(e.target.checked)}
              className="rounded border-gray-300"
            />
            Todo el equipo
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <input
              type="checkbox"
              checked={soloDefault}
              onChange={e => setSoloDefault(e.target.checked)}
              className="rounded border-gray-300"
            />
            Solo sin verificar
          </label>
        </div>
      </div>

      {lista.length === 0 ? (
        <p className="py-10 text-center text-xs text-gray-400">
          {soloDefault ? 'Nadie con el país sin verificar acá.' : 'Nadie en este país.'}
        </p>
      ) : (
        <ul className="space-y-1">
          {lista.map(u => (
            <li
              key={u.userId}
              className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-gray-50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-gray-700">
                  {u.firstName} {u.lastName}
                </p>
                <p className="truncate text-[10px] text-gray-400">{u.email}</p>
              </div>

              {/* Al mostrar todo el equipo, la bandera de quien NO está en el
                  país seleccionado: sin eso la lista es un montón de nombres
                  sin decir dónde está cada uno. */}
              {mostrarTodos && (u.country ?? '').toUpperCase() !== country && (
                <span className="flex-shrink-0 text-[11px] text-gray-400" title={countryOf(u.country ?? '').name}>
                  {countryOf(u.country ?? '').flag}
                </span>
              )}

              <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${ORIGEN[u.countrySource].clase}`}>
                {ORIGEN[u.countrySource].texto}
              </span>

              <select
                value={u.countrySource === 'override' ? (u.country ?? '') : ''}
                disabled={savingUser === u.userId}
                onChange={e => onSetCountry(u.userId, e.target.value || null)}
                aria-label={`País de ${u.firstName} ${u.lastName}`}
                className="flex-shrink-0 rounded-xl border border-gray-200 bg-white px-2 py-1 text-[11px] focus:border-gray-400 focus:outline-none disabled:opacity-50"
              >
                <option value="">Sin fijar ({defaultCountry})</option>
                {COUNTRIES.map(c => (
                  <option key={c.iso} value={c.iso}>{c.flag} {c.name}</option>
                ))}
              </select>

              <select
                value={u.managerUserId ?? ''}
                disabled={savingUser === u.userId}
                onChange={e => onSetManager(u.userId, e.target.value || null)}
                aria-label={`Jefe de ${u.firstName} ${u.lastName}`}
                className="flex-shrink-0 rounded-xl border border-gray-200 bg-white px-2 py-1 text-[11px] focus:border-gray-400 focus:outline-none disabled:opacity-50"
              >
                <option value="">Sin jefe</option>
                {(roster ?? []).filter(o => o.userId !== u.userId).map(o => (
                  <option key={o.userId} value={o.userId}>{o.firstName} {o.lastName}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-[10px] leading-relaxed text-gray-400">
        «Sin fijar» deja que el país salga de Bitrix, y si Bitrix no lo trae, del valor
        por defecto ({defaultCountry}). Fijarlo acá gana sobre las dos cosas y es lo que
        hay que usar para las excepciones.
      </p>
    </div>
  );
}
