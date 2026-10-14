import { useEffect, useRef, useState } from 'react';
import { AvatarSVG } from './AvatarSVG';
import type { AvatarCfg } from '../types';

/**
 * Lo mío, al final del encabezado: mi avatar y mi nombre, con lo que es de una
 * sola persona (personalizar el avatar, mis ausencias, la app de escritorio y
 * mi conexión a Bitrix). Antes el avatar con su lápiz y las iniciales con el
 * nombre aparecían por separado, y «Escritorio» ocupaba un lugar fijo para
 * algo que se configura una vez.
 */
export function MenuPersonal({ nombre, avatar, photoUrl, status, faltaEscritorio, onAvatar, onAusencias, onEscritorio, onGoogle }: {
  nombre: string;
  avatar: AvatarCfg | null;
  photoUrl?: string;
  status: string;
  /** Tiene la app publicada y no la instaló: se marca. */
  faltaEscritorio: boolean;
  onAvatar: () => void;
  onAusencias: () => void;
  onEscritorio: () => void;
  onGoogle: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  const opciones = [
    { id: 'avatar', titulo: 'Personalizar mi avatar', onClick: onAvatar },
    { id: 'ausencias', titulo: 'Mis ausencias y solicitudes', onClick: onAusencias },
    { id: 'escritorio', titulo: faltaEscritorio ? 'Instalar la app de escritorio' : 'App de escritorio y Bitrix', onClick: onEscritorio, marca: faltaEscritorio },
    { id: 'google', titulo: 'Google Calendar', onClick: onGoogle },
  ];

  return (
    <div className="relative" ref={caja}>
      <button onClick={() => setAbierto(v => !v)} data-testid="menu-personal" aria-expanded={abierto}
        className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 transition-colors hover:bg-gray-100">
        <AvatarSVG cfg={avatar} photoUrl={photoUrl} size={28} status={status} name={nombre} />
        <span className="hidden max-w-[9rem] truncate text-[11px] text-gray-600 xl:inline">{nombre}</span>
        <svg className={`h-3 w-3 text-gray-400 transition-transform ${abierto ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {abierto && (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-gray-100 bg-white py-1 shadow-xl" role="menu">
          <p className="truncate border-b border-gray-50 px-3.5 py-2 text-[11px] font-semibold text-gray-700">{nombre}</p>
          {opciones.map(o => (
            <button key={o.id} role="menuitem" data-testid={`personal-${o.id}`}
              onClick={() => { setAbierto(false); o.onClick(); }}
              className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[11px] text-gray-600 hover:bg-gray-50">
              <span className="flex-1">{o.titulo}</span>
              {o.marca && <span className="h-2 w-2 rounded-full bg-orange-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
