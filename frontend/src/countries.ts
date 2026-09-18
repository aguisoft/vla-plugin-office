/**
 * Catálogo de países para la pantalla de feriados.
 *
 * Existe porque el panel anterior pedía el país como texto libre de dos
 * letras: había que saberse los ISO de memoria, y un typo no fallaba — creaba
 * un feriado para un país que no existe, invisible hasta que alguien notara
 * que a nadie le llegó el día libre. Con un selector, el conjunto de países
 * válidos es finito y visible.
 *
 * La lista es la misma de `src/lib/phone-country.ts` (los países donde VLA
 * tiene o podría tener gente) más el default. Si hace falta uno nuevo se
 * agrega acá; no hay motivo para soportar los 195.
 */

export interface Country {
  iso: string;
  name: string;
  flag: string;
}

export const COUNTRIES: Country[] = [
  { iso: 'CR', name: 'Costa Rica',  flag: '🇨🇷' },
  { iso: 'NI', name: 'Nicaragua',   flag: '🇳🇮' },
  { iso: 'PA', name: 'Panamá',      flag: '🇵🇦' },
  { iso: 'GT', name: 'Guatemala',   flag: '🇬🇹' },
  { iso: 'SV', name: 'El Salvador', flag: '🇸🇻' },
  { iso: 'HN', name: 'Honduras',    flag: '🇭🇳' },
  { iso: 'BZ', name: 'Belice',      flag: '🇧🇿' },
  { iso: 'MX', name: 'México',      flag: '🇲🇽' },
  { iso: 'CO', name: 'Colombia',    flag: '🇨🇴' },
  { iso: 'VE', name: 'Venezuela',   flag: '🇻🇪' },
  { iso: 'EC', name: 'Ecuador',     flag: '🇪🇨' },
  { iso: 'PE', name: 'Perú',        flag: '🇵🇪' },
  { iso: 'CL', name: 'Chile',       flag: '🇨🇱' },
  { iso: 'AR', name: 'Argentina',   flag: '🇦🇷' },
  { iso: 'ES', name: 'España',      flag: '🇪🇸' },
];

const BY_ISO = new Map(COUNTRIES.map(c => [c.iso, c]));

/**
 * País por ISO. Para un ISO que no está en el catálogo devuelve una entrada
 * sintética en vez de `undefined`: la base puede tener feriados cargados con
 * un código viejo o escrito a mano, y esa fila tiene que poder renderizarse
 * (y borrarse) igual. El 🏳 lo delata como fuera de catálogo.
 */
export function countryOf(iso: string): Country {
  return BY_ISO.get((iso ?? '').toUpperCase()) ?? {
    iso: (iso ?? '').toUpperCase(),
    name: (iso ?? '').toUpperCase() || 'Sin país',
    flag: '🏳',
  };
}

export function countryLabel(iso: string): string {
  const c = countryOf(iso);
  return `${c.flag} ${c.name}`;
}
