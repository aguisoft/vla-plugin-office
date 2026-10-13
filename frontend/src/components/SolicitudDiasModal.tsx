import { useEffect, useMemo, useState } from 'react';
import { AdjuntarDocs, type DocAdjunto } from './AdjuntarDocs';
import { MIN_JUSTIFICATION, cfgOf } from '../statusConfig';
import { missingLabel } from './modalParts';
import { getResumenAusencia, type ResumenAusencia } from '../api';
import { hoyLocal } from '../format';
import { semanasDelMes } from '../feriadosUx';
import {
  elegirDia, rangoDe, moverMes, limitesMes, nombreMes, fechaEnPalabras, esFinDeSemana, textoDias, type Seleccion,
} from '../vacacionesUx';

/**
 * Pedir vacaciones (o cargar una incapacidad) con calendario. Antes eran dos
 * campos de fecha sueltos; ahora se tocan el primer y el último día, y abajo
 * aparece la ficha del formulario de papel de RRHH: desde, hasta, total de
 * días hábiles (sin fines de semana ni los feriados de la persona), el día que
 * se reintegra, comentarios y quién la aprueba.
 *
 * Las fechas viajan como `YYYY-MM-DD` puras (ver la nota del contrato de
 * POST /absences): nada de `Date` del navegador acá.
 */

const DIAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export function SolicitudDiasModal({ status, onClose, onConfirm }: {
  status: string;
  onClose: () => void;
  onConfirm: (startAt: string, endAt: string, justification?: string, adjuntos?: DocAdjunto[]) => void;
}) {
  const hoy = hoyLocal();
  const esVacaciones = status === 'VACACIONES';
  const cfg = cfgOf(status);
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const [sel, setSel] = useState<Seleccion>({ desde: null, hasta: null });
  const [texto, setTexto] = useState('');
  const [docs, setDocs] = useState<DocAdjunto[]>([]);
  // Feriados del mes a la vista (para marcarlos) y el resumen de lo elegido.
  const [delMes, setDelMes] = useState<ResumenAusencia | null>(null);
  const [resumen, setResumen] = useState<ResumenAusencia | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Vacaciones: de hoy en adelante. Incapacidad: se carga a veces después, hasta 60 días atrás.
  const minimo = useMemo(() => {
    if (esVacaciones) return hoy;
    const d = new Date(`${hoy}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 60);
    return d.toISOString().slice(0, 10);
  }, [esVacaciones, hoy]);

  useEffect(() => {
    const l = limitesMes(mes);
    let vivo = true;
    getResumenAusencia(l.desde, l.hasta).then(r => { if (vivo) setDelMes(r); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [mes]);

  const rango = rangoDe(sel);
  useEffect(() => {
    if (!rango) { setResumen(null); return; }
    let vivo = true;
    setCargando(true);
    setError(null);
    getResumenAusencia(rango.desde, rango.hasta)
      .then(r => { if (vivo) setResumen(r); })
      .catch(() => { if (vivo) { setResumen(null); setError('No se pudieron calcular los días'); } })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [rango?.desde, rango?.hasta]);

  const feriados = new Map((delMes?.feriados ?? []).map(f => [f.fecha, f.nombre]));
  const aprobador = (resumen ?? delMes)?.aprobador;
  const faltan = esVacaciones ? 0 : Math.max(0, MIN_JUSTIFICATION - texto.trim().length);
  const sinHabiles = !!resumen && resumen.diasHabiles === 0;
  const invalido = !rango || cargando || sinHabiles || faltan > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()} data-testid="solicitud-dias">
        <div className="mb-3 flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
          <h2 className="text-sm font-semibold text-gray-800">{esVacaciones ? 'Solicitar vacaciones' : 'Cargar una incapacidad'}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="ml-auto text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {/* ── Calendario ── */}
        <div className="rounded-xl border border-gray-100 p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <button type="button" onClick={() => setMes(m => moverMes(m, -1))} disabled={limitesMes(mes).desde <= minimo}
              aria-label="Mes anterior" className="rounded-lg px-2 py-0.5 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-30">‹</button>
            <span className="text-xs font-semibold text-gray-700" data-testid="mes-calendario">{nombreMes(mes)}</span>
            <button type="button" onClick={() => setMes(m => moverMes(m, 1))}
              aria-label="Mes siguiente" className="rounded-lg px-2 py-0.5 text-sm text-gray-500 hover:bg-gray-100">›</button>
          </div>
          <div className="mb-1 grid grid-cols-7 text-center text-[9px] font-semibold text-gray-400">
            {DIAS.map((d, i) => <span key={i}>{d}</span>)}
          </div>
          {semanasDelMes(`${mes}-01`).map((semana, i) => (
            <div key={i} className="grid grid-cols-7 gap-0.5">
              {semana.map((d, j) => {
                if (!d) return <span key={j} />;
                const pasado = d.fecha < minimo;
                const feriado = feriados.get(d.fecha);
                const extremo = !!rango && (d.fecha === rango.desde || d.fecha === rango.hasta);
                const dentro = !!rango && d.fecha > rango.desde && d.fecha < rango.hasta;
                const noHabil = esFinDeSemana(d.fecha) || !!feriado;
                return (
                  <button key={j} type="button" disabled={pasado} onClick={() => setSel(s => elegirDia(s, d.fecha))}
                    data-testid={`dia-${d.fecha}`}
                    title={pasado ? (esVacaciones ? 'Ya pasó' : 'Demasiado atrás') : feriado ? `Feriado: ${feriado} (no se cuenta)` : noHabil ? 'Fin de semana (no se cuenta)' : undefined}
                    className={`h-8 rounded-lg text-[11px] transition-colors ${
                      extremo ? 'bg-gray-900 font-semibold text-white'
                      : dentro ? (noHabil ? 'bg-sky-50 text-gray-400' : 'bg-sky-100 font-medium text-sky-900')
                      : pasado ? 'cursor-not-allowed text-gray-200'
                      : feriado ? 'bg-amber-50 font-semibold text-amber-700 hover:bg-amber-100'
                      : noHabil ? 'text-gray-400 hover:bg-gray-100'
                      : d.fecha === hoy ? 'font-semibold text-sky-700 ring-1 ring-sky-200 hover:bg-gray-100'
                      : 'text-gray-700 hover:bg-gray-100'}`}>
                    {d.dia}
                  </button>
                );
              })}
            </div>
          ))}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-gray-400">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-amber-100" /> feriado</span>
            <span>Sábados, domingos y feriados no se cuentan.</span>
          </p>
        </div>
        <p className="mt-1.5 text-[10px] text-gray-500">
          {!rango ? 'Tocá el primer día y después el último.' : !sel.hasta ? 'Tocá el último día (o dejalo así para un solo día).' : 'Tocá otro día para empezar de nuevo.'}
        </p>

        {/* ── La ficha (el formulario de papel de RRHH) ── */}
        {rango && (
          <dl className="mt-3 divide-y divide-gray-50 rounded-xl bg-gray-50/70 px-3 py-1 text-[11px]" data-testid="ficha-solicitud">
            <div className="flex justify-between gap-3 py-1.5"><dt className="text-gray-500">Desde</dt><dd className="font-medium text-gray-800">{fechaEnPalabras(rango.desde)}</dd></div>
            <div className="flex justify-between gap-3 py-1.5"><dt className="text-gray-500">Hasta</dt><dd className="font-medium text-gray-800">{fechaEnPalabras(rango.hasta)}</dd></div>
            <div className="flex justify-between gap-3 py-1.5">
              <dt className="text-gray-500">Total</dt>
              <dd className="text-right font-semibold text-gray-800" data-testid="total-dias">
                {cargando ? 'Calculando…' : resumen ? (
                  <>
                    {textoDias(resumen.diasHabiles)}
                    {resumen.diasCorridos !== resumen.diasHabiles && <span className="ml-1 font-normal text-gray-400">({textoDias(resumen.diasCorridos, 'corrido')})</span>}
                  </>
                ) : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-3 py-1.5">
              <dt className="text-gray-500">Me reintegro</dt>
              <dd className="font-medium text-gray-800" data-testid="reintegro">{resumen ? fechaEnPalabras(resumen.reintegro) : '—'}</dd>
            </div>
            {resumen && resumen.feriados.filter(f => f.fecha >= rango.desde && f.fecha <= rango.hasta).map(f => (
              <div key={f.fecha} className="flex justify-between gap-3 py-1.5 text-amber-700">
                <dt>Feriado en el medio</dt><dd>{fechaEnPalabras(f.fecha)} · {f.nombre}</dd>
              </div>
            ))}
          </dl>
        )}
        {sinHabiles && <p className="mt-2 text-[11px] text-red-600">Ese rango no tiene días hábiles: son fines de semana o feriados.</p>}
        {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}

        {/* ── Comentarios ── */}
        <label className="mt-3 block text-[10px] font-medium text-gray-500">
          {esVacaciones ? 'Comentarios (opcional)' : 'Motivo'}
          <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={2}
            className="mt-1 w-full resize-none rounded-xl border border-gray-200 p-2.5 text-xs font-normal text-gray-700 focus:border-gray-400 focus:outline-none"
            placeholder={esVacaciones ? 'Algo que tu jefe o RRHH deban saber' : 'Reposo médico por 5 días, adjunto la boleta de incapacidad'} />
        </label>
        {!esVacaciones && <AdjuntarDocs docs={docs} onChange={setDocs} />}

        {/* ── Quién aprueba ── */}
        <p className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-[10px] leading-relaxed text-sky-900" data-testid="quien-aprueba">
          {aprobador
            ? <>Las aprueba <strong>{aprobador.nombre}</strong>, tu jefe directo.</>
            : <>No tenés jefe directo asignado: las aprueba <strong>RRHH</strong>.</>}
          {esVacaciones
            ? ' Hasta que las apruebe no valen. La respuesta te llega por la oficina y por correo, con copia a RRHH.'
            : ' La incapacidad vale desde ya; tu jefe la aprueba después.'}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100">Cancelar</button>
          <button disabled={invalido} data-testid="enviar-solicitud"
            onClick={() => rango && onConfirm(rango.desde, rango.hasta, texto.trim() || undefined, esVacaciones ? undefined : docs)}
            className="rounded-xl bg-gray-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-40">
            {faltan > 0 ? missingLabel(faltan) : esVacaciones ? 'Enviar solicitud' : 'Cargar incapacidad'}
          </button>
        </div>
      </div>
    </div>
  );
}
