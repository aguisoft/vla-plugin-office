/**
 * Pictograma del ambiente. El nombre del ícono ya viene en cada zona del plano
 * (`zone.icon`: crown, code, scale…) y hasta ahora no se dibujaba en ninguna
 * parte; esto solo lo pone a la vista.
 *
 * Trazos propios en vez de una librería: son trece, el plugin ya dibuja así
 * los íconos de estado, y sumar un paquete por esto engordaría el bundle de
 * la oficina para trece formas.
 */
const TRAZOS: Record<string, string> = {
  crown:           'M4.5 18.5h15M5 18.5 3.5 8l5 3.5L12 5.5l3.5 6L20.5 8l-1.5 10.5',
  code:            'M8.5 7.5 3.5 12l5 4.5M15.5 7.5 20.5 12l-5 4.5',
  briefcase:       'M3.5 8.5h17v10h-17v-10ZM9 8.5V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2.5M3.5 13h17',
  users:           'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 19c0-2.8 2.7-4.5 6-4.5s6 1.7 6 4.5M16.5 5.5a3 3 0 0 1 0 5.8M17.5 14.8c2 .6 3 1.9 3 3.6',
  heart:           'M12 19.5s-7-4.3-7-9A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.5c0 4.7-7 9-7 9Z',
  'credit-card':   'M3 6.5h18v11H3v-11ZM3 10.5h18M6.5 14.5h3',
  coins:           'M9 13a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM15 21a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11',
  scale:           'M12 4.5v15M7.5 19.5h9M4.5 9h15M4.5 9 2 14.5h5L4.5 9Zm15 0L17 14.5h5L19.5 9Z',
  megaphone:       'M4 10v4a1 1 0 0 0 1 1h2l8 4V5L7 9H5a1 1 0 0 0-1 1ZM7 15v4M18 9.5a3.5 3.5 0 0 1 0 5',
  'graduation-cap':'M2.5 9 12 5l9.5 4L12 13 2.5 9ZM6.5 11v4.5c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V11',
  'trending-up':   'M3 17l6-6 4 4 8-8M15 7h6v6',
  phone:           'M6 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4 5.7 2 2 0 0 1 6 3.5Z',
  globe:           'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.4 3.8 5.5 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.5-3.8-9S9.5 5.4 12 3Z',
};

export function ZonaIcon({ icon, color, size = 13 }: {
  icon?: string;
  /** El mismo color de la franja: liga el pictograma a su departamento. */
  color?: string;
  size?: number;
}) {
  const d = icon ? TRAZOS[icon] : undefined;
  if (!d) return null;   // zona sin ícono declarado: no se inventa uno
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke={color || '#9ca3af'} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      className="flex-shrink-0"
    >
      <path d={d} />
    </svg>
  );
}
