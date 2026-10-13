import { useEffect, useState } from 'react';
import { getOrgRoster, listSolicitudesDe, cancelarSolicitud, createAbsence, getSaldoVacaciones, cargarSaldoVacaciones, ApiError } from '../api';
import { textoDias } from '../vacacionesUx';
import { fmtDateOnly } from '../format';
import { anulable, vigenteEnHistorial } from '../solicitudesUx';
import { cfgOf } from '../statusConfig';
import { TarjetaSolicitud } from './TarjetaSolicitud';
import { SolicitudDiasModal } from './SolicitudDiasModal';
import { PermisoModal } from './PermisoModal';
import type { DocAdjunto } from './AdjuntarDocs';
import type { RosterUser, SolicitudAusencia, SaldoVacaciones } from '../types';

/**
 * Administrar → Ausencias: RRHH anula o registra las ausencias de cualquier
 * persona. Antes el servidor ya lo permitía pero no había dónde hacerlo: un
 * jefe que aprobaba por error no tenía a quién recurrir, y una incapacidad
 * solo la podía cargar la persona misma (13-oct-2026).
 *
 * Anular pide siempre el motivo, porque le llega a la persona (el servidor lo
 * exige solo si ya empezó). Lo registrado nace aprobado. En los dos casos la
 * persona recibe aviso y correo, con copia a RRHH.
 */

const MIN_MOTIVO = 5;
const TIPOS = ['INCAPACIDAD', 'VACACIONES', 'PERMISO', 'CITA_MEDICA'] as const;
type Tipo = typeof TIPOS[number];

function mensaje(e: unknown, porDefecto: string): string {
  const d = e instanceof ApiError ? (e.detail as { message?: string; errors?: Array<{ message: string }> } | undefined) : undefined;
  return d?.errors?.[0]?.message ?? d?.message ?? porDefecto;
}

