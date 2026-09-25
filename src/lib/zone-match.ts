/**
 * Empareja el departamento de Bitrix con una zona del mapa de la oficina.
 *
 * Son dos catálogos independientes que casualmente se parecen: el
 * departamento decide la jerarquía (quién ve a quién en el dashboard de
 * tiempos) y la zona decide dónde se dibuja el avatar. Nadie garantiza que
 * coincidan — alguien de Finanzas puede sentarse en Cobros — así que esto es
 * una **sugerencia**, no una regla.
 *
 * Por eso no hay tabla de alias. Los nombres que no calzan por sí solos
 * («Grupo VLA» contra «Gerencia General», «Bienestar Estudiantil» contra
 * «Cobros & Bienestar») devuelven `null` a propósito: una equivalencia
 * adivinada acá sienta a alguien en el escritorio equivocado y nadie vuelve a
 * mirar de dónde salió. Que RRHH corrija esas pocas a mano es más barato que
 * encontrar el error después.
 */

export interface ZoneRef {
  id: string;
  name: string;
}

/**
 * Forma comparable de un nombre: sin acentos, sin mayúsculas, sin separadores
 * y sin las palabras que solo agregan ruido administrativo.
 *
 * «Marketing department» y la zona «Marketing» son la misma cosa escrita por
 * dos personas distintas; sin quitar el sufijo, ese par se perdería.
 */
export function normalizeName(raw: string): string {
  return (raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // acentos
    .toLowerCase()
    .replace(/\b(department|departamento|dept)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')        // espacios, guiones, &, puntos
    .trim();
}

/**
 * Zona sugerida para un departamento, o `null` si ninguna calza sin adivinar.
 *
 * Compara contra el nombre de la zona y también contra su id (las zonas usan
 * slugs como `english-sales`, que normalizan igual que su nombre).
 *
 * Si dos zonas calzan con el mismo departamento devuelve `null`: un empate
 * significa que el nombre no alcanza para decidir, y elegir la primera sería
 * decidir por orden de carga.
 */
export function matchZone(departmentName: string | null | undefined, zones: ZoneRef[]): string | null {
  const dept = normalizeName(departmentName ?? '');
  if (!dept) return null;

  const hits = zones.filter(z => normalizeName(z.name) === dept || normalizeName(z.id) === dept);
  return hits.length === 1 ? hits[0].id : null;
}

export type ZoneSource =
  | 'fijada'    // alguien la eligió a mano
  | 'sugerida'  // calzó por nombre con el departamento
  | 'none';     // no hay zona: el avatar no se dibuja en ningún lado

export interface ResolvedZone {
  zoneId: string | null;
  source: ZoneSource;
}

/**
 * Zona efectiva: la fijada a mano gana; si no hay, la que sugiere el nombre del
 * departamento.
 *
 * La sugerencia alimenta el mapa además de la tabla, y eso es deliberado: sin
 * eso, asignar un departamento seguiría sin mover a nadie hasta que alguien
 * abriera la pantalla y guardara persona por persona. La tabla muestra cuáles
 * son sugeridas para que la diferencia no quede escondida.
 */
export function resolveZone(
  explicitZoneId: string | null | undefined,
  departmentName: string | null | undefined,
  zones: ZoneRef[],
): ResolvedZone {
  const fijada = (explicitZoneId ?? '').trim();
  // Una zona fijada que ya no existe en el layout (se renombró o se borró) no
  // se puede dibujar. Cae a la sugerencia en vez de dejar el avatar en el limbo.
  if (fijada && zones.some(z => z.id === fijada)) return { zoneId: fijada, source: 'fijada' };

  const sugerida = matchZone(departmentName, zones);
  if (sugerida) return { zoneId: sugerida, source: 'sugerida' };

  return { zoneId: null, source: 'none' };
}
