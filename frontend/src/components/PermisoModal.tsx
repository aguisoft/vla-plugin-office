import { useEffect, useState } from 'react';
import { MIN_JUSTIFICATION, cfgOf } from '../statusConfig';
import { getUsoAusencias } from '../api';
import type { UsoAusencias } from '../types';
import { Shell, DateField, TimeField, Actions, missingLabel } from './modalParts';
import { AdjuntarDocs, type DocAdjunto } from './AdjuntarDocs';

/**
 * Permiso es una ausencia corta dentro de un mismo día: fecha + rango de
 * hora, más justificación obligatoria. Los dos instantes se arman sobre esa
 * misma fecha, así que el backend nunca recibe un permiso que cruce de día.
 */
export function PermisoModal({ status, onClose, onConfirm }: {
  /** PERMISO o CITA_MEDICA: el mismo formulario, distinto encabezado. */
  status: string;
  onClose: () => void;
  onConfirm: (startAt: string, endAt: string, justification: string, adjuntos?: DocAdjunto[]) => void;
}) {
  const [date, setDate] = useState('');
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('10:00');
  const [text, setText] = useState('');
  const [docs, setDocs] = useState<DocAdjunto[]>([]);
  const missing = Math.max(0, MIN_JUSTIFICATION - text.trim().length);
  const timeInvalid = to <= from;
  const invalid = !date || timeInvalid || missing > 0;

  // Saldo del mes, solo para PERMISO: la cita médica no tiene tope mensual,
  // su límite es por cita y lo vigila el cronómetro.
  const [uso, setUso] = useState<UsoAusencias | null>(null);
  useEffect(() => {
    if (status !== 'PERMISO') return;
    let vivo = true;
    getUsoAusencias()
      .then(u => { if (vivo) setUso(u); })
      .catch(() => { /* el saldo es informativo: sin él se puede pedir igual */ });
    return () => { vivo = false; };
  }, [status]);

  const minutosPedidos = (() => {
    const [h1, m1] = from.split(':').map(Number);
    const [h2, m2] = to.split(':').map(Number);
    const d = (h2 * 60 + m2) - (h1 * 60 + m1);
    return d > 0 ? d : 0;
  })();
  const seExcede = !!uso && uso.permisoMin + minutosPedidos > uso.permisoTopeMin;

  const toIso = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(`${date}T00:00:00`);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };

  return (
    <Shell title={cfgOf(status).label} onClose={onClose}>
      <DateField label="Fecha" value={date} onChange={setDate} />
      <div className="mt-3 flex items-center gap-2">
        <TimeField label="Desde" value={from} onChange={setFrom} />
        <TimeField label="Hasta" value={to} onChange={setTo} />
      </div>
      {timeInvalid && <p className="mt-2 text-xs text-red-500">La hora de fin debe ser posterior.</p>}
      {/* Saldo del mes. Avisa, no bloquea: una urgencia real no se resuelve
          con una validación, y el dato queda para que el líder lo converse. */}
      {status === 'PERMISO' && uso && (
        <div className={`mt-3 rounded-xl px-3 py-2 text-[11px] ${
          seExcede ? 'bg-amber-50 text-amber-800' : 'bg-gray-50 text-gray-600'}`}>
          Llevás <strong>{uso.permisoMin} min</strong> de {uso.permisoTopeMin} este mes
          {!seExcede && uso.permisoRestanteMin > 0 && <> · quedan {uso.permisoRestanteMin}</>}
          {seExcede && (
            <p className="mt-1">
              ⚠ Con este permiso superás la hora del mes. Se registra igual y tu
              líder lo va a ver.
            </p>
          )}
        </div>
      )}
      <textarea
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        className="mt-3 w-full resize-none rounded-xl border border-gray-200 p-2.5 text-xs focus:border-gray-400 focus:outline-none"
        placeholder={status === 'CITA_MEDICA' ? 'Cita de control de mi hijo' : 'Trámite personal en la tarde'}
      />
      <AdjuntarDocs docs={docs} onChange={setDocs} />
      <Actions
        onClose={onClose}
        disabled={invalid}
        confirmLabel={missing > 0 ? missingLabel(missing) : 'Confirmar'}
        onConfirm={() => onConfirm(toIso(from), toIso(to), text.trim(), docs)}
      />
    </Shell>
  );
}
