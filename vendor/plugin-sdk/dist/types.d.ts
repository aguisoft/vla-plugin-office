import type { Router } from 'express';
interface PluginLogger {
    log(message: string | object): void;
    warn(message: string | object): void;
    error(message: string | object): void;
    debug(message: string | object): void;
}
/**
 * Contenido del archivo plugin.json que debe incluir todo plugin.
 * Este archivo es la "identidad" del plugin y lo que el sistema valida
 * antes de cargar cualquier código.
 */
export interface PluginManifest {
    /** Identificador único en kebab-case. Ej: "attendance-report" */
    name: string;
    /** Versión semántica. Ej: "1.2.0" */
    version: string;
    /** Descripción corta visible en el panel admin */
    description: string;
    /** Nombre del autor o equipo */
    author: string;
    /**
     * Versión mínima del core VLA requerida.
     * El servidor rechaza plugins que pidan una versión mayor a la instalada.
     */
    vlaMinVersion: string;
    /** Ruta frontend. Ej: "/dashboard/vacaciones". Omitir si es solo backend. */
    route?: string;
    /** Nombre del ícono (Lucide). Ej: "calendar", "users", "chart-bar" */
    icon?: string;
    /** Si true, solo admins pueden ver/usar este plugin */
    adminOnly?: boolean;
    /**
     * Qué puede hacer este plugin.
     * El sistema solo expone lo que se declare aquí.
     *
     * Valores válidos:
     *  read:users         → ctx.prisma.user.findMany(...)
     *  write:users        → ctx.prisma.user.update(...)
     *  read:presence      → ctx.prisma.presenceStatus.findMany(...)
     *  write:presence     → ctx.prisma.presenceStatus.update(...)
     *  read:checkins      → ctx.prisma.checkInRecord.findMany(...)
     *  write:checkins     → ctx.prisma.checkInRecord.create(...)
     *  read:plugins       → ctx.pluginRegistry.getAll()
     *  manage:plugins     → ctx.pluginRegistry.activate/deactivate()
     */
    permissions: PluginPermission[];
    /** Hooks que este plugin escucha y emite (solo para documentación/auditoría) */
    hooks?: {
        listens?: string[];
        emits?: string[];
    };
}
export type PluginPermission = 'read:users' | 'write:users' | 'read:presence' | 'write:presence' | 'read:checkins' | 'write:checkins' | 'read:plugins' | 'manage:plugins';
/**
 * El objeto que recibe el método `register()` de cada plugin.
 * Contiene todo lo que un plugin necesita para funcionar.
 *
 * La disponibilidad de cada propiedad depende de los `permissions` declarados
 * en plugin.json. Intentar acceder a una propiedad sin el permiso correspondiente
 * lanzará un error descriptivo en tiempo de ejecución.
 */
export interface PluginContext {
    /**
     * Router Express montado en /api/v1/p/:pluginName/
     * Registra aquí todos los endpoints HTTP del plugin.
     *
     * @example
     * ctx.router.get('/reporte', ctx.requireAuth(), async (req, res) => {
     *   res.json({ ok: true });
     * });
     */
    router: Router;
    /**
     * Sistema de hooks del core VLA.
     * Permite escuchar eventos de otros plugins y emitir los propios.
     *
     * @example
     * ctx.hooks.registerAction('office.user.checked_in', async ({ userId }) => {
     *   // reaccionar al check-in
     * });
     */
    hooks: PluginHookService;
    /**
     * Cliente Prisma con acceso solo a los modelos permitidos por `permissions`.
     * El tipo refleja exactamente qué modelos están disponibles según los permisos.
     */
    prisma: PluginPrismaClient;
    /**
     * Acceso a Redis con namespace automático: `plugin:{name}:*`
     * No puede leer claves de otros plugins o del core.
     */
    redis: PluginRedisClient;
    /**
     * Logger con prefijo automático del nombre del plugin.
     * Aparece en los logs como: [MiPlugin] mensaje
     */
    logger: PluginLogger;
    /**
     * Crea un cron job. Se limpia automáticamente al desactivar el plugin.
     *
     * @param cronExpression Expresión cron estándar. Ej: "0 9 * * 1-5"
     * @param handler Función a ejecutar
     *
     * @example
     * ctx.cron('0 18 * * 1-5', async () => {
     *   await generarReporteDiario();
     * });
     */
    cron(cronExpression: string, handler: () => Promise<void>): void;
    /**
     * Middleware Express que verifica JWT y opcionalmente el rol del usuario.
     * Usar en rutas que requieren autenticación.
     *
     * @example
     * ctx.router.get('/datos', ctx.requireAuth(), handler);
     * ctx.router.delete('/admin', ctx.requireAuth('ADMIN'), handler);
     */
    requireAuth(role?: 'ADMIN' | 'STAFF' | 'STUDENT' | 'PROFESSOR'): any;
    /** Metadatos del plugin (nombre, versión, config almacenada en BD) */
    plugin: {
        name: string;
        version: string;
        config: Record<string, unknown>;
    };
}
export interface PluginHookService {
    registerAction<T = any>(hookName: string, handler: (payload: T) => void | Promise<void>, options?: {
        priority?: number;
    }): void;
    registerFilter<T = any>(hookName: string, handler: (payload: T) => T | Promise<T>, options?: {
        priority?: number;
    }): void;
    doAction<T = any>(hookName: string, payload: T): Promise<void>;
    applyFilter<T = any>(hookName: string, payload: T): Promise<T>;
    declareHook(hookName: string): void;
}
/** Tipo del cliente Prisma que reciben los plugins (todos los modelos, acceso completo) */
export type PluginPrismaClient = any;
export interface PluginRedisClient {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds?: number): Promise<void>;
    del(key: string): Promise<void>;
    getJson<T>(key: string): Promise<T | null>;
    setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
}
/**
 * Lo que debe exportar el archivo `dist/index.js` de cada plugin.
 *
 * @example
 * // src/index.ts
 * import type { PluginDefinition } from '@vla/plugin-sdk';
 *
 * const plugin: PluginDefinition = {
 *   async register(ctx) {
 *     ctx.router.get('/hello', (req, res) => res.json({ hello: 'world' }));
 *   },
 *   async onDeactivate() {
 *     // limpiar recursos
 *   },
 * };
 *
 * export default plugin;
 */
export interface PluginDefinition {
    /**
     * Punto de entrada del plugin. Se llama una vez al iniciar el servidor.
     * Registra rutas, hooks, crons, etc. aquí.
     */
    register(ctx: PluginContext): Promise<void>;
    /** Opcional. Se llama al desactivar el plugin desde el panel admin. */
    onDeactivate?(): Promise<void>;
    /** Opcional. Se llama la primera vez que se instala el plugin. */
    onInstall?(): Promise<void>;
}
export {};
//# sourceMappingURL=types.d.ts.map