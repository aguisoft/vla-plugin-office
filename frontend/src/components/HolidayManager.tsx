import { useEffect, useMemo, useRef, useState } from 'react';
import {
  listHolidays, createHoliday, deleteHoliday, getOrgRoster, setOrg, listDepartments, ApiError,
} from '../api';
import type { StatusError } from '../api';
import { COUNTRIES, countryOf } from '../countries';
import { monthOf, dayOf } from '../calendar';
import { fmtDateOnly } from '../format';
import { HolidayCalendar } from './HolidayCalendar';
import type { Department, Holiday, RosterUser } from '../types';

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
  const [departments, setDepartments] = useState<Department[]>([]);
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

  /**
   * El catálogo falla en silencio a propósito: sin él los desplegables de
   * departamento quedan vacíos, pero el país y el jefe se siguen pudiendo
   * corregir. Un banner rojo acá bloquearía visualmente una pantalla que
   * todavía sirve para dos de sus tres cosas.
   */
  const reloadDepartments = async () => {
    try {
      setDepartments((await listDepartments()).departments);
    } catch {
      setDepartments([]);
    }
  };

  useEffect(() => { void reloadHolidays(); }, [year]);
  useEffect(() => { void reloadRoster(); void reloadDepartments(); }, []);

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
   * posición. Comparar contra el override actual hace la operación idempotente:
   * un evento que no cambia nada no manda nada. Al igual que país, solo el
   * override puede modificarse desde acá; Bitrix gana cuando el override está
   * vacío.
   */
  async function handleSetManager(userId: string, managerUserId: string | null) {
    const actual = roster?.find(u => u.userId === userId);
    if (!actual) return;
    const vigente = actual.managerSource === 'override' ? (actual.managerUserId ?? null) : null;
    if (vigente === managerUserId) return;

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

  /**
   * Fija (o suelta) el departamento de una persona. Mismo corte de
   * idempotencia que país y jefe, por la misma razón.
   *
   * Recarga el catálogo además del roster: mover gente cambia el conteo que se
   * muestra en el filtro, y un número viejo al lado de un nombre hace dudar de
   * los dos.
   */
  async function handleSetDepartment(userId: string, departmentId: string | null) {
    const actual = roster?.find(u => u.userId === userId);
    if (!actual) return;
    const vigente = actual.departmentSource === 'override' ? (actual.departmentId ?? null) : null;
    if (vigente === departmentId) return;

    setSavingUser(userId);
    setError(null);
    try {
      await setOrg(userId, { departmentId });
      await Promise.all([reloadRoster(), reloadDepartments()]);
    } catch (e) {
      setError(errorMessage(e, 'No se pudo guardar el departamento'));
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
              departments={departments}
              country={country}
              defaultCountry={defaultCountry}
              savingUser={savingUser}
              onSetCountry={handleSetCountry}
              onSetManager={handleSetManager}
              onSetDepartment={handleSetDepartment}
            />
          )}
        </div>
      </div>
    </div>
  );
}


/** Estilo compartido por los tres desplegables de la tabla. */
const SELECT_CLS =
  'w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] ' +
  'focus:border-gray-400 focus:outline-none disabled:opacity-50';

/** Cómo se ve cada origen. Los tres campos usan la misma escala de color. */
const CHIP: Record<'override' | 'bitrix' | 'vacio', string> = {
  override: 'bg-green-100 text-green-700',
  bitrix:   'bg-blue-100 text-blue-700',
  vacio:    'bg-amber-100 text-amber-700',
};

