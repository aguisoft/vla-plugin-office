/**
 * De dónde sale el país de un colaborador.
 *
 * Importa mostrarlo en la pantalla de feriados y no solo el valor: hoy los 35
 * usuarios tienen `country = null` en `BitrixUserMapping`, así que todos
 * resuelven al default del plugin. Un "CR" que en realidad significa "nadie
 * cargó el dato" se lee igual que un "CR" verificado por RRHH, y esa confusión
 * es la que hace que a alguien de Argentina le caigan feriados ticos sin que
 * nadie lo note.
 */

export type CountrySource =
  | 'override'  // RRHH lo fijó a mano en UserProfileOverride
  | 'bitrix'    // vino de PERSONAL_COUNTRY vía syncOrgStructure
  | 'default';  // nadie lo cargó: es el valor de respaldo del plugin

export interface ResolvedCountry {
  country: string;
  source: CountrySource;
}

/**
 * Misma precedencia que `OrgService.countryOf`: override, después Bitrix,
 * después el default. Se extrae acá para que la precedencia se pueda probar
 * sin base de datos y para que el origen viaje junto al valor.
 *
 * Trata la cadena vacía como ausencia: Bitrix devuelve `""` para los campos
 * sin llenar, y un `""` que ganara la precedencia dejaría el país en blanco
 * en vez de caer al siguiente eslabón.
 */
export function resolveCountry(
  override: string | null | undefined,
  mapping: string | null | undefined,
  fallback: string,
): ResolvedCountry {
  const o = (override ?? '').trim();
  if (o) return { country: o.toUpperCase(), source: 'override' };

  const m = (mapping ?? '').trim();
  if (m) return { country: m.toUpperCase(), source: 'bitrix' };

  return { country: fallback.trim().toUpperCase(), source: 'default' };
}

/**
 * Jefe directo a partir de datos ya cargados en memoria, para no hacer dos
 * consultas por persona al armar el roster completo.
 *
 * `headByDept` mapea departmentId → userId del jefe. Misma regla que
 * `OrgService.managerOf`: el override gana, después el UF_HEAD del
 * departamento, y nadie es su propio jefe por ninguna de las dos vías.
 */
export function resolveManager(
  userId: string,
  overrideManagerId: string | null | undefined,
  myDeptId: string | null | undefined,
  headByDept: Map<string, string>,
): string | null {
  if (overrideManagerId && overrideManagerId !== userId) return overrideManagerId;
  if (!myDeptId) return null;
  const head = headByDept.get(myDeptId) ?? null;
  return head && head !== userId ? head : null;
}
