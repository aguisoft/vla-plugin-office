import { useEffect, useMemo, useState } from 'react';
import { getOrgRoster, setOrg, listDepartments, ApiError } from '../api';
import type { StatusError } from '../api';
import { COUNTRIES, countryOf } from '../countries';
import type { Department, MapZone, RosterUser } from '../types';

/**
 * Personas: el país, el departamento, el jefe directo y la zona del mapa de
 * cada colaborador, de dónde sale cada dato, y la opción de corregirlo.
 *
 * Vivía como pestaña dentro de Feriados, que solo usa uno de los cuatro datos
 * (el país). Desde que el jefe decide quién aprueba las solicitudes y a quién
 * le llegan los avisos, corregirlo no puede estar escondido detrás de un
 * botón que dice «Feriados». Sigue siendo el ÚNICO lugar donde se editan:
 * el organigrama es de solo lectura y manda acá.
 *
 * Es una tabla con encabezados y no una lista de desplegables sueltos porque
 * cuatro selectores seguidos en una fila no dicen cuál es cuál.
 */

/** Qué falta por resolver. */
export type Pendiente = 'todos' | 'pais' | 'departamento' | 'jefe' | 'zona' | 'zonaSugerida' | 'fijados';

/** Con qué filtro se abre (desde Feriados o desde el organigrama). */
export interface FiltroPersonas {
  pais?: string;
  pendiente?: Pendiente;
}

const PENDIENTES: Array<{ value: Pendiente; label: string }> = [
  { value: 'todos',        label: 'Todo el estado del dato' },
  { value: 'pais',         label: 'País sin verificar' },
  { value: 'departamento', label: 'Sin departamento' },
  { value: 'jefe',         label: 'Sin jefe' },
  { value: 'zona',         label: 'Sin zona en el mapa' },
  { value: 'zonaSugerida', label: 'Zona sugerida sin confirmar' },
  { value: 'fijados',      label: 'Fijados por RRHH' },
];

/** Estilo compartido por los desplegables de la tabla. */
const SELECT_CLS =
  'w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] ' +
  'focus:border-gray-400 focus:outline-none disabled:opacity-50';

const FILTRO_CLS =
  'rounded-xl border border-gray-200 bg-white px-2 py-1.5 text-[11px] focus:border-gray-400 focus:outline-none';

/** Cómo se ve cada origen. Los cuatro campos usan la misma escala de color. */
const CHIP: Record<'override' | 'bitrix' | 'sugerida' | 'vacio', string> = {
  override: 'bg-green-100 text-green-700',
  bitrix:   'bg-blue-100 text-blue-700',
  // Distinto del azul de Bitrix a propósito: una zona sugerida la dedujo el
  // sistema por parecido de nombre y nadie la confirmó. Si se viera igual que
  // un dato verificado, las que calzaron mal no se buscarían nunca.
  sugerida: 'bg-violet-100 text-violet-700',
  vacio:    'bg-amber-100 text-amber-700',
};

