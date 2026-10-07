import { useEffect, useState } from 'react';
import { semaforo, reloj } from '../timeLimits';

/**
 * Tiempo en el estado actual. Pasado el límite no se detiene ni cambia el
 * estado: sigue contando, que es el dato que después se revisa.
 *
 * El TIEMPO lo ve cualquiera —saber si al que busco le falta poco para volver
 * sirve para coordinarse—. El SEMÁFORO no: señala que alguien se pasó, y eso
 * solo le compete a la persona, su jefe y RRHH. Sin esa distinción el equipo
 * entero vería en rojo a un compañero que se demoró almorzando.
 *
 * Devuelve null —sin ocupar espacio— en los estados sin plazo.
 */
export function Cronometro({ status, desde, verAlertas = false, className = '' }: {
  status: string;
  /** Inicio de la ausencia o del estado del día, lo que aplique. */
  desde?: string | null;
  /** `canSeeTimeAlerts` del snapshot: lo decide el servidor, no el navegador. */
  verAlertas?: boolean;
  className?: string;
}) {
  const [ahora, setAhora] = useState(() => new Date());

  // Solo hay un HoverCard abierto a la vez, así que un tick por segundo no
  // pesa. El intervalo se limpia al cerrar.
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const s = semaforo(status, desde, ahora);
  if (!s) return null;

  if (!verAlertas) {
    return (
      <p className={`text-[10px] text-gray-400 ${className}`}>{reloj(s.transcurridoSeg)}</p>
    );
  }

  const tono =
    s.fase === 'rojo'  ? 'text-red-600 font-medium' :
    s.fase === 'ambar' ? 'text-amber-600' :
                         'text-gray-400';

  return (
    <p className={`text-[10px] ${tono} ${className}`}>
      {s.fase === 'rojo'
        ? <>⚠ {reloj(s.transcurridoSeg)} · {reloj(s.excesoSeg)} de más</>
        : <>{reloj(s.transcurridoSeg)} de {s.limiteMin} min</>}
    </p>
  );
}
