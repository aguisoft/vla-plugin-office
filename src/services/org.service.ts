import type { PluginContext } from '@vla/plugin-sdk';
import {
  resolveCountry, resolveManager, resolveDepartment,
  type CountrySource, type ManagerSource, type DepartmentSource,
} from '../lib/country-source';
import { resolveZone, type ZoneRef, type ZoneSource } from '../lib/zone-match';

export interface RosterEntry {
  userId: string;
  country: string;
  countrySource: CountrySource;
  managerUserId: string | null;
  managerSource: ManagerSource;
  departmentId: string | null;
  departmentName: string | null;
  departmentSource: DepartmentSource;
  /** Zona del mapa donde se dibuja el avatar. Independiente del departamento. */
  zoneId: string | null;
  zoneName: string | null;
  zoneSource: ZoneSource;
}

export interface Department {
  id: string;
  name: string;
  /** Cuánta gente tiene hoy, contando los overrides. Para ordenar la lista. */
  headcount: number;
}

/**
 * Departamento efectivo de cada persona y quién dirige cada departamento.
 *
 * Se arma una vez y se reparte porque las tres preguntas que el plugin hace
 * —quién es mi jefe, a quién veo, qué muestro en la pantalla— dependen todas
 * del MISMO departamento efectivo. Resolverlo por separado en cada una fue lo
 * que permitió que el override existiera sin mover a nadie de jefe.
 */
interface OrgSnapshot {
  /** userId → departamento efectivo (override si hay, si no el de Bitrix). */
  deptOf: Map<string, string | null>;
  /** userId → de dónde salió ese departamento. */
  deptSourceOf: Map<string, DepartmentSource>;
  /** departmentId → userId del jefe. */
  headByDept: Map<string, string>;
  /** userId → override explícito de jefe, si lo hay. */
  managerOverrideOf: Map<string, string | null>;
}

export class OrgService {
  /**
   * defaultCountry es una función y no un string porque ctx.plugin.config se
   * hidrata desde la base DESPUÉS de registrar el plugin: si se leyera en el
   * constructor, siempre daría el valor de respaldo.
   */
  /**
   * `zonesOf` entrega las zonas del layout activo. Es una función y no una
   * lista porque el layout puede cambiar mientras el plugin corre, y porque
   * OrgService no debe depender de LayoutService para algo que solo necesita
   * leer.
   */
  constructor(
    private readonly ctx: PluginContext,
    private readonly defaultCountry: () => string,
    private readonly zonesOf: () => Promise<ZoneRef[]> = async () => [],
  ) {}

  /**
   * Overrides de departamento, del esquema del plugin.
   *
   * Viven acá y no en `virtual_office.UserProfileOverride` —donde están el país
   * y el jefe— porque agregarle una columna a esa tabla obliga a reconstruir el
   * core y reiniciar el API para los 35. El reparto es una decisión de
   * despliegue, no de modelo: hacia afuera los tres overrides se ven y se
   * escriben igual.
   *
   * Degrada a vacío si la tabla no se puede leer: sin esto, un fallo de la
   * consulta se lleva puesta la resolución de jefes de todo el plugin, y en
   * Express 4 una promesa rechazada en un handler mata el proceso entero.
   */
  private async departmentOverrides(): Promise<Map<string, string>> {
    try {
      const rows = await this.ctx.query<{ user_id: string; department_id: string | null }>(
        'SELECT user_id, department_id FROM office_org_overrides WHERE department_id IS NOT NULL',
      );
      return new Map(rows.map(r => [r.user_id, r.department_id as string]));
    } catch (e) {
      this.ctx.logger.warn(`No se pudieron leer los overrides de departamento: ${e}`);
      return new Map();
    }
  }

  /** Catálogo de nombres. Vacío si falla: la pantalla cae al ID, que es legible. */
  private async departmentNames(): Promise<Map<string, string>> {
    try {
      const rows = await this.ctx.query<{ id: string; name: string }>(
        'SELECT id, name FROM office_departments',
      );
      return new Map(rows.map(r => [r.id, r.name]));
    } catch (e) {
      this.ctx.logger.warn(`No se pudo leer el catálogo de departamentos: ${e}`);
      return new Map();
    }
  }