function OrigenChip({ tipo, texto }: { tipo: 'override' | 'bitrix' | 'sugerida' | 'vacio'; texto: string }) {
  return (
    <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-medium ${CHIP[tipo]}`}>
      {texto}
    </span>
  );
}

function errorMessage(e: unknown, fallback: string): string {
  const detail = e instanceof ApiError ? (e.detail as StatusError | undefined) : undefined;
  return detail?.errors?.[0]?.message ?? detail?.message ?? fallback;
}

export function PersonasAdmin({ inicial, onClose }: { inicial?: FiltroPersonas; onClose: () => void }) {
  const [roster, setRoster] = useState<RosterUser[] | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [zones, setZones] = useState<MapZone[]>([]);
  const [defaultCountry, setDefaultCountry] = useState('CR');
  const [error, setError] = useState<string | null>(null);
  const [savingUser, setSavingUser] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState('');
  const [filtroPais, setFiltroPais] = useState(inicial?.pais ?? '');
  const [filtroDept, setFiltroDept] = useState('');
  const [filtroJefe, setFiltroJefe] = useState('');
  const [pendiente, setPendiente] = useState<Pendiente>(inicial?.pendiente ?? 'todos');

  const reloadRoster = async () => {
    try {
      const r = await getOrgRoster();
      setRoster(r.users);
      setZones(r.zones ?? []);
      setDefaultCountry(r.defaultCountry);
    } catch (e) {
      setRoster([]);
      setError(errorMessage(e, 'No se pudo cargar el equipo'));
    }
  };

  /**
   * El catálogo falla en silencio a propósito: sin él los desplegables de
   * departamento quedan vacíos, pero el país, el jefe y la zona se siguen
   * pudiendo corregir.
   */
  const reloadDepartments = async () => {
    try {
      setDepartments((await listDepartments()).departments);
    } catch {
      setDepartments([]);
    }
  };

  useEffect(() => { void reloadRoster(); void reloadDepartments(); }, []);

  /**
   * Guarda un dato de una persona. Descarta el cambio si el valor ya es el
   * vigente: un `<select>` puede emitir `change` sin que nadie eligiera nada
   * (al perder el foco, o al reordenarse la lista bajo el cursor) y sin este
   * corte esa emisión escribe el dato de la fila que quedó en esa posición.
   * Solo el valor fijado se compara: lo que viene de Bitrix gana cuando no hay
   * nada fijado.
   */
  async function guardar(
    userId: string,
    vigente: (u: RosterUser) => string | null,
    nuevo: string | null,
    cambio: Parameters<typeof setOrg>[1],
    queFalla: string,
    tambienDepartamentos = false,
  ) {
    const actual = roster?.find(u => u.userId === userId);
    if (!actual || vigente(actual) === nuevo) return;
    setSavingUser(userId);
    setError(null);
    try {
      await setOrg(userId, cambio);
      // Mover gente cambia el conteo del filtro de departamentos.
      await Promise.all([reloadRoster(), tambienDepartamentos ? reloadDepartments() : Promise.resolve()]);
    } catch (e) {
      setError(errorMessage(e, `No se pudo guardar ${queFalla}`));
    } finally {
      setSavingUser(null);
    }
  }

  const onSetCountry = (userId: string, iso: string | null) =>
    guardar(userId, u => (u.countrySource === 'override' ? (u.country ?? null) : null), iso, { country: iso }, 'el país');
  // Corregir el departamento también puede cambiar el jefe (pasa a ser quien dirige el nuevo).
  const onSetDepartment = (userId: string, departmentId: string | null) =>
    guardar(userId, u => (u.departmentSource === 'override' ? (u.departmentId ?? null) : null), departmentId, { departmentId }, 'el departamento', true);
  const onSetManager = (userId: string, managerUserId: string | null) =>
    guardar(userId, u => (u.managerSource === 'override' ? (u.managerUserId ?? null) : null), managerUserId, { managerUserId }, 'el jefe');
  // Solo la zona FIJADA se compara: una sugerida se confirma eligiendo la misma opción.
  const onSetSabado = (userId: string, sabado: number) =>
    guardar(userId, u => String(u.sabado ?? 0), String(sabado), { sabado }, 'el sábado');
  const onSetZone = (userId: string, zoneId: string | null) =>
    guardar(userId, u => (u.zoneSource === 'fijada' ? (u.zoneId ?? null) : null), zoneId, { zoneId }, 'la zona del mapa');

  // Los jefes que existen hoy, para el filtro: solo gente que de verdad tiene a alguien a cargo.
  const jefes = useMemo(() => {
    const ids = new Set((roster ?? []).map(u => u.managerUserId).filter(Boolean) as string[]);
    return (roster ?? []).filter(u => ids.has(u.userId)).sort((a, b) => a.firstName.localeCompare(b.firstName));
  }, [roster]);

  // Países con gente, más el pedido al abrir, para el filtro.
  const paises = useMemo(() => {
    const con = new Set((roster ?? []).map(u => (u.country ?? '').toUpperCase()).filter(Boolean));
    if (filtroPais) con.add(filtroPais);
    return COUNTRIES.filter(c => con.has(c.iso));
  }, [roster, filtroPais]);

  const lista = useMemo(() => {
    let base = roster ?? [];
    const q = busqueda.trim().toLowerCase();
    if (q) base = base.filter(u => `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    if (filtroPais) base = base.filter(u => (u.country ?? '').toUpperCase() === filtroPais);
    if (filtroDept) base = filtroDept === '__sin__' ? base.filter(u => !u.departmentId) : base.filter(u => u.departmentId === filtroDept);
    if (filtroJefe) base = filtroJefe === '__sin__' ? base.filter(u => !u.managerUserId) : base.filter(u => u.managerUserId === filtroJefe);
    if (pendiente === 'pais')         base = base.filter(u => u.countrySource === 'default');
    if (pendiente === 'departamento') base = base.filter(u => u.departmentSource === 'none');
    if (pendiente === 'jefe')         base = base.filter(u => u.managerSource === 'none');
    if (pendiente === 'zona')         base = base.filter(u => u.zoneSource === 'none');
    if (pendiente === 'zonaSugerida') base = base.filter(u => u.zoneSource === 'sugerida');
    if (pendiente === 'fijados')      base = base.filter(u =>
      u.countrySource === 'override' || u.departmentSource === 'override' ||
      u.managerSource === 'override' || u.zoneSource === 'fijada');
    return base;
  }, [roster, busqueda, filtroPais, filtroDept, filtroJefe, pendiente]);

  const nombreDe = (id: string | null) => {
    const u = roster?.find(x => x.userId === id);
    return u ? `${u.firstName} ${u.lastName}` : null;
  };
  const filtrando = Boolean(busqueda.trim() || filtroPais || filtroDept || filtroJefe || pendiente !== 'todos');
  const limpiar = () => { setBusqueda(''); setFiltroPais(''); setFiltroDept(''); setFiltroJefe(''); setPendiente('todos'); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
        data-testid="personas-admin"
      >
        {/* Encabezado */}
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-gray-100 px-6 py-4">
          <span className="text-xl">👥</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-gray-800">Personas</h2>
            <p className="text-[11px] text-gray-400">
              País, departamento, jefe directo y zona del mapa de cada persona. El jefe es quien le aprueba las solicitudes.
            </p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-3 flex-shrink-0 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {roster === null ? (
            <p className="py-12 text-center text-xs text-gray-400">Cargando…</p>
          ) : (
            <>
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
                  <select value={filtroPais} onChange={e => setFiltroPais(e.target.value)} aria-label="Filtrar por país" className={FILTRO_CLS}>
                    <option value="">Todos los países</option>
                    {paises.map(c => <option key={c.iso} value={c.iso}>{c.flag} {c.name}</option>)}
                  </select>
                  <select value={filtroDept} onChange={e => setFiltroDept(e.target.value)} aria-label="Filtrar por departamento" className={FILTRO_CLS}>
                    <option value="">Todos los departamentos</option>
                    <option value="__sin__">— Sin departamento —</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name} ({d.headcount})</option>)}
                  </select>
                  <select value={filtroJefe} onChange={e => setFiltroJefe(e.target.value)} aria-label="Filtrar por jefe" className={FILTRO_CLS}>
                    <option value="">Todos los jefes</option>
                    <option value="__sin__">— Sin jefe —</option>
                    {jefes.map(j => <option key={j.userId} value={j.userId}>{j.firstName} {j.lastName}</option>)}
                  </select>
                  <select value={pendiente} onChange={e => setPendiente(e.target.value as Pendiente)} aria-label="Filtrar por estado del dato" className={FILTRO_CLS}>
                    {PENDIENTES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <p className="text-[11px] text-gray-500">
                  {lista.length} de {roster.length}
                  {filtrando && (
                    <button onClick={limpiar} className="ml-2 text-gray-400 underline hover:text-gray-600">limpiar filtros</button>
                  )}
                </p>
              </div>

              {/* ── Tabla ── */}
              {lista.length === 0 ? (
                <p className="py-10 text-center text-xs text-gray-400">
                  {filtrando ? 'Nadie coincide con esos filtros.' : 'No hay nadie en el equipo.'}
                </p>
              ) : (
                // Scroll horizontal propio: en un teléfono las columnas no entran,
                // y sin esto la página entera se desplaza de lado.
                <div className="-mx-1 overflow-x-auto px-1">
                  <table className="w-full min-w-[900px] border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200">
                        {['Persona', 'País', 'Departamento', 'Jefe directo', 'Sábados', 'Zona del mapa'].map(h => (
                          <th key={h} scope="col" className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map(u => (
                        <tr key={u.userId} className="border-b border-gray-50 align-top hover:bg-gray-50">
                          <td className="px-2 py-2">
                            <p className="truncate text-xs font-medium text-gray-700">{u.firstName} {u.lastName}</p>
                            <p className="truncate text-[10px] text-gray-400">{u.email}</p>
                          </td>

                          <td className="w-[22%] px-2 py-2">
                            <select
                              value={u.countrySource === 'override' ? (u.country ?? '') : ''}
                              disabled={savingUser === u.userId}
                              onChange={e => void onSetCountry(u.userId, e.target.value || null)}
                              aria-label={`País de ${u.firstName} ${u.lastName}`}
                              className={SELECT_CLS}
                            >
                              <option value="">Sin fijar ({defaultCountry})</option>
                              {COUNTRIES.map(c => <option key={c.iso} value={c.iso}>{c.flag} {c.name}</option>)}
                            </select>
                            {u.countrySource === 'override' && <OrigenChip tipo="override" texto="fijado por RRHH" />}
                            {u.countrySource === 'bitrix'   && <OrigenChip tipo="bitrix"   texto="desde Bitrix" />}
                            {u.countrySource === 'default'  && <OrigenChip tipo="vacio"    texto={`por defecto · ${countryOf(u.country ?? '').flag}`} />}
                          </td>

                          <td className="w-[22%] px-2 py-2">
                            <select
                              value={u.departmentSource === 'override' ? (u.departmentId ?? '') : ''}
                              disabled={savingUser === u.userId}
                              onChange={e => void onSetDepartment(u.userId, e.target.value || null)}
                              aria-label={`Departamento de ${u.firstName} ${u.lastName}`}
                              className={SELECT_CLS}
                            >
                              <option value="">Sin fijar</option>
                              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                            {u.departmentSource === 'override' && <OrigenChip tipo="override" texto="fijado por RRHH" />}
                            {u.departmentSource === 'bitrix'   && <OrigenChip tipo="bitrix"   texto={u.departmentName ?? 'desde Bitrix'} />}
                            {u.departmentSource === 'none'     && <OrigenChip tipo="vacio"    texto="sin departamento" />}
                          </td>

                          <td className="w-[24%] px-2 py-2">
                            <select
                              value={u.managerSource === 'override' ? (u.managerUserId ?? '') : ''}
                              disabled={savingUser === u.userId}
                              onChange={e => void onSetManager(u.userId, e.target.value || null)}
                              aria-label={`Jefe de ${u.firstName} ${u.lastName}`}
                              className={SELECT_CLS}
                            >
                              <option value="">Sin fijar</option>
                              {roster.filter(o => o.userId !== u.userId).map(o => (
                                <option key={o.userId} value={o.userId}>{o.firstName} {o.lastName}</option>
                              ))}
                            </select>
                            {u.managerSource === 'override' && <OrigenChip tipo="override" texto="fijado por RRHH" />}
                            {/* El jefe heredado del departamento se nombra: «desde Bitrix» a
                                secas obliga a cruzar la fila con otra para saber quién es. */}
                            {u.managerSource === 'bitrix'   && <OrigenChip tipo="bitrix" texto={nombreDe(u.managerUserId) ?? 'desde Bitrix'} />}
                            {u.managerSource === 'none'     && <OrigenChip tipo="vacio"  texto="sin jefe" />}
                            {/* Quién aprueba sus solicitudes: sin jefe, cae en RRHH. */}
                            <p className="mt-0.5 text-[9px] text-gray-400" data-testid={`aprueba-${u.userId}`}>
                              Aprueba sus solicitudes: {u.managerUserId ? (nombreDe(u.managerUserId) ?? 'su jefe') : 'RRHH'}
                            </p>
                          </td>

                          <td className="w-[11%] px-2 py-2">
                            {/* Hay gente que trabaja el sábado medio día: cuenta en sus vacaciones. */}
                            <select
                              value={String(u.sabado ?? 0)}
                              disabled={savingUser === u.userId}
                              onChange={e => void onSetSabado(u.userId, Number(e.target.value))}
                              aria-label={`Sábados de ${u.firstName} ${u.lastName}`}
                              className={SELECT_CLS}
                            >
                              <option value="0">No trabaja</option>
                              <option value="0.5">Medio día</option>
                              <option value="1">Día completo</option>
                            </select>
                          </td>

                          <td className="w-[17%] px-2 py-2">
                            <select
                              value={u.zoneId ?? ''}
                              disabled={savingUser === u.userId}
                              onChange={e => void onSetZone(u.userId, e.target.value || null)}
                              aria-label={`Zona del mapa de ${u.firstName} ${u.lastName}`}
                              className={SELECT_CLS}
                            >
                              <option value="">Sin zona</option>
                              {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                            </select>
                            {u.zoneSource === 'fijada'   && <OrigenChip tipo="override" texto="fijada por RRHH" />}
                            {/* La sugerida ya mueve el avatar; el chip dice que la dedujo el
                                sistema por parecido de nombre y conviene revisarla. */}
                            {u.zoneSource === 'sugerida' && <OrigenChip tipo="sugerida" texto="sugerida por el depto." />}
                            {u.zoneSource === 'none'     && <OrigenChip tipo="vacio"    texto="no aparece en el mapa" />}
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
                acá gana sobre lo automático y es lo que hay que usar para las excepciones.
                Corregir el <strong>departamento</strong> también cambia el jefe: pasa a ser quien dirija el
                departamento nuevo, salvo que se le haya fijado uno a mano. El <strong>jefe</strong> aprueba
                las solicitudes de ausencia; sin jefe, las aprueba RRHH.
                <br />
                El <strong>país</strong> decide qué feriados le tocan. <strong>Sábados</strong>: quien trabaja el sábado
                (medio día o completo) lo descuenta de sus vacaciones y puede reintegrarse ese día. La <strong>zona del mapa</strong> es
                independiente del departamento — alguien de Finanzas puede sentarse en Cobros. Cuando nadie la
                fijó, se sugiere la que calza por nombre con el departamento; elegirla en la lista la deja
                fijada. «Sin zona» significa que esa persona no aparece en el mapa.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
