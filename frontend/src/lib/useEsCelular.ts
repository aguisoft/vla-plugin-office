import { useEffect, useState } from 'react';

/** Pantalla de celular: debajo de `md` (768 px), el mismo corte que usa Tailwind. */
const CONSULTA = '(max-width: 767px)';

/**
 * Para lo que tiene que estar en UN solo lugar según la pantalla (la campana
 * pide sus avisos al montarse: esconderla con CSS dejaría dos pidiendo).
 */
export function useEsCelular(): boolean {
  const [es, setEs] = useState(() => typeof window !== 'undefined' && window.matchMedia(CONSULTA).matches);
  useEffect(() => {
    const m = window.matchMedia(CONSULTA);
    const cambio = () => setEs(m.matches);
    m.addEventListener('change', cambio);
    cambio();
    return () => m.removeEventListener('change', cambio);
  }, []);
  return es;
}