  /**
   * Foto del organigrama efectivo. Una sola pasada por Bitrix + overrides.
   *
   * `headByDept` se arma DESPUÉS de aplicar los overrides de departamento: si
   * RRHH mueve a un jefe de departamento, tiene que dirigir el nuevo, no el que
   * Bitrix dejó escrito.
   */
  private async snapshot(): Promise<OrgSnapshot> {
    const [mappings, overrides, deptOverrides] = await Promise.all([
      this.ctx.prisma.bitrixUserMapping.findMany(),
      this.ctx.prisma.userProfileOverride.findMany(),
      this.departmentOverrides(),
    ]);

    const deptOf = new Map<string, string | null>();
    const deptSourceOf = new Map<string, DepartmentSource>();
    for (const m of mappings as any[]) {
      const { departmentId, source } = resolveDepartment(deptOverrides.get(m.userId), m.departmentId);
      deptOf.set(m.userId, departmentId);
      deptSourceOf.set(m.userId, source);
    }
    // Quien tiene override pero ningún mapeo de Bitrix: no aparece en el bucle
    // de arriba y se quedaría sin departamento justo después de que RRHH se lo
    // asignó. Es el caso de alguien que nunca se sincronizó con Bitrix.
    for (const [userId, deptId] of deptOverrides) {
      if (!deptOf.has(userId)) {
        deptOf.set(userId, deptId);
        deptSourceOf.set(userId, 'override');
      }
    }

    const headByDept = new Map<string, string>();
    for (const m of mappings as any[]) {
      const dept = deptOf.get(m.userId);
      if (m.isDepartmentHead && dept && !headByDept.has(dept)) headByDept.set(dept, m.userId);
    }

    const managerOverrideOf = new Map<string, string | null>(
      (overrides as any[]).map(o => [o.userId, o.managerUserId ?? null]),
    );

    return { deptOf, deptSourceOf, headByDept, managerOverrideOf };
  }

  /** Jefe directo: override explícito, si no el jefe del departamento efectivo. */
  async managerOf(userId: string): Promise<string | null> {
    const snap = await this.snapshot();
    return resolveManager(
      userId,
      snap.managerOverrideOf.get(userId),
      snap.deptOf.get(userId),
      snap.headByDept,
    ).managerUserId;
  }

  async isManagerOf(viewerId: string, targetId: string): Promise<boolean> {
    if (viewerId === targetId) return false;
    return (await this.managerOf(targetId)) === viewerId;
  }

  /**
   * Todos los subordinados directos del viewer. Alimenta el alcance del
   * dashboard de tiempos, o sea quién recibe 200 y quién 403.
   *
   * Se define como el inverso exacto de `managerOf`: alguien está a cargo del
   * viewer si y solo si su jefe resuelto ES el viewer. Antes esto reconstruía
   * la regla por su cuenta —overrides, más el departamento si el viewer era
   * jefe, menos los reasignados— y esa segunda copia de la lógica es lo que
   * permitía que las dos respuestas se separaran. Con el override de
   * departamento habría hecho falta una tercera corrección en esta función; en
   * vez de eso, ahora hay una sola regla.
   */
  async managedUserIds(viewerId: string): Promise<Set<string>> {
    const snap = await this.snapshot();

    const candidatos = new Set<string>([...snap.deptOf.keys(), ...snap.managerOverrideOf.keys()]);
    const result = new Set<string>();

    for (const userId of candidatos) {
      if (userId === viewerId) continue;
      const { managerUserId } = resolveManager(
        userId,
        snap.managerOverrideOf.get(userId),
        snap.deptOf.get(userId),
        snap.headByDept,
      );
      if (managerUserId === viewerId) result.add(userId);
    }

    return result;
  }

