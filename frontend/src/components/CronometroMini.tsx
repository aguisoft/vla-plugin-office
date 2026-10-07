import { useEffect, useState } from 'react';
import { semaforo, reloj } from '../timeLimits';

/**
 * Versión de una línea del cronómetro, para la grilla de la oficina: ahí hay
 * decenas de avatares a la vez y no cabe la frase completa.
 *
 * Igual que el grande: el tiempo lo ve cualquiera, el color solo quien
 * gestiona. Tictac cada 15 s en vez de cada segundo — en la grilla el segundero
 * sería ruido y obliga a redibujar muchas tarjetas.
 */
export function CronometroMini({ status, desde, verAlertas = false }: {
  status: string;
  desde?: string | null;
  verAlertas?: boolean;
}) {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 15000);
    return () => clearInterval(id);
  }, []);

  const s = semaforo(status, desde, ahora);
  if (!s) return null;

  const tono = !verAlertas ? 'text-gray-400'
    : s.fase === 'rojo'  ? 'text-red-600'
    : s.fase === 'ambar' ? 'text-amber-600'
    : 'text-gray-400';

  return (
    <span className={`text-[8px] leading-none tabular-nums ${tono}`}>
      {verAlertas && s.fase === 'rojo' ? '⚠ ' : ''}{reloj(s.transcurridoSeg)}
    </span>
  );
}
