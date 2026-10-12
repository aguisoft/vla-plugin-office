import { useEffect, useState } from 'react';
import { listMovableHolidays } from '../api';
import { fmtDateOnly, hoyLocal } from '../format';
import { haceDias } from '../feriadosUx';
import type { Holiday } from '../types';

/**
 * Aviso de feriado próximo: «El lunes 12 es feriado (…). ¿Lo vas a trabajar?».
 * Antes, mover un feriado estaba escondido en el selector de estado, y el
 * 12-oct-2026 Esteban no sabía que tenía que pedirlo. Aparece desde 7 días
 * antes y hasta el día anterior (después ya no se puede pedir), solo para los
 * feriados que la persona todavía puede mover; se cierra por feriado.
 */
const CLAVE = 'office.avisoFeriado.cerrados';

function cerrados(): string[] {
  try { return JSON.parse(localStorage.getItem(CLAVE) ?? '[]'); } catch { return []; }
}

export function AvisoFeriado({ onMover }: { onMover: () => void }) {
  const [feriado, setFeriado] = useState<Holiday | null>(null);

  useEffect(() => {
    const hoy = hoyLocal();
    // «En 7 días» = hasta hoy + 7.
    const limite = haceDias(hoy, -7);
    void listMovableHolidays()
      .then(lista => {
        const ya = cerrados();
        const proximo = lista
          .filter(h => h.date.slice(0, 10) > hoy && h.date.slice(0, 10) <= limite && !ya.includes(h.id))
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        setFeriado(proximo ?? null);
      })
      .catch(() => undefined);
  }, []);

  if (!feriado) return null;
  const cerrar = () => {
    try { localStorage.setItem(CLAVE, JSON.stringify([...cerrados(), feriado.id])); } catch { /* sin storage, solo por esta vez */ }
    setFeriado(null);
  };
  const dia = new Date(`${feriado.date.slice(0, 10)}T12:00:00`).toLocaleDateString('es', { weekday: 'long' });

  return (
    <div className="fixed bottom-4 left-1/2 z-40 flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 shadow-lg" data-testid="aviso-feriado">
      <span>🎉 El {dia} {fmtDateOnly(feriado.date)} es feriado ({feriado.name}). ¿Lo vas a trabajar?</span>
      <button onClick={() => { cerrar(); onMover(); }} className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 font-semibold text-white hover:bg-amber-700">
        Pedir tomarlo otro día
      </button>
      <button onClick={cerrar} aria-label="Cerrar aviso" className="shrink-0 text-amber-700 hover:text-amber-900">✕</button>
    </div>
  );
}