  async countryOf(userId: string): Promise<string> {
    const override = await this.ctx.prisma.userProfileOverride.findUnique({ where: { userId } });
    if ((override as any)?.country) return (override as any).country;
    const mapping = await this.ctx.prisma.bitrixUserMapping.findUnique({ where: { userId } });
    return (mapping as any)?.country ?? this.defaultCountry();
  }

  async countryByUserId(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();

    const [overrides, mappings] = await Promise.all([
      this.ctx.prisma.userProfileOverride.findMany({ where: { userId: { in: userIds } } }),
      this.ctx.prisma.bitrixUserMapping.findMany({ where: { userId: { in: userIds } } }),
    ]);
    const byOverride = new Map((overrides as any[]).map(o => [o.userId, o.country]));
    const byMapping = new Map((mappings as any[]).map(m => [m.userId, m.country]));

    const result = new Map<string, string>();
    for (const id of userIds) {
      result.set(id, byOverride.get(id) || byMapping.get(id) || this.defaultCountry());
    }
    return result;
  }

  /**
   * País, departamento y jefe de TODOS los usuarios pedidos, de una sola pasada.
   *
   * Uno por uno costaba 2 consultas por cabeza (70 para los 35 de producción) y
   * además no decía de dónde salía cada valor. La pantalla necesita el origen:
   * un "CR" que significa "nadie cargó el dato" no puede verse igual que uno
   * verificado, y lo mismo vale para el departamento.
   */
  async roster(userIds: string[]): Promise<Map<string, RosterEntry>> {
    const result = new Map<string, RosterEntry>();
    if (userIds.length === 0) return result;

    const [overrides, mappings, snap, names, zones, zonaFijada] = await Promise.all([
      this.ctx.prisma.userProfileOverride.findMany({ where: { userId: { in: userIds } } }),
      this.ctx.prisma.bitrixUserMapping.findMany({ where: { userId: { in: userIds } } }),
      // El snapshot lee TODOS los mapeos sin filtrar a propósito: el jefe de un
      // departamento puede no estar en `userIds`, y sin su fila headByDept
      // quedaría incompleto y el jefe saldría null.
      this.snapshot(),
      this.departmentNames(),
      this.zonesOf(),
      this.ctx.prisma.presenceStatus.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, defaultZoneId: true },
      }),
    ]);

    const overrideOf = new Map((overrides as any[]).map(o => [o.userId, o]));
    const mappingOf  = new Map((mappings as any[]).map(m => [m.userId, m]));
    const zonaOf     = new Map((zonaFijada as any[]).map(p => [p.userId, p.defaultZoneId as string | null]));
    const zoneNameOf = new Map(zones.map(z => [z.id, z.name]));

    const fallback = this.defaultCountry();
    for (const id of userIds) {
      const o = overrideOf.get(id) as any;
      const m = mappingOf.get(id) as any;
      const { country, source } = resolveCountry(o?.country, m?.country, fallback);

      const departmentId = snap.deptOf.get(id) ?? null;
      const { managerUserId, source: managerSource } =
        resolveManager(id, o?.managerUserId, departmentId, snap.headByDept);

      const departmentName = departmentId ? (names.get(departmentId) ?? departmentId) : null;
      const { zoneId, source: zoneSource } = resolveZone(zonaOf.get(id), departmentName, zones);

      result.set(id, {
        userId: id,
        country,
        countrySource: source,
        managerUserId,
        managerSource,
        departmentId,
        // Sin nombre se cae al ID: sigue siendo identificable y delata que el
        // catálogo no se sincronizó, en vez de mostrar un hueco.
        departmentName,
        departmentSource: snap.deptSourceOf.get(id) ?? 'none',
        zoneId,
        zoneName: zoneId ? (zoneNameOf.get(zoneId) ?? zoneId) : null,
        zoneSource,
      });
    }
    return result;
  }

  /**
   * Catálogo para el desplegable y para el filtro, con cuánta gente tiene cada
   * departamento HOY —contando overrides—, para poder ordenarlo por tamaño.
   *
   * Incluye departamentos con 0 personas: son a los que RRHH querrá mover a
   * alguien, y un desplegable que esconde justo los vacíos no sirve para eso.
   */
  async departments(): Promise<Department[]> {
    const [names, snap] = await Promise.all([this.departmentNames(), this.snapshot()]);

    const headcount = new Map<string, number>();
    for (const dept of snap.deptOf.values()) {
      if (dept) headcount.set(dept, (headcount.get(dept) ?? 0) + 1);
    }
    for (const id of headcount.keys()) if (!names.has(id)) names.set(id, id);

    return [...names.entries()]
      .map(([id, name]) => ({ id, name, headcount: headcount.get(id) ?? 0 }))
      .sort((a, b) => b.headcount - a.headcount || a.name.localeCompare(b.name));
  }

  async setOverride(
    userId: string,
    data: { managerUserId?: string | null; country?: string | null },
  ): Promise<void> {
    await this.ctx.prisma.userProfileOverride.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  /**
   * Fija o limpia el departamento de una persona.
   *
   * `null` borra la fila en vez de guardar un NULL: una fila con
   * `department_id` nulo y una fila ausente significan lo mismo —"que lo
   * resuelva Bitrix"— y tener dos representaciones del mismo estado es lo que
   * después hace que un filtro cuente de más.
   */
  async setDepartmentOverride(userId: string, departmentId: string | null): Promise<void> {
    if (departmentId === null) {
      await this.ctx.query('DELETE FROM office_org_overrides WHERE user_id = $1', [userId]);
      return;
    }
    await this.ctx.query(
      `INSERT INTO office_org_overrides (user_id, department_id, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET department_id = $2, updated_at = now()`,
      [userId, departmentId],
    );
  }

  /**
   * Fija o limpia la zona del mapa donde se dibuja el avatar.
   *
   * Escribe `PresenceStatus.defaultZoneId` y no `currentZoneId`: el segundo es
   * la posición temporal de quien se mueve durante el día y lo pisa cualquier
   * `POST /layout/move`. Hasta esta versión nada en la aplicación escribía
   * `defaultZoneId` — las asignaciones que había en producción se cargaron a
   * mano por SQL — así que no había forma de mover a nadie desde la interfaz.
   *
   * `null` limpia la zona fijada y devuelve a la persona a la sugerencia por
   * nombre de departamento, que es el mismo contrato que el resto de overrides.
   */
  async setZone(userId: string, zoneId: string | null): Promise<void> {
    await this.ctx.prisma.presenceStatus.upsert({
      where: { userId },
      create: { userId, isCheckedIn: false, status: 'OFFLINE', defaultZoneId: zoneId },
      update: { defaultZoneId: zoneId },
    });
  }

  /**
   * Zona efectiva de cada persona, para el mapa. Incluye la sugerida: sin eso,
   * asignar un departamento seguiría sin mover a nadie hasta que alguien
   * guardara persona por persona en la pantalla de RRHH.
   */
  async zoneByUserId(userIds: string[]): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    if (userIds.length === 0) return result;

    const roster = await this.roster(userIds);
    for (const id of userIds) result.set(id, roster.get(id)?.zoneId ?? null);
    return result;
  }

  /** Guarda los nombres que trae `department.get`. Lo llama el sync de Bitrix. */
  async upsertDepartments(departments: Array<{ id: string; name: string }>): Promise<number> {
    let saved = 0;
    for (const d of departments) {
      const name = (d.name ?? '').trim();
      if (!d.id || !name) continue;
      try {
        await this.ctx.query(
          `INSERT INTO office_departments (id, name, synced_at)
           VALUES ($1, $2, now())
           ON CONFLICT (id) DO UPDATE SET name = $2, synced_at = now()`,
          [String(d.id), name],
        );
        saved++;
      } catch (e) {
        this.ctx.logger.warn(`No se pudo guardar el departamento ${d.id}: ${e}`);
      }
    }
    return saved;
  }
}
