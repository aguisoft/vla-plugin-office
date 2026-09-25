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

export type DepartmentSource =
  | 'override'  // RRHH lo corrigió a mano
  | 'bitrix'    // vino de UF_DEPARTMENT vía syncOrgStructure
  | 'none';     // nadie lo tiene: la persona queda fuera de toda jerarquía

export interface ResolvedDepartment {
  departmentId: string | null;
  source: DepartmentSource;
}

/**
 * Departamento efectivo: el override de RRHH gana sobre lo que diga Bitrix.
 *
 * Importa que esto se resuelva ANTES que el jefe y no en paralelo: el jefe sale
 * del departamento (`headByDept`), así que corregir el departamento de una
 * persona tiene que moverla bajo el jefe del departamento nuevo. Si el override
 * solo cambiara lo que se muestra, no serviría para nada — hoy hay 14 personas
 * sin departamento que nadie ve en el dashboard, y ese es justo el caso que
 * este override viene a arreglar.
 */
export function resolveDepartment(
  overrideDeptId: string | null | undefined,
  bitrixDeptId: string | null | undefined,
): ResolvedDepartment {
  const o = (overrideDeptId ?? '').trim();
  if (o) return { departmentId: o, source: 'override' };

  const b = (bitrixDeptId ?? '').trim();
  if (b) return { departmentId: b, source: 'bitrix' };

  return { departmentId: null, source: 'none' };
}

export type ManagerSource =
  | 'override'  // RRHH lo fijó a mano en UserProfileOverride
  | 'bitrix'    // vino de la jerarquía de departamentos de Bitrix
  | 'none';     // no hay jefe

export interface ResolvedManager {
  managerUserId: string | null;
  source: ManagerSource;
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
): ResolvedManager {
  if (overrideManagerId && overrideManagerId !== userId) {
    return { managerUserId: overrideManagerId, source: 'override' };
  }
  if (!myDeptId) {
    return { managerUserId: null, source: 'none' };
  }
  const head = headByDept.get(myDeptId) ?? null;
  if (head && head !== userId) {
    return { managerUserId: head, source: 'bitrix' };
  }
  return { managerUserId: null, source: 'none' };
}
