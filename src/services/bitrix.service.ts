import type { PluginContext } from '@vla/plugin-sdk';
import { countryFromPhone, phoneShape, prefixOf } from '../lib/phone-country';

export interface BitrixUser {
  ID: string;
  NAME: string;
  LAST_NAME: string;
  EMAIL: string;
  PERSONAL_PHOTO?: string;
  UF_DEPARTMENT?: number[];
  PERSONAL_COUNTRY?: string | number;
  /** Campos de teléfono, solo para el diagnóstico de cobertura de país. */
  PERSONAL_MOBILE?: string;
  PERSONAL_PHONE?: string;
  WORK_PHONE?: string;
  ACTIVE: boolean;
}

/**
 * Diagnóstico de solo lectura: qué tan bien se puede resolver el país de cada
 * colaborador con los datos que Bitrix tiene hoy.
 *
 * Existe para convertir en dato una decisión que hoy es conjetura: si conviene
 * inferir el país del teléfono cuando `PERSONAL_COUNTRY` viene vacío. No escribe
 * nada y **no expone números de teléfono** — solo formas, prefijos y conteos.
 */
export interface CountryCoverageReport {
  /** Usuarios activos que Bitrix devuelve. */
  bitrixActiveUsers: number;
  /** De esos, cuántos tienen un usuario VLA con el mismo correo. */
  mappedToVlaUsers: number;
  /** Cuántos traen `PERSONAL_COUNTRY` con algún valor. */
  withPersonalCountry: number;
  /** Valores crudos de `PERSONAL_COUNTRY` vistos, con su conteo. Sirve para
   *  construir el mapa ID→ISO de verdad en vez de adivinarlo. */
  personalCountryRawValues: Record<string, number>;
  /** De esos valores, cuáles NO están en el mapa actual: hoy caen al default. */
  unmappedCountryIds: string[];
  /** Por campo de teléfono, la forma de lo que hay. Decide cuál campo usar. */
  phoneFields: Record<string, Record<string, number>>;
  /** Distribución de prefijos reconocidos, sumando los tres campos. */
  prefixDistribution: Record<string, number>;
  /** Cómo se resolvería el país de cada usuario mapeado, hoy y con la
   *  inferencia por teléfono. La diferencia entre ambos es lo que la
   *  inferencia realmente aportaría. */
  resolutionToday: Record<string, number>;
  resolutionWithPhoneFallback: Record<string, number>;
  /** Usuarios cuyo país inferido del teléfono CONTRADICE su `PERSONAL_COUNTRY`.
   *  Son los casos donde la inferencia habría estado mal si se hubiera usado
   *  como dato en vez de como respaldo. */
  phoneContradictsExplicit: number;
}

export interface BitrixDepartment {
  ID: string;
  NAME: string;
  UF_HEAD?: string;
}

export interface BitrixTimemanStatus {
  STATUS: 'OPENED' | 'CLOSED' | 'EXPIRED' | 'PAUSED';
  TIME_START: string | null;
  TIME_FINISH: string | null;
  ACTIVE: boolean;
}

const PHOTO_TTL = 60 * 60 * 24; // 24 h
const PHOTO_KEY = (userId: string) => `photo:${userId}`;

/**
 * IDs de país de Bitrix a ISO alpha-2. Bitrix guarda PERSONAL_COUNTRY como un
 * ID numérico de su propia lista, no como ISO. Solo se mapean los países donde
 * VLA tiene gente; un ID desconocido queda en null y el resolver (OrgService)
 * cae al DEFAULT_COUNTRY en vez de asignar un país equivocado.
 *
 * NOTA: este mapa es una conjetura, no un dato verificado contra el portal
 * real de Bitrix — nunca se vio la lista real de IDs de país de esta cuenta.
 */
const BITRIX_COUNTRY_ISO: Record<string, string> = {
  '1':  'CR', // Costa Rica
  '2':  'NI', // Nicaragua
  '3':  'PA', // Panamá
  '4':  'GT', // Guatemala
  '5':  'HN', // Honduras
  '6':  'SV', // El Salvador
};

/**
 * Domain-specific Bitrix helper for the office plugin.
 * Delegates all API calls to ctx.bitrix (core OAuth2 client).
 */
