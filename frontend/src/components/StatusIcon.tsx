import type { ResolvedStatus } from '../statusConfig';

/**
 * Los once estados como íconos alusivos.
 *
 * Reemplazan a las figuras geométricas (● ◆ ■ ▲ ▼ ◐ ○ ◇ ✦ ✚ ★), que cumplían
 * la regla de no depender del color pero no decían nada: un rombo no sugiere
 * «concentrado» ni un triángulo «reunión externa». Con un ícono alusivo, el
 * estado se entiende antes de leer la etiqueta.
 *
 * LA REGLA QUE SE MANTIENE: cada silueta tiene que ser separable de las otras
 * diez sin mirar el color. Hay varias que contienen un círculo —disponible,
 * concentrado, vuelvo pronto, desconectado— y se distinguen por lo que pasa
 * DENTRO: un visto, anillos concéntricos, agujas, o el corte del símbolo de
 * encendido. Una prueba verifica que no haya dos trazados iguales.
 *
 * Dibujados a 24×24 y con trazo, como el resto de los íconos del plugin.
 * A 12px el trazo de 1.9 es lo más fino que sigue siendo nítido.
 */

const TRAZOS: Record<ResolvedStatus, { d: string; extra?: string }> = {
  // Visto dentro de un círculo.
  AVAILABLE: { d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', extra: 'M8.5 12.2l2.4 2.4 4.6-4.9' },
  // Diana: la atención puesta en un punto.
  FOCUS: { d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', extra: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 13.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z' },
  // Dos personas: la reunión es con los de adentro.
  IN_MEETING_INTERNAL: { d: 'M9.5 11.5a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2ZM4 18.5c0-2.5 2.5-4 5.5-4s5.5 1.5 5.5 4', extra: 'M16.2 11a2.2 2.2 0 1 0 0-4.4M17 14.9c2 .5 3 1.9 3 3.6' },
  // Una persona y una flecha que sale: la reunión es afuera.
  IN_MEETING_EXTERNAL: { d: 'M9 11.5a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6ZM3.5 18.8c0-2.6 2.5-4.2 5.5-4.2 1.2 0 2.3.3 3.2.7', extra: 'M15 14.5h5.5m0 0L18 12m2.5 2.5L18 17' },
  // Cubiertos.
  LUNCH: { d: 'M7.5 3.5v7m-2.2-7v4.2a2.2 2.2 0 0 0 4.4 0V3.5M7.5 10.5v10', extra: 'M16.8 3.5c-1.7 0-2.8 2-2.8 4.6 0 2 .9 3.4 2.1 3.9v8.5' },
  // Reloj: vuelvo en un rato.
  BRB: { d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', extra: 'M12 7.3V12l3.1 1.9' },
  // Símbolo de encendido.
  OFFLINE: { d: 'M12 3.8v7.4', extra: 'M7.1 6.9a7.2 7.2 0 1 0 9.8 0' },
  // Documento: el permiso queda por escrito.
  PERMISO: { d: 'M6.5 3.2h7.2L18 7.6v13.2H6.5V3.2Z', extra: 'M13.4 3.4v4.4H18M9.3 12.4h5.4M9.3 16.1h5.4' },
  // Sombrilla de playa.
  VACACIONES: { d: 'M3.6 12.4a8.4 8.4 0 0 1 16.8 0H3.6Z', extra: 'M12 12.4v8.4M12 20.8a2 2 0 0 0 2.6-1' },
  // Cruz médica.
  INCAPACIDAD: { d: 'M9.6 3.6h4.8v6h6v4.8h-6v6H9.6v-6h-6V9.6h6v-6Z' },
  // Calendario con una marca: el día señalado.
  FERIADO: { d: 'M4.4 6.6h15.2v14H4.4v-14Z', extra: 'M4.4 10.8h15.2M8.6 3.4v4.4M15.4 3.4v4.4M11 14.2l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3 1-2.1Z' },
};

export function StatusIcon({ estado, color, size = 13 }: {
  estado: ResolvedStatus;
  color: string;
  size?: number;
}) {
  const t = TRAZOS[estado];
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d={t.d} />
      {t.extra && <path d={t.extra} />}
    </svg>
  );
}

/** Para las pruebas: el trazado completo de cada estado. */
export const TRAZOS_ESTADO = TRAZOS;
