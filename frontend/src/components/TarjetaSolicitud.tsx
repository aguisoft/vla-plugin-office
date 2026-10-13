import type { ReactNode } from 'react';
import { urlAdjunto } from '../api';
import { cfgOf } from '../statusConfig';
import { fmtDate, fmtTime, absenceLastDay } from '../format';
import { etiquetaSolicitud } from '../solicitudesUx';
import type { SolicitudAusencia } from '../types';

/**
 * Una solicitud en una lista: tipo, estado, cuándo, quién la resolvió, los
 * documentos y el motivo. La usan «Mis ausencias» y Administrar → Ausencias;
 * cada una pone abajo sus botones (`children`).
 */

function cuando(s: SolicitudAusencia): string {
  if (s.tipo === 'PERMISO' || s.tipo === 'CITA_MEDICA') {
    return `${fmtDate(s.startAt)}, de ${fmtTime(s.startAt)} a ${fmtTime(s.endAt)}`;
  }
  const desde = absenceLastDay(s.startAt);
  const hasta = absenceLastDay(s.endAt);
  return desde === hasta ? desde : `${desde} a ${hasta}`;
}

export function TarjetaSolicitud({ s, ahora, ajena = false, children }: {
  s: SolicitudAusencia;
  ahora: number;
  /** La mira RRHH, no la persona: «su jefe» en vez de «tu jefe». */
  ajena?: boolean;
  children?: ReactNode;
}) {
  const cfg = cfgOf(s.tipo);
  const et = etiquetaSolicitud(s, ahora, ajena);
  return (
    <div className="rounded-xl border border-gray-100 p-3" data-testid={`solicitud-${s.id}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${cfg.dot}`} />
        <span className={`text-xs font-semibold ${cfg.text}`}>{cfg.label}</span>
        {cfg.icon && <span className="text-xs">{cfg.icon}</span>}
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${et.clase}`}>{et.texto}</span>
      </div>
      <p className="mt-1 text-[11px] text-gray-500">{cuando(s)}</p>

      {s.estado === 'rechazada' && (
        <p className="mt-1 text-[11px] text-rose-700">
          {s.nombreResolvio ?? (ajena ? 'Su jefe' : 'Tu jefe')} no la aprobó{s.motivoResolucion ? `: «${s.motivoResolucion}»` : ''}
        </p>
      )}
      {s.estado === 'aprobada' && s.nombreResolvio && (
        <p className="mt-1 text-[10px] text-gray-400">Aprobada por {s.nombreResolvio}</p>
      )}
      {s.estado === 'cancelada' && s.motivoResolucion && (
        <p className="mt-1 text-[10px] text-gray-400">Cancelada: «{s.motivoResolucion}»</p>
      )}

      {!!s.adjuntos?.length && (
        <p className="mt-1 flex flex-wrap gap-2">
          {s.adjuntos.map(d => (
            <a key={d.id} href={urlAdjunto(d.id)} target="_blank" rel="noreferrer"
              className="text-[11px] text-sky-700 underline decoration-dotted underline-offset-2 hover:text-sky-900">📎 {d.nombre}</a>
          ))}
        </p>
      )}
      {s.justificacion && <p className="mt-1 text-[11px] italic text-gray-400">«{s.justificacion}»</p>}

      {children}
    </div>
  );
}