export class BitrixService {
  constructor(private readonly ctx: PluginContext) {}

  isConfigured(): boolean {
    return this.ctx.bitrix?.isConfigured() ?? false;
  }

  // ── User list ───────────────────────────────────────────────────────────────

  async getBitrixUsers(): Promise<BitrixUser[]> {
    return this.ctx.bitrix!.callAll<BitrixUser>('user.get', {
      FILTER: { ACTIVE: true },
      SELECT: ['ID', 'NAME', 'LAST_NAME', 'EMAIL', 'PERSONAL_PHOTO',
               'UF_DEPARTMENT', 'PERSONAL_COUNTRY',
               'PERSONAL_MOBILE', 'PERSONAL_PHONE', 'WORK_PHONE'],
    });
  }

  // ── Email-based VLA user lookup ────────────────────────────────────────────

  private async getVlaEmailMap(): Promise<Map<string, string>> {
    const vlaUsers = await this.ctx.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true },
    });
    return new Map((vlaUsers as any[]).map((u: any) => [u.email.toLowerCase(), u.id as string]));
  }

  // ── Photo sync ─────────────────────────────────────────────────────────────

  async syncPhotos(): Promise<{ synced: number; skipped: number }> {
    if (!this.isConfigured()) {
      this.ctx.logger.warn('Bitrix sync skipped: not configured');
      return { synced: 0, skipped: 0 };
    }

    this.ctx.logger.log('Iniciando sincronización de fotos desde Bitrix...');

    const [bitrixUsers, vlaByEmail] = await Promise.all([
      this.getBitrixUsers(),
      this.getVlaEmailMap(),
    ]);

    let synced = 0;
    let skipped = 0;

    for (const bu of bitrixUsers) {
      if (!bu.PERSONAL_PHOTO) { skipped++; continue; }
      const email = bu.EMAIL?.toLowerCase();
      if (!email) { skipped++; continue; }
      const userId = vlaByEmail.get(email);
      if (!userId) { skipped++; continue; }

      await this.ctx.redis.set(PHOTO_KEY(userId), bu.PERSONAL_PHOTO, PHOTO_TTL);
      synced++;
    }

    this.ctx.logger.log(`Fotos sincronizadas: ${synced}, sin foto/usuario: ${skipped}`);
    return { synced, skipped };
  }

  async getPhotoUrl(userId: string): Promise<string | null> {
    return this.ctx.redis.get(PHOTO_KEY(userId));
  }

  async getAllPhotoUrls(userIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    await Promise.all(
      userIds.map(async (id) => {
        const url = await this.ctx.redis.get(PHOTO_KEY(id));
        if (url) map.set(id, url);
      }),
    );
    return map;
  }

  // ── Org structure sync (departamento, jefe directo, país) ──────────────────

  /**
   * Mide qué tan resoluble es el país de cada colaborador con los datos actuales.
   * **Solo lectura**: no escribe en `BitrixUserMapping` ni en ninguna otra tabla.
   *
   * No devuelve ni un número de teléfono. Los teléfonos son datos personales de
   * empleados y este endpoint existe para decidir un diseño, no para exportarlos:
   * reporta formas (`international`/`local`/`empty`), prefijos de país, y conteos.
   */
  async countryCoverageReport(): Promise<CountryCoverageReport> {
    const empty: CountryCoverageReport = {
      bitrixActiveUsers: 0, mappedToVlaUsers: 0, withPersonalCountry: 0,
      personalCountryRawValues: {}, unmappedCountryIds: [],
      phoneFields: {}, prefixDistribution: {},
      resolutionToday: {}, resolutionWithPhoneFallback: {},
      phoneContradictsExplicit: 0,
    };
    if (!this.isConfigured()) {
      this.ctx.logger.warn('Diagnóstico de país omitido: Bitrix no configurado');
      return empty;
    }

    let bitrixUsers: BitrixUser[];
    let emailMap: Map<string, string>;
    try {
      [bitrixUsers, emailMap] = await Promise.all([
        this.getBitrixUsers(),
        this.getVlaEmailMap(),
      ]);
    } catch (e) {
      this.ctx.logger.warn(`Diagnóstico de país: Bitrix inalcanzable: ${e}`);
      return empty;
    }

    // Overrides manuales existentes: hoy ganan sobre todo lo demás.
    const overrides = await this.ctx.prisma.userProfileOverride.findMany();
    const overriddenCountry = new Map(
      (overrides as any[]).filter(o => o.country).map(o => [o.userId, o.country as string]),
    );

    const PHONE_FIELDS = ['PERSONAL_MOBILE', 'PERSONAL_PHONE', 'WORK_PHONE'] as const;
    const bump = (obj: Record<string, number>, key: string) => { obj[key] = (obj[key] ?? 0) + 1; };

    const r: CountryCoverageReport = {
      ...empty,
      personalCountryRawValues: {}, phoneFields: {}, prefixDistribution: {},
      resolutionToday: {}, resolutionWithPhoneFallback: {},
    };
    for (const f of PHONE_FIELDS) r.phoneFields[f] = {};

    r.bitrixActiveUsers = bitrixUsers.length;
    const unmapped = new Set<string>();

    for (const bu of bitrixUsers) {
      const vlaUserId = emailMap.get((bu.EMAIL ?? '').toLowerCase());

      // La forma de los teléfonos se mide para TODOS, mapeados o no: sirve para
      // saber si el campo está poblado en el portal.
      let phoneCountry: string | null = null;
      for (const f of PHONE_FIELDS) {
        const raw = (bu as any)[f] as string | undefined;
        bump(r.phoneFields[f], phoneShape(raw));
        const p = prefixOf(raw);
        if (p) bump(r.prefixDistribution, p);
        // Prioridad: móvil personal primero — es la mejor señal de dónde vive
        // alguien. El de trabajo suele ser una línea corporativa y no dice nada.
        if (!phoneCountry) phoneCountry = countryFromPhone(raw);
      }

      const rawCountry = bu.PERSONAL_COUNTRY != null ? String(bu.PERSONAL_COUNTRY).trim() : '';
      if (rawCountry) {
        r.withPersonalCountry++;
        bump(r.personalCountryRawValues, rawCountry);
        if (!BITRIX_COUNTRY_ISO[rawCountry]) unmapped.add(rawCountry);
      }

      if (!vlaUserId) continue;
      r.mappedToVlaUsers++;

      const explicitIso = rawCountry ? BITRIX_COUNTRY_ISO[rawCountry] ?? null : null;

      // Cómo se resuelve hoy, y cómo se resolvería con el respaldo por teléfono.
      // La diferencia entre las dos columnas es lo que la inferencia aportaría.
      const today =
        overriddenCountry.has(vlaUserId) ? 'override'
        : explicitIso                    ? 'bitrix'
        :                                  'default';
      bump(r.resolutionToday, today);

      const withFallback =
        overriddenCountry.has(vlaUserId) ? 'override'
        : explicitIso                    ? 'bitrix'
        : phoneCountry                   ? 'phone'
        :                                  'default';
      bump(r.resolutionWithPhoneFallback, withFallback);

      // El caso que prueba que el teléfono no es un dato: contradice lo explícito.
      if (explicitIso && phoneCountry && explicitIso !== phoneCountry) {
        r.phoneContradictsExplicit++;
      }
    }

    r.unmappedCountryIds = [...unmapped].sort();

    this.ctx.logger.log(
      `Diagnóstico de país: ${r.mappedToVlaUsers}/${r.bitrixActiveUsers} mapeados, ` +
      `${r.withPersonalCountry} con PERSONAL_COUNTRY, ` +
      `${r.resolutionWithPhoneFallback.phone ?? 0} se resolverían por teléfono, ` +
      `${r.phoneContradictsExplicit} contradicciones`,
    );
    return r;
  }

  /**
   * Trae departamentos + usuarios de Bitrix y actualiza BitrixUserMapping con
   * departmentId / isDepartmentHead / country. Alimenta a OrgService, que
   * resuelve jefe directo y país (con override manual por encima).
   *
   * Nunca debe propagar una excepción: la corre tanto el endpoint POST
   * /org/sync como el cron de 6 horas, y en este entorno Bitrix puede estar
   * "configurado" (tokens presentes) pero ser inalcanzable en la red (dominio
   * que no resuelve). isConfigured() no detecta ese caso — solo revisa que
   * haya credenciales guardadas — así que las llamadas de red están cubiertas
   * por su propio try/catch, no solo el chequeo inicial.
   */
  async syncOrgStructure(): Promise<{ synced: number; heads: number; withCountry: number }> {
    if (!this.isConfigured()) {
      this.ctx.logger.warn('Sync de organigrama omitido: Bitrix no configurado');
      return { synced: 0, heads: 0, withCountry: 0 };
    }

    let departments: BitrixDepartment[];
    let bitrixUsers: BitrixUser[];
    let emailMap: Map<string, string>;
    try {
      [departments, bitrixUsers, emailMap] = await Promise.all([
        this.ctx.bitrix!.callAll<BitrixDepartment>('department.get', {}),
        this.getBitrixUsers(),
        this.getVlaEmailMap(),
      ]);
    } catch (e) {
      this.ctx.logger.warn(`Sync de organigrama falló (Bitrix inalcanzable): ${e}`);
      return { synced: 0, heads: 0, withCountry: 0 };
    }

    // departamento → bitrixId del jefe
    const headByDept = new Map<string, string>();
    for (const d of departments) {
      if (d.UF_HEAD) headByDept.set(String(d.ID), String(d.UF_HEAD));
    }

    let synced = 0, heads = 0, withCountry = 0;

    for (const bu of bitrixUsers) {
      try {
        const vlaUserId = emailMap.get((bu.EMAIL ?? '').toLowerCase());
        if (!vlaUserId) continue;

        const deptId = bu.UF_DEPARTMENT?.[0] != null ? String(bu.UF_DEPARTMENT[0]) : null;
        const isHead = deptId ? headByDept.get(deptId) === String(bu.ID) : false;

        const rawCountry = bu.PERSONAL_COUNTRY != null ? String(bu.PERSONAL_COUNTRY) : '';
        const country = BITRIX_COUNTRY_ISO[rawCountry] ?? null;
        if (rawCountry && !country) {
          this.ctx.logger.warn(`PERSONAL_COUNTRY desconocido "${rawCountry}" para ${bu.EMAIL}`);
        }

        // upsert, no update: un usuario VLA con email coincidente puede no
        // tener todavía una fila BitrixUserMapping (solo el script de seed la
        // crea hoy). update() lanzaría "record not found" y abortaría el
        // resto del lote — un solo usuario sin mapear no debe tumbar el sync.
        await this.ctx.prisma.bitrixUserMapping.upsert({
          where: { userId: vlaUserId },
          create: { userId: vlaUserId, bitrixUserId: Number(bu.ID), departmentId: deptId, isDepartmentHead: isHead, country },
          update: { departmentId: deptId, isDepartmentHead: isHead, country },
        });

        synced++;
        if (isHead) heads++;
        if (country) withCountry++;
      } catch (e) {
        this.ctx.logger.warn(`Sync de organigrama: error con usuario Bitrix ${bu.ID} (${bu.EMAIL}): ${e}`);
      }
    }

    this.ctx.logger.log(
      `Organigrama: ${synced} usuarios, ${heads} jefes, ${withCountry} con país`,
    );
    return { synced, heads, withCountry };
  }

  // ── Timeman status ──────────────────────────────────────────────────────────

  async getTimemanStatusForUser(bitrixUserId: number): Promise<BitrixTimemanStatus | null> {
    if (!this.isConfigured()) return null;
    try {
      return await this.ctx.bitrix!.call<BitrixTimemanStatus>('timeman.status', {
        USER_ID: bitrixUserId,
      });
    } catch (e) {
      this.ctx.logger.warn(`timeman.status error for bitrix user ${bitrixUserId}: ${e}`);
      return null;
    }
  }

  // ── Timeman open / close ───────────────────────────────────────────────────

  async timemanOpen(bitrixUserId: number): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      // Check current status first — if EXPIRED, close it before opening new day
      const status = await this.getTimemanStatusForUser(bitrixUserId);
      if (status?.STATUS === 'EXPIRED') {
        this.ctx.logger.warn(`timeman: user ${bitrixUserId} has EXPIRED workday, attempting close first`);
        try {
          await this.ctx.bitrix!.call('timeman.close', { USER_ID: bitrixUserId });
        } catch {
          this.ctx.logger.warn(`timeman: could not close EXPIRED workday for ${bitrixUserId} (requires manual close in Bitrix UI)`);
        }
      }
      await this.ctx.bitrix!.call('timeman.open', { USER_ID: bitrixUserId });
      return true;
    } catch (e) {
      this.ctx.logger.warn(`timeman.open error for bitrix user ${bitrixUserId}: ${e}`);
      return false;
    }
  }

  async timemanClose(bitrixUserId: number): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      // Check current status — EXPIRED workdays can't be closed via API
      const status = await this.getTimemanStatusForUser(bitrixUserId);
      if (status?.STATUS === 'EXPIRED') {
        this.ctx.logger.warn(`timeman: user ${bitrixUserId} has EXPIRED workday — must be closed manually from Bitrix UI`);
        return false;
      }
      if (status?.STATUS === 'CLOSED') {
        return true; // already closed
      }
      await this.ctx.bitrix!.call('timeman.close', { USER_ID: bitrixUserId });
      return true;
    } catch (e) {
      this.ctx.logger.warn(`timeman.close error for bitrix user ${bitrixUserId}: ${e}`);
      return false;
    }
  }

  /** Resolve VLA userId → Bitrix user ID via email mapping */
  async getBitrixIdForVlaUser(userId: string): Promise<number | null> {
    const mapping = await this.ctx.prisma.bitrixUserMapping.findFirst({
      where: { userId },
    });
    return mapping?.bitrixUserId ?? null;
  }

  // ── Timeman bulk sync (matches by email) ───────────────────────────────────

  async syncTimemanStatuses(): Promise<Array<{ userId: string; isOpen: boolean }>> {
    if (!this.isConfigured()) return [];

    const [bitrixUsers, vlaByEmail] = await Promise.all([
      this.getBitrixUsers(),
      this.getVlaEmailMap(),
    ]);

    const matched = bitrixUsers.filter(bu => {
      const email = bu.EMAIL?.toLowerCase();
      return email && vlaByEmail.has(email);
    });

    if (matched.length === 0) {
      this.ctx.logger.warn('Timeman sync: no se encontraron usuarios de Bitrix con email coincidente en VLA');
      return [];
    }

    this.ctx.logger.log(`Timeman sync: ${matched.length} usuarios coincidentes por email`);

    const results = await Promise.allSettled(
      matched.map(async (bu) => {
        const userId = vlaByEmail.get(bu.EMAIL.toLowerCase())!;
        const status = await this.getTimemanStatusForUser(Number(bu.ID));
        const isOpen = status?.STATUS === 'OPENED'
          || status?.STATUS === 'PAUSED'
          || (status?.STATUS === 'EXPIRED' && status?.ACTIVE === true);
        this.ctx.logger.log(
          `Timeman [${bu.EMAIL}] bitrixId=${bu.ID} STATUS=${status?.STATUS ?? 'null'} ACTIVE=${status?.ACTIVE} → isOpen=${isOpen}`,
        );
        return { userId, isOpen };
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<{ userId: string; isOpen: boolean }> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  // ── Timeman diagnostic ─────────────────────────────────────────────────────

  async debugTimeman(): Promise<Array<{ email: string; bitrixId: string; raw: any }>> {
    if (!this.isConfigured()) return [];

    const [bitrixUsers, vlaByEmail] = await Promise.all([
      this.getBitrixUsers(),
      this.getVlaEmailMap(),
    ]);

    const matched = bitrixUsers.filter(bu => bu.EMAIL && vlaByEmail.has(bu.EMAIL.toLowerCase()));

    const results = await Promise.allSettled(
      matched.map(async (bu) => {
        try {
          const raw = await this.ctx.bitrix!.callRaw<any>('timeman.status', { USER_ID: Number(bu.ID) });
          return { email: bu.EMAIL, bitrixId: bu.ID, raw };
        } catch (e) {
          return { email: bu.EMAIL, bitrixId: bu.ID, raw: { error: String(e) } };
        }
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  // ── Connection test ─────────────────────────────────────────────────────────

  async testConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
    try {
      const result = await this.ctx.bitrix!.call<any>('user.current');
      return {
        ok: true,
        user: `${result.NAME} ${result.LAST_NAME} (ID: ${result.ID})`,
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
}
