import { useEffect, useState } from 'react';
import { getUsoAusencias } from '../api';
import type { UsoAusencias } from '../types';

/**
 * Consumo del mes de una persona: la hora de permiso y las citas médicas con
 * su exceso. Lo usa el líder para saber si su gente ya agotó el mes.
 *
 * Si el backend responde 403 no se dibuja nada: la autorización la decide el
 * servidor (uno mismo, el jefe directo o RRHH) y el frontend no la duplica.
 */
export function ResumenMes({ userId, className = '' }: { userId?: string; className?: string }) {
  const [uso, setUso] = useState<UsoAusencias | null>(null);

  useEffect(() => {
    let vivo = true;
    setUso(null);
    getUsoAusencias(userId)
      .then(u => { if (vivo) setUso(u); })
      .catch(() => { /* sin permiso o sin red: no se muestra */ });
    return () => { vivo = false; };
  }, [userId]);

  if (!uso) return null;
  const sinNada = uso.permisoMin === 0 && uso.citas.length === 0;
  if (sinNada) return null;

  return (
    <div className={`rounded-lg bg-gray-50 px-2.5 py-1.5 text-[10px] text-gray-600 ${className}`}>
      {uso.permisoMin > 0 && (
        <p className={uso.permisoExcedido ? 'text-amber-700' : ''}>
          Permiso este mes: <strong>{uso.permisoMin}</strong> de {uso.permisoTopeMin} min
          {uso.permisoExcedido && ' · pasó el tope'}
        </p>
      )}
      {uso.citas.length > 0 && (
        <p className={uso.citasExcesoMin > 0 ? 'text-amber-700' : ''}>
          {uso.citas.length === 1 ? '1 cita médica' : `${uso.citas.length} citas médicas`}
          {uso.citasExcesoMin > 0
            ? <> · {uso.citasExcesoMin} min sobre las 3 h</>
            : <> · dentro de las 3 h</>}
        </p>
      )}
    </div>
  );
}