function OrigenChip({ tipo, texto }: { tipo: 'override' | 'bitrix' | 'vacio'; texto: string }) {
  return (
    <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-medium ${CHIP[tipo]}`}>
      {texto}
    </span>
  );
}

/** Qué falta por resolver. Generaliza el viejo «Solo sin verificar». */
type Pendiente = 'todos' | 'pais' | 'departamento' | 'jefe' | 'fijados';

const PENDIENTES: Array<{ value: Pendiente; label: string }> = [
  { value: 'todos',        label: 'Todo el estado del dato' },
  { value: 'pais',         label: 'País sin verificar' },
  { value: 'departamento', label: 'Sin departamento' },
  { value: 'jefe',         label: 'Sin jefe' },
  { value: 'fijados',      label: 'Fijados por RRHH' },
];

/**
 * Quién está en cada país y departamento, de dónde sale cada dato, y la opción
 * de corregirlo. Es la mitad que faltaba: sin poder marcar las excepciones,
 * todo el mundo queda en el país por defecto y los feriados de un país le caen
 * a gente de otro.
 *
 * Es una tabla con encabezados y no una lista de desplegables sueltos porque
 * tres selectores seguidos en una fila no dicen cuál es cuál. El encabezado es
 * la única parte de la interfaz que nombra las columnas.
 */
function PersonasTab({
  roster, departments, country, defaultCountry, savingUser,
  onSetCountry, onSetManager, onSetDepartment,
}: {
  roster: RosterUser[] | null;
  departments: Department[];
  country: string;
  defaultCountry: string;
  savingUser: string | null;
  onSetCountry: (userId: string, iso: string | null) => void;
  onSetManager: (userId: string, managerUserId: string | null) => void;
  onSetDepartment: (userId: string, departmentId: string | null) => void;
}) {
  const [verTodos, setVerTodos] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [filtroDept, setFiltroDept] = useState('');
  const [filtroJefe, setFiltroJefe] = useState('');
  const [pendiente, setPendiente] = useState<Pendiente>('todos');

  const aqui = (roster ?? []).filter(u => (u.country ?? '').toUpperCase() === country);

  // Con el país vacío hay que mostrar a todo el equipo o no hay forma de meter
  // a nadie: filtrando por país, la lista sale vacía y el selector que movería
  // a alguien no se renderiza nunca. El aviso de "ninguna persona asignada"
  // manda justo acá, así que acá tiene que haber algo que hacer.
  const vacio = aqui.length === 0;
  const mostrarTodos = verTodos || vacio;

  // Los jefes que existen hoy, para el filtro. Sale del roster y no de una
  // lista aparte: así solo aparece gente que de verdad tiene a alguien a cargo.
  const jefes = useMemo(() => {
    const ids = new Set((roster ?? []).map(u => u.managerUserId).filter(Boolean) as string[]);
    return (roster ?? [])
      .filter(u => ids.has(u.userId))
      .sort((a, b) => a.firstName.localeCompare(b.firstName));
  }, [roster]);

  const lista = useMemo(() => {
    let base = mostrarTodos ? (roster ?? []) : aqui;

    const q = busqueda.trim().toLowerCase();
    if (q) {
      base = base.filter(u =>
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q),
      );
    }

    if (filtroDept) {
      base = filtroDept === '__sin__'
        ? base.filter(u => !u.departmentId)
        : base.filter(u => u.departmentId === filtroDept);
    }

    if (filtroJefe) {
      base = filtroJefe === '__sin__'
        ? base.filter(u => !u.managerUserId)
        : base.filter(u => u.managerUserId === filtroJefe);
    }

    if (pendiente === 'pais')         base = base.filter(u => u.countrySource === 'default');
    if (pendiente === 'departamento') base = base.filter(u => u.departmentSource === 'none');
    if (pendiente === 'jefe')         base = base.filter(u => u.managerSource === 'none');
    if (pendiente === 'fijados')      base = base.filter(u =>
      u.countrySource === 'override' || u.departmentSource === 'override' || u.managerSource === 'override');

    return base;
  }, [roster, aqui, mostrarTodos, busqueda, filtroDept, filtroJefe, pendiente]);

  if (roster === null) return <p className="py-12 text-center text-xs text-gray-400">Cargando…</p>;

  const cfg = countryOf(country);
  const nombreDe = (id: string | null) => {
    const u = roster.find(x => x.userId === id);
    return u ? `${u.firstName} ${u.lastName}` : null;
  };
  const filtrando = Boolean(busqueda.trim() || filtroDept || filtroJefe || pendiente !== 'todos');

  return (
    <div>
      {/* ── Filtros ── */}
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o correo…"
            aria-label="Buscar por nombre o correo"
            className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-[11px] focus:border-gray-400 focus:outline-none"
          />

          <select
            value={filtroDept}
            onChange={e => setFiltroDept(e.target.value)}
            aria-label="Filtrar por departamento"
            className="rounded-xl border border-gray-200 bg-white px-2 py-1.5 text-[11px] focus:border-gray-400 focus:outline-none"
          >
            <option value="">Todos los departamentos</option>
            <option value="__sin__">— Sin departamento —</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>{d.name} ({d.headcount})</option>
            ))}
          </select>

          <select
            value={filtroJefe}
            onChange={e => setFiltroJefe(e.target.value)}
            aria-label="Filtrar por jefe"
            className="rounded-xl border border-gray-200 bg-white px-2 py-1.5 text-[11px] focus:border-gray-400 focus:outline-none"
          >
            <option value="">Todos los jefes</option>
            <option value="__sin__">— Sin jefe —</option>
            {jefes.map(j => (
              <option key={j.userId} value={j.userId}>{j.firstName} {j.lastName}</option>
            ))}
          </select>

          <select
            value={pendiente}
            onChange={e => setPendiente(e.target.value as Pendiente)}
            aria-label="Filtrar por estado del dato"
            className="rounded-xl border border-gray-200 bg-white px-2 py-1.5 text-[11px] focus:border-gray-400 focus:outline-none"
          >
            {PENDIENTES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-gray-500">
            {lista.length} de {mostrarTodos ? roster.length : aqui.length}
            {!mostrarTodos && <> en {cfg.flag} {cfg.name}</>}
            {mostrarTodos && <span className="text-gray-400"> · todo el equipo</span>}
            {filtrando && (
              <button
                onClick={() => { setBusqueda(''); setFiltroDept(''); setFiltroJefe(''); setPendiente('todos'); }}
                className="ml-2 text-gray-400 underline hover:text-gray-600"
              >
                limpiar filtros
              </button>
            )}
          </p>

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
        </div>
      </div>

      {/* ── Tabla ── */}
      {lista.length === 0 ? (
        <p className="py-10 text-center text-xs text-gray-400">
          {filtrando ? 'Nadie coincide con esos filtros.' : 'Nadie en este país.'}
        </p>
      ) : (
        // La tabla tiene su propio scroll horizontal: en un teléfono las cuatro
        // columnas no entran, y sin esto la página entera se desplaza de lado.
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-gray-200">
                {['Persona', 'País', 'Departamento', 'Jefe directo'].map(h => (
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
              {lista.map(u => (
                <tr key={u.userId} className="border-b border-gray-50 align-top hover:bg-gray-50">
                  <td className="px-2 py-2">
                    <p className="truncate text-xs font-medium text-gray-700">
                      {u.firstName} {u.lastName}
                    </p>
                    <p className="truncate text-[10px] text-gray-400">{u.email}</p>
                  </td>

                  <td className="w-[28%] px-2 py-2">
                    <select
                      value={u.countrySource === 'override' ? (u.country ?? '') : ''}
                      disabled={savingUser === u.userId}
                      onChange={e => onSetCountry(u.userId, e.target.value || null)}
                      aria-label={`País de ${u.firstName} ${u.lastName}`}
                      className={SELECT_CLS}
                    >
                      <option value="">Sin fijar ({defaultCountry})</option>
                      {COUNTRIES.map(c => (
                        <option key={c.iso} value={c.iso}>{c.flag} {c.name}</option>
                      ))}
                    </select>
                    {u.countrySource === 'override' && <OrigenChip tipo="override" texto="fijado por RRHH" />}
                    {u.countrySource === 'bitrix'   && <OrigenChip tipo="bitrix"   texto="desde Bitrix" />}
                    {u.countrySource === 'default'  && <OrigenChip tipo="vacio"    texto={`por defecto · ${countryOf(u.country ?? '').flag}`} />}
                  </td>

                  <td className="w-[24%] px-2 py-2">
                    <select
                      value={u.departmentSource === 'override' ? (u.departmentId ?? '') : ''}
                      disabled={savingUser === u.userId}
                      onChange={e => onSetDepartment(u.userId, e.target.value || null)}
                      aria-label={`Departamento de ${u.firstName} ${u.lastName}`}
                      className={SELECT_CLS}
                    >
                      <option value="">Sin fijar</option>
                      {departments.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                    {u.departmentSource === 'override' && <OrigenChip tipo="override" texto="fijado por RRHH" />}
                    {u.departmentSource === 'bitrix'   && <OrigenChip tipo="bitrix"   texto={u.departmentName ?? 'desde Bitrix'} />}
                    {u.departmentSource === 'none'     && <OrigenChip tipo="vacio"    texto="sin departamento" />}
                  </td>

                  <td className="w-[24%] px-2 py-2">
                    <select
                      value={u.managerSource === 'override' ? (u.managerUserId ?? '') : ''}
                      disabled={savingUser === u.userId}
                      onChange={e => onSetManager(u.userId, e.target.value || null)}
                      aria-label={`Jefe de ${u.firstName} ${u.lastName}`}
                      className={SELECT_CLS}
                    >
                      <option value="">Sin fijar</option>
                      {roster.filter(o => o.userId !== u.userId).map(o => (
                        <option key={o.userId} value={o.userId}>{o.firstName} {o.lastName}</option>
                      ))}
                    </select>
                    {u.managerSource === 'override' && <OrigenChip tipo="override" texto="fijado por RRHH" />}
                    {/* El jefe heredado del departamento se nombra: "desde
                        Bitrix" a secas obliga a cruzar la fila con otra para
                        saber quién es. */}
                    {u.managerSource === 'bitrix'   && <OrigenChip tipo="bitrix" texto={nombreDe(u.managerUserId) ?? 'desde Bitrix'} />}
                    {u.managerSource === 'none'     && <OrigenChip tipo="vacio"  texto="sin jefe" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-[10px] leading-relaxed text-gray-400">
        «Sin fijar» deja que el dato salga de Bitrix, y si Bitrix no lo trae, del valor por defecto
        ({defaultCountry} para el país; sin jefe ni departamento para los otros dos). Fijar cualquiera
        de los tres acá gana sobre lo automático y es lo que hay que usar para las excepciones.
        Corregir el <strong>departamento</strong> también cambia el jefe: pasa a ser quien dirija el
        departamento nuevo, salvo que se le haya fijado uno a mano.
      </p>
    </div>
  );
}
