import { useEffect, useState } from 'react';
import { listMovableHolidays, listMisSolicitudesFeriado, retirarSolicitudFeriado, getResumenAusencia, ApiError } from '../api';
import { MIN_JUSTIFICATION } from '../statusConfig';
import { fmtDateOnly, monthName, hoyLocal } from '../format';
import { Shell, Actions, missingLabel } from './modalParts';
import { semanasDelMes, motivoNoElegible, solicitudVigente } from '../feriadosUx';
import type { Holiday, SolicitudFeriado } from '../types';

/**
 * El colaborador PIDE tomar un feriado otro día del mismo mes (p. ej. trabajar
 * el 15 por cierre de mes y tomarlo el 25). Es una solicitud, no un hecho: la
 * aprueba su jefe directo, y hasta entonces el feriado sigue en su fecha
 * original. Toda la redacción de esta pantalla sostiene esa diferencia — decir
 * "listo" cuando todavía falta el visto bueno haría que alguien no viniera a
 * trabajar un día que no tiene libre.
 *
 * Reglas (las mismas del servidor, ver feriadosUx.ts): se pide ANTES del
 * feriado —el 12-oct-2026 llegó un pedido hecho el mismo día y «a» ese mismo
 * día—, y el día nuevo es hábil, del mismo mes, futuro y no feriado. Por eso
 * el día se elige en un calendario del mes con lo que no vale apagado, en vez
 * del `<input type="date">`, que dejaba elegir fines de semana y días pasados.
 */
export function HolidayOverrideModal({ onClose, onConfirm }: {
  onClose: () => void;
  onConfirm: (holidayId: string, newDate: string, justification: string) => void;
}) {
  const [holidays, setHolidays] = useState<Holiday[] | null>(null);
  const [solicitudes, setSolicitudes] = useState<SolicitudFeriado[]>([]);
  const [holidayId, setHolidayId] = useState('');
  const [newDate, setNewDate] = useState('');
  const [text, setText] = useState('');
  const hoy = hoyLocal();
  // Lo que trabaja el sábado: quien lo trabaja puede tomar el feriado ese día.
  const [sabado, setSabado] = useState(0);
  useEffect(() => {
    void getResumenAusencia(hoy, hoy).then(r => setSabado(r.sabado)).catch(() => undefined);
  }, [hoy]);

  const cargarSolicitudes = () =>
    // El historial es accesorio: si falla, el modal sigue sirviendo para pedir.
    void listMisSolicitudesFeriado().then(setSolicitudes).catch(() => setSolicitudes([]));

  useEffect(() => {
    // El servidor ya devuelve solo los que todavía no llegaron.
    void listMovableHolidays()
      .then(h => {
        setHolidays(h);
        if (h.length === 1) setHolidayId(h[0].id);
      })
      .catch(() => setHolidays([]));
    cargarSolicitudes();
  }, []);

  const chosen = holidays?.find(h => h.id === holidayId);
  const fechaFeriado = chosen?.date.slice(0, 10) ?? '';
  const otrosFeriados = (holidays ?? []).filter(h => h.id !== holidayId).map(h => h.date.slice(0, 10));
  const missing = Math.max(0, MIN_JUSTIFICATION - text.trim().length);
  const ready = !!chosen && !!newDate && missing === 0;
  const vigentes = solicitudes.filter(s => solicitudVigente(s, hoy));

  if (holidays && holidays.length === 0) {
    return (
      <Shell title="Mover un feriado" onClose={onClose}>
        <p className="text-xs text-gray-500">
          No tenés feriados próximos para mover. Un feriado se puede cambiar de día solo
          antes de que llegue, y cada uno una vez.
        </p>
        <Historial solicitudes={vigentes} hoy={hoy} onCambio={cargarSolicitudes} />
      </Shell>
    );
  }

  return (
    <Shell title="Mover un feriado" onClose={onClose}>
      <p className="mb-3 text-[10px] leading-relaxed text-gray-500">
        Trabajás el feriado y lo tomás otro día del mismo mes. Lo aprueba tu jefe
        directo; hasta que responda, el feriado sigue en su fecha original.
      </p>

      {(holidays?.length ?? 0) > 1 && (
        <select
          value={holidayId}
          onChange={e => { setHolidayId(e.target.value); setNewDate(''); }}
          aria-label="Feriado"
          className="mb-3 w-full rounded-xl border border-gray-200 p-2 text-xs"
        >
          <option value="">Elegí el feriado…</option>
          {holidays?.map(h => (
            <option key={h.id} value={h.id}>{h.name} — {fmtDateOnly(h.date)}</option>
          ))}
        </select>
      )}

      {chosen && (
        <>
          <p className="mb-2 text-xs text-gray-700">
            <span className="font-semibold">{chosen.name}</span> · {fmtDateOnly(chosen.date)}
          </p>
          <p className="mb-1 text-[11px] text-gray-500">
            ¿Qué día de {monthName(chosen.date)} lo tomás?
          </p>
          <CalendarioMes
            feriado={fechaFeriado}
            elegido={newDate}
            onElegir={setNewDate}
            motivo={f => motivoNoElegible(f, { hoy, feriado: fechaFeriado, otrosFeriados, sabado })}
          />
          <p className="mt-1 text-[10px] text-gray-400">
            Días hábiles de {monthName(chosen.date)}{sabado > 0 ? ' (con los sábados, que trabajás)' : ''} que todavía no pasaron. Podés pedirlo
            hasta el día anterior al feriado.
          </p>
        </>
      )}

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={2}
        aria-label="Motivo"
        placeholder="Trabajo el feriado por cierre de mes y lo tomo el 25"
        className="mt-3 w-full resize-none rounded-xl border border-gray-200 p-2.5 text-xs"
      />
      <Actions
        onClose={onClose}
        disabled={!ready}
        confirmLabel={!chosen ? 'Elegí el feriado' : !newDate ? 'Elegí el día' : missing > 0 ? missingLabel(missing) : 'Enviar solicitud'}
        onConfirm={() => onConfirm(holidayId, newDate, text.trim())}
      />
      <Historial solicitudes={vigentes} hoy={hoy} onCambio={cargarSolicitudes} />
    </Shell>
  );
}

const DIAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** El mes del feriado; los días que no se pueden elegir quedan apagados con su motivo. */
function CalendarioMes({ feriado, elegido, onElegir, motivo }: {
  feriado: string;
  elegido: string;
  onElegir: (fecha: string) => void;
  motivo: (fecha: string) => string | null;
}) {
  return (
    <div className="rounded-xl border border-gray-100 p-2" data-testid="calendario-feriado">
      <div className="mb-1 grid grid-cols-7 text-center text-[9px] font-semibold text-gray-400">
        {DIAS.map((d, i) => <span key={i}>{d}</span>)}
      </div>
      {semanasDelMes(feriado).map((semana, i) => (
        <div key={i} className="grid grid-cols-7 gap-0.5">
          {semana.map((d, j) => {
            if (!d) return <span key={j} />;
            const no = motivo(d.fecha);
            const esFeriado = d.fecha === feriado;
            const sel = d.fecha === elegido;
            return (
              <button
                key={j}
                type="button"
                disabled={!!no}
                title={no ?? 'Tomarlo este día'}
                onClick={() => onElegir(d.fecha)}
                data-testid={`dia-${d.fecha}`}
                className={`h-7 rounded-lg text-[11px] ${
                  sel ? 'bg-gray-900 font-semibold text-white'
                  : esFeriado ? 'bg-amber-50 font-semibold text-amber-700'
                  : no ? 'cursor-not-allowed text-gray-300'
                  : 'text-gray-700 hover:bg-gray-100'}`}
              >
                {d.dia}
              </button>
            );
          })}
        </div>
      ))}
      <p className="mt-1.5 flex items-center gap-1.5 text-[9px] text-gray-400">
        <span className="inline-block h-2 w-2 rounded-sm bg-amber-100" /> el feriado
      </p>
    </div>
  );
}

const ETIQUETA: Record<SolicitudFeriado['status'], { texto: string; clase: string }> = {
  PENDING:  { texto: 'Esperando a tu jefe', clase: 'bg-amber-50 text-amber-700' },
  APPROVED: { texto: 'Aprobada',            clase: 'bg-emerald-50 text-emerald-700' },
  REJECTED: { texto: 'Rechazada',           clase: 'bg-rose-50 text-rose-700' },
};

/**
 * Las solicitudes propias que todavía importan (pendientes, o de hace menos
 * de un mes). Se muestra la nota del jefe solo cuando rechazó: quien se quedó
 * sin mover su feriado tiene que poder leer por qué sin preguntar. Una
 * pendiente se puede retirar mientras el feriado no llegue.
 */
function Historial({ solicitudes, hoy, onCambio }: { solicitudes: SolicitudFeriado[]; hoy: string; onCambio: () => void }) {
  const [error, setError] = useState<string | null>(null);
  if (solicitudes.length === 0) return null;

  async function retirar(s: SolicitudFeriado) {
    setError(null);
    try {
      await retirarSolicitudFeriado(s.holidayId);
      onCambio();
    } catch (e) {
      setError(e instanceof ApiError ? ((e.detail as { message?: string } | undefined)?.message ?? 'No se pudo retirar') : 'No se pudo retirar');
    }
  }

  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-gray-400">
        Tus solicitudes
      </p>
      {error && <p className="mb-2 text-[10px] text-red-600">{error}</p>}
      <ul className="space-y-2">
        {solicitudes.map(s => {
          const e = ETIQUETA[s.status];
          const retirable = s.status === 'PENDING' && !!s.holidayDate && s.holidayDate.slice(0, 10) > hoy;
          return (
            <li key={s.id} className="text-[11px] text-gray-600">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate">
                  {/* El feriado pudo borrarse después de pedir el traslado: se
                      dice, en vez de dejar un guion que no explica nada. */}
                  {s.holidayName ?? 'Feriado que ya no existe'} → {fmtDateOnly(s.newDate)}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${e.clase}`}>
                  {e.texto}
                </span>
              </div>
              {retirable && (
                <button onClick={() => void retirar(s)} className="mt-0.5 text-[10px] text-gray-500 underline hover:text-gray-700">
                  Retirar pedido
                </button>
              )}
              {s.status === 'REJECTED' && s.decisionNote && (
                <p className="mt-0.5 text-[10px] text-gray-500">Motivo: {s.decisionNote}</p>
              )}
              {s.sinRevisor && (
                <p className="mt-0.5 text-[10px] text-gray-400">
                  Quedó aprobada directamente: estás en la cima del organigrama.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