export function AusenciasAdmin({ onClose, onChanged }: {
  onClose: () => void;
  /** Tras anular o registrar, para que el mapa se refresque. */
  onChanged: () => void;
}) {
  const [gente, setGente] = useState<RosterUser[] | null>(null);
  const [userId, setUserId] = useState('');
  const [rows, setRows] = useState<SolicitudAusencia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [registrar, setRegistrar] = useState<Tipo | null>(null);
  const [verAnteriores, setVerAnteriores] = useState(false);
  const [saldoV, setSaldoV] = useState<SaldoVacaciones | null>(null);
  const [diasCarga, setDiasCarga] = useState('');
  const [motivoCarga, setMotivoCarga] = useState('');

  useEffect(() => {
    getOrgRoster()
      .then(r => setGente([...r.users].sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`))))
      .catch(e => { setGente([]); setError(mensaje(e, 'No se pudo cargar la lista de personas')); });
  }, []);

  const persona = gente?.find(u => u.userId === userId) ?? null;
  const nombre = persona ? `${persona.firstName} ${persona.lastName}` : '';

  const cargar = async (id: string) => {
    if (!id) { setRows(null); setSaldoV(null); return; }
    setRows(null);
    getSaldoVacaciones(id).then(setSaldoV).catch(() => setSaldoV(null));
    try {
      setRows(await listSolicitudesDe(id));
    } catch (e) {
      setRows([]);
      setError(mensaje(e, 'No se pudieron cargar sus solicitudes'));
    }
  };

  useEffect(() => {
    setAnulando(null); setMotivo(''); setHecho(null); setError(null); setVerAnteriores(false); setDiasCarga(''); setMotivoCarga('');
    void cargar(userId);
  }, [userId]);

  const anular = async (id: string) => {
    setOcupado(true);
    setError(null);
    try {
      await cancelarSolicitud(id, motivo.trim());
      setAnulando(null);
      setMotivo('');
      setHecho(`Anulada. A ${nombre} le llega un aviso y un correo, con copia a RRHH.`);
      await cargar(userId);
      onChanged();
    } catch (e) {
      setError(mensaje(e, 'No se pudo anular'));
    } finally {
      setOcupado(false);
    }
  };

  const registrarAusencia = async (type: Tipo, startAt: string, endAt: string, justification?: string, adjuntos?: DocAdjunto[]) => {
    setRegistrar(null);
    setOcupado(true);
    setError(null);
    setHecho(null);
    try {
      await createAbsence({ type, startAt, endAt, justification, adjuntos, userId });
      setHecho(`Registrada y aprobada. A ${nombre} le llega un aviso y un correo, con copia a RRHH.`);
      await cargar(userId);
      onChanged();
    } catch (e) {
      setError(mensaje(e, 'No se pudo registrar'));
    } finally {
      setOcupado(false);
    }
  };

  const guardarSaldo = async () => {
    const dias = Number(diasCarga.replace(',', '.'));
    if (!Number.isFinite(dias)) return;
    setOcupado(true);
    setError(null);
    setHecho(null);
    try {
      setSaldoV(await cargarSaldoVacaciones(userId, dias, motivoCarga.trim()));
      setDiasCarga('');
      setMotivoCarga('');
      setHecho(`Saldo guardado: desde hoy ${nombre} tiene ${textoDias(dias)}, y devenga 1,25 por mes.`);
    } catch (e) {
      setError(mensaje(e, 'No se pudo guardar el saldo'));
    } finally {
      setOcupado(false);
    }
  };

  const ahora = Date.now();
  const todas = rows ?? [];
  const vigentes = todas.filter(s => vigenteEnHistorial(s, ahora));
  const ocultas = todas.length - vigentes.length;
  // Lo que espera respuesta primero, después lo próximo, y lo pasado al final.
  const peso = (s: SolicitudAusencia) => (s.estado === 'pendiente' ? 0 : new Date(s.endAt).getTime() >= ahora ? 1 : 2);
  const lista = [...(verAnteriores ? todas : vigentes)].sort((a, b) =>
    peso(a) - peso(b) || new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  const para = persona ? { userId: persona.userId, nombre } : undefined;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
        <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
          onClick={e => e.stopPropagation()} data-testid="ausencias-admin">
          <div className="flex flex-shrink-0 items-center gap-3 border-b border-gray-100 px-6 py-4">
            <span className="text-xl">🗓️</span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-gray-800">Ausencias</h2>
              <p className="text-[11px] text-gray-400">
                Anulá o registrá las ausencias de cualquier persona. Le llega un aviso y un correo, con copia a RRHH.
              </p>
            </div>
            <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Persona
              <select value={userId} onChange={e => setUserId(e.target.value)} aria-label="Persona" disabled={gente === null}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-normal normal-case tracking-normal text-gray-700 focus:border-gray-400 focus:outline-none">
                <option value="">{gente === null ? 'Cargando…' : 'Elegí a alguien…'}</option>
                {(gente ?? []).map(u => <option key={u.userId} value={u.userId}>{u.firstName} {u.lastName}</option>)}
              </select>
            </label>

            {error && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
            {hecho && <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700" data-testid="ausencias-hecho">{hecho}</div>}

            {persona && (
              <>
                <div className="mt-4 rounded-2xl border border-gray-100 p-3" data-testid="saldo-admin">
                  <p className="text-[11px] font-semibold text-gray-700">Saldo de vacaciones</p>
                  {saldoV === null ? <p className="mt-1 text-[11px] text-gray-400">Cargando…</p>
                    : saldoV.cargado ? (
                      <>
                        <p className="mt-1 text-xs text-gray-700">
                          Disponible: <strong>{textoDias(saldoV.disponible)}</strong>
                          {saldoV.apartados > 0 && <span className="text-gray-400"> · {textoDias(saldoV.apartados)} apartados por pedidos sin responder</span>}
                        </p>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-gray-400">
                          {saldoV.cargadoPor ?? 'RRHH'} cargó {textoDias(saldoV.inicial)} el {fmtDateOnly(saldoV.corte)}{saldoV.motivo ? ` («${saldoV.motivo}»)` : ''}.
                          {[
                            saldoV.devengado > saldoV.inicial && `devengó ${textoDias(saldoV.devengado - saldoV.inicial)}`,
                            saldoV.tomados > 0 && `se le descuentan ${textoDias(saldoV.tomados)} de vacaciones aprobadas`,
                          ].filter(Boolean).join(' y ').replace(/^./, m => ` Desde entonces ${m}`)}{saldoV.devengado > saldoV.inicial || saldoV.tomados > 0 ? '.' : ''}
                        </p>
                      </>
                    ) : <p className="mt-1 text-[11px] text-amber-700">Todavía no tiene saldo cargado: puede pedir vacaciones sin tope.</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <input value={diasCarga} onChange={e => setDiasCarga(e.target.value)} inputMode="decimal" aria-label="Días que tiene hoy"
                      placeholder="Días que tiene hoy" className="w-36 rounded-xl border border-gray-200 px-2.5 py-1.5 text-xs focus:border-gray-400 focus:outline-none" />
                    <input value={motivoCarga} onChange={e => setMotivoCarga(e.target.value)} aria-label="De dónde sale el número"
                      placeholder="De dónde sale (opcional)" className="min-w-0 flex-1 rounded-xl border border-gray-200 px-2.5 py-1.5 text-xs focus:border-gray-400 focus:outline-none" />
                    <button onClick={() => void guardarSaldo()} disabled={ocupado || !diasCarga.trim() || !Number.isFinite(Number(diasCarga.replace(',', '.')))}
                      data-testid="guardar-saldo"
                      className="rounded-xl bg-gray-900 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40">
                      {saldoV?.cargado ? 'Corregir saldo' : 'Guardar saldo'}
                    </button>
                  </div>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-gray-400">
                    Los días que tiene hoy, sin contar las vacaciones que ya tiene aprobadas en la oficina de hoy en adelante: esas se descuentan solas.
                    Sin saldo suficiente no puede pedir vacaciones.
                  </p>
                </div>

                <div className="mt-3 rounded-2xl border border-gray-100 p-3" data-testid="registrar-ausencia">
                  <p className="text-[11px] font-semibold text-gray-700">Registrar una ausencia de {persona.firstName}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {TIPOS.map(t => {
                      const cfg = cfgOf(t);
                      return (
                        <button key={t} onClick={() => setRegistrar(t)} disabled={ocupado} data-testid={`registrar-${t}`}
                          className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-2.5 py-1.5 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                          <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />{cfg.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[10px] text-gray-400">Queda aprobada al registrarla: no pasa por su jefe.</p>
                </div>

                <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Sus solicitudes</p>
                {rows === null && <p className="py-6 text-center text-xs text-gray-400">Cargando…</p>}
                {rows !== null && lista.length === 0 && (
                  <p className="py-6 text-center text-xs text-gray-400">No tiene solicitudes recientes.</p>
                )}
                <div className="space-y-2" data-testid="solicitudes-de">
                  {lista.map(s => (
                    <TarjetaSolicitud key={s.id} s={s} ahora={ahora} ajena>
                      {anulable(s) && anulando !== s.id && (
                        <button onClick={() => { setAnulando(s.id); setMotivo(''); setError(null); setHecho(null); }} disabled={ocupado}
                          data-testid={`anular-${s.id}`}
                          className="mt-2 rounded-xl px-2 py-1 text-[11px] font-medium text-red-500 hover:bg-red-50 disabled:opacity-50">
                          Anular
                        </button>
                      )}
                      {anulable(s) && anulando === s.id && (
                        <div className="mt-2 rounded-xl bg-red-50 p-2.5">
                          <p className="text-[11px] text-red-700">
                            Se quita de la oficina y queda en su historial como cancelada.
                          </p>
                          <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2} aria-label="Motivo"
                            placeholder="Por qué se anula (se lo vamos a decir a la persona)"
                            className="mt-1.5 w-full resize-none rounded-xl border border-red-100 bg-white p-2 text-xs text-gray-700 focus:border-red-300 focus:outline-none" />
                          <div className="mt-1.5 flex items-center justify-end gap-2">
                            <button onClick={() => setAnulando(null)} disabled={ocupado}
                              className="rounded-xl px-2 py-1 text-[11px] text-gray-500 hover:bg-white disabled:opacity-50">Volver</button>
                            <button onClick={() => void anular(s.id)} disabled={ocupado || motivo.trim().length < MIN_MOTIVO}
                              data-testid={`confirmar-anular-${s.id}`}
                              className="rounded-xl bg-red-500 px-2.5 py-1 text-[11px] font-semibold text-white disabled:bg-red-300">
                              {ocupado ? 'Anulando…' : 'Anular'}
                            </button>
                          </div>
                        </div>
                      )}
                    </TarjetaSolicitud>
                  ))}
                </div>
                {ocultas > 0 && (
                  <button onClick={() => setVerAnteriores(v => !v)} className="mt-3 text-[10px] text-gray-500 underline hover:text-gray-700">
                    {verAnteriores ? 'Ocultar las de hace más de un mes' : `Mostrar ${ocultas} de hace más de un mes`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Fuera del fondo de arriba: un clic en el fondo de estos no cierra Ausencias. */}
      {registrar && para && (registrar === 'VACACIONES' || registrar === 'INCAPACIDAD') && (
        <SolicitudDiasModal status={registrar} para={para} onClose={() => setRegistrar(null)}
          onConfirm={(startAt, endAt, justification, adjuntos) => void registrarAusencia(registrar, startAt, endAt, justification, adjuntos)} />
      )}
      {registrar && para && (registrar === 'PERMISO' || registrar === 'CITA_MEDICA') && (
        <PermisoModal status={registrar} para={para} onClose={() => setRegistrar(null)}
          onConfirm={(startAt, endAt, justification, adjuntos) => void registrarAusencia(registrar, startAt, endAt, justification, adjuntos)} />
      )}
    </>
  );
}
