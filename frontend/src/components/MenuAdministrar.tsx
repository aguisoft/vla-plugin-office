import { useEffect, useRef, useState } from 'react';

/**
 * Lo de administración en un solo menú (Personas, Ausencias, Feriados, Bitrix24) en vez
 * de un botón suelto por pantalla: el encabezado ya tiene Organigrama,
 * Escritorio, Solicitudes, la campana y Tiempos, que usa todo el mundo.
 * Cada opción trae su propio permiso; sin ninguna, el menú no aparece.
 */
export interface OpcionAdmin {
  id: string;
  icono: string;
  titulo: string;
  detalle: string;
  onClick: () => void;
}

export function MenuAdministrar({ opciones }: { opciones: OpcionAdmin[] }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  if (!opciones.length) return null;
  return (
    <div className="relative" ref={caja}>
      <button onClick={() => setAbierto(v => !v)} data-testid="menu-administrar" aria-expanded={abierto} title="Administrar"
        className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[10px] text-gray-500 transition-colors hover:bg-gray-100">
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="hidden xl:inline">Administrar</span>
        <svg className={`h-3 w-3 transition-transform ${abierto ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {abierto && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-gray-100 bg-white py-1 shadow-xl" role="menu">
          {opciones.map(o => (
            <button key={o.id} role="menuitem" data-testid={`admin-${o.id}`}
              onClick={() => { setAbierto(false); o.onClick(); }}
              className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-gray-50">
              <span className="text-base leading-none">{o.icono}</span>
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold text-gray-700">{o.titulo}</span>
                <span className="block text-[10px] leading-snug text-gray-400">{o.detalle}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
