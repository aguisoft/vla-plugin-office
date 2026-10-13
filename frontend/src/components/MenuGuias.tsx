import { useEffect, useRef, useState } from 'react';
import type { Guia } from '../guiasUx';

/**
 * El libro del encabezado. Con una sola guía es un enlace directo; con más
 * (jefes y RRHH) abre un menú para elegir. Las guías se abren aparte para
 * poder seguirlas al lado de la oficina.
 */
export function MenuGuias({ guias, base }: { guias: Guia[]; base: string }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  const libro = (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  );
  const estilo = 'flex items-center rounded-xl px-2 py-1.5 text-gray-500 transition-colors hover:bg-gray-100';

  if (guias.length === 1) {
    return (
      <a href={base + guias[0].archivo} target="_blank" rel="noopener"
        data-testid="guia-uso" title="Guía de uso" aria-label="Guía de uso" className={estilo}>
        {libro}
      </a>
    );
  }
  return (
    <div className="relative" ref={caja}>
      <button onClick={() => setAbierto(v => !v)} data-testid="guia-uso" aria-expanded={abierto}
        title="Guías de uso" aria-label="Guías de uso" className={estilo}>
        {libro}
      </button>
      {abierto && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-gray-100 bg-white py-1 shadow-xl" role="menu">
          {guias.map(g => (
            <a key={g.id} role="menuitem" data-testid={`guia-${g.id}`} href={base + g.archivo} target="_blank" rel="noopener"
              onClick={() => setAbierto(false)}
              className="block px-3.5 py-2.5 hover:bg-gray-50">
              <span className="block text-[11px] font-semibold text-gray-700">{g.titulo}</span>
              <span className="block text-[10px] leading-snug text-gray-400">{g.detalle}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
