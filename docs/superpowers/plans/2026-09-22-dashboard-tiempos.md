# Dashboard de tiempo por estado — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un dashboard donde cada jefe ve cuánto tiempo pasó cada colaborador directo en cada estado y en la oficina.

**Architecture:** Dos entregas. La primera agrega `CheckInRecord`, que ya tiene historial desde abril, y no toca el esquema. La segunda crea `office_status_intervals` en el esquema propio del plugin (`plugin_office`) vía migración del plugin, escribe una transición por cambio real de estado desde `presence.service`, y agrega ambas fuentes mostrando la diferencia como «sin registrar». Nada de esto toca el esquema del core.

**Tech Stack:** TypeScript, Express (vía `ctx.router`), Postgres por `ctx.query`, React + Tailwind, vitest.

**Spec:** `docs/superpowers/specs/2026-09-22-dashboard-tiempos-design.md`

## Global Constraints

- **Nunca `toISOString()` ni `new Date(iso)` para fechas de calendario.** Usar `src/lib/local-date.ts` (`localDayStart`, `localDayEnd`, `localDateString`, `zonedTimeToUtc`) y `frontend/src/calendar.ts`. Este plugin ya tuvo dos bugs por esto.
- **Zona local = `DEFAULT_TZ` = `'America/Costa_Rica'`**, exportada por `src/lib/local-date.ts`. Postgres y el API corren en UTC.
- **SQL solo por `ctx.query<T>(sql, params)`**, nunca `ctx.prisma.$queryRawUnsafe`. `ctx.query` fija `search_path` a `plugin_office` dentro de una transacción y lo restaura.
- **Cada llamada a `ctx.query` es su propia transacción.** Lo que deba ser atómico va en UNA sentencia.
- **Sin prefijo de esquema en el SQL.** Ni en las migraciones ni en las consultas.
- **OFFLINE no entra en el desglose ni en la base del porcentaje.**
- **Pedir a alguien fuera del alcance devuelve 403, nunca un resultado vacío.**
- Lógica pura en `src/lib/`, probada con vitest sin mocks. Servicios delgados.
- `req.user.sub` es el id del usuario, no `req.user.id`.
- Rutas literales se registran ANTES de las paramétricas del mismo prefijo.
- Todo el texto de interfaz en español.
- Tests: `npx vitest run`. Typecheck: `npx tsc --noEmit`. Ambos deben quedar limpios antes de cada commit.

---

## Estructura de archivos

**Crear:**
- `src/lib/timesheet.ts` — recorte de intervalos, partición por día, límites de período, base del porcentaje, conversión de ausencias
- `src/lib/timesheet.test.ts`
- `src/services/timesheet.service.ts` — agregación de `CheckInRecord` y de `office_status_intervals`
- `migrations/001_status_intervals.up.sql` / `.down.sql`
- `frontend/src/components/TimesheetScreen.tsx` — pantalla completa
- `frontend/src/components/TimesheetBreakdown.tsx` — gráfico de barras apiladas + leyenda
- `frontend/src/components/PeriodPicker.tsx` — día / semana / mes

**Modificar:**
- `src/services/presence.service.ts` — helper `recordTransition`, llamado desde `checkIn`, `checkOut`, `updateStatus`
- `src/index.ts` — endpoints `/timesheet/*`, instanciar `TimesheetService`
- `frontend/src/api.ts` — clientes
- `frontend/src/types.ts` — tipos de respuesta
- `frontend/src/components/HolidayManager.tsx` — selector de jefe en la pestaña Personas
- `plugin.json` — versión y entrada de menú

---

## Entrega 1 — Tiempo en oficina

### Task 1: Lógica pura de períodos y recorte

**Files:**
- Create: `src/lib/timesheet.ts`
- Test: `src/lib/timesheet.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_TZ`, `localDayStart`, `localDayEnd`, `localDateString`, `zonedTimeToUtc` de `src/lib/local-date.ts`
- Produces:
  - `type Period = 'day' | 'week' | 'month'`
  - `interface Span { start: Date; end: Date }`
  - `periodBounds(anchor: Date, period: Period, tz: string): Span`
  - `clipSpan(span: Span, within: Span): Span | null`
  - `splitByLocalDay(span: Span, tz: string): Array<{ date: string; minutes: number }>`
  - `spanMinutes(span: Span): number`

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
import { describe, it, expect } from 'vitest';
import { periodBounds, clipSpan, splitByLocalDay, spanMinutes } from './timesheet';
import { DEFAULT_TZ } from './local-date';

const TZ = DEFAULT_TZ;
/** Instante UTC a partir de hora local de Costa Rica (UTC-6, sin horario de verano). */
const cr = (iso: string) => new Date(`${iso}-06:00`);

describe('periodBounds', () => {
  it('day va de 00:00:00 a 23:59:59.999 locales', () => {
    const { start, end } = periodBounds(cr('2026-09-22T15:30:00'), 'day', TZ);
    expect(start.toISOString()).toBe('2026-09-22T06:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-23T05:59:59.999Z');
  });

  it('week arranca lunes y termina domingo', () => {
    // 2026-09-22 es martes; la semana va del lunes 21 al domingo 27.
    const { start, end } = periodBounds(cr('2026-09-22T15:30:00'), 'week', TZ);
    expect(start.toISOString()).toBe('2026-09-21T06:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-28T05:59:59.999Z');
  });

  it('week con ancla en domingo NO salta a la semana siguiente', () => {
    const { start } = periodBounds(cr('2026-09-27T10:00:00'), 'week', TZ);
    expect(start.toISOString()).toBe('2026-09-21T06:00:00.000Z');
  });

  it('month cubre el mes local completo', () => {
    const { start, end } = periodBounds(cr('2026-09-22T15:30:00'), 'month', TZ);
    expect(start.toISOString()).toBe('2026-09-01T06:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-01T05:59:59.999Z');
  });

  it('month de enero no retrocede a diciembre', () => {
    const { start } = periodBounds(cr('2026-01-15T10:00:00'), 'month', TZ);
    expect(start.toISOString()).toBe('2026-01-01T06:00:00.000Z');
  });
});

describe('clipSpan', () => {
  const within = { start: cr('2026-09-22T00:00:00'), end: cr('2026-09-22T23:59:59') };

  it('un span contenido queda igual', () => {
    const s = { start: cr('2026-09-22T09:00:00'), end: cr('2026-09-22T11:00:00') };
    expect(clipSpan(s, within)).toEqual(s);
  });

  it('un span que empieza antes y termina despues cubre el rango completo', () => {
    const s = { start: cr('2026-09-21T09:00:00'), end: cr('2026-09-23T11:00:00') };
    expect(clipSpan(s, within)).toEqual(within);
  });

  it('un span enteramente fuera devuelve null', () => {
    const s = { start: cr('2026-09-25T09:00:00'), end: cr('2026-09-25T11:00:00') };
    expect(clipSpan(s, within)).toBeNull();
  });

  it('un span que apenas toca el borde devuelve null y no un rango de cero', () => {
    const s = { start: within.end, end: cr('2026-09-23T10:00:00') };
    expect(clipSpan(s, within)).toBeNull();
  });
});

describe('splitByLocalDay', () => {
  it('un span dentro de un dia da un solo tramo', () => {
    const out = splitByLocalDay({ start: cr('2026-09-22T09:00:00'), end: cr('2026-09-22T11:30:00') }, TZ);
    expect(out).toEqual([{ date: '2026-09-22', minutes: 150 }]);
  });

  it('un span que cruza medianoche se parte en dos dias', () => {
    const out = splitByLocalDay({ start: cr('2026-09-22T23:00:00'), end: cr('2026-09-23T01:00:00') }, TZ);
    expect(out).toEqual([
      { date: '2026-09-22', minutes: 60 },
      { date: '2026-09-23', minutes: 60 },
    ]);
  });

  it('un span de tres dias da tres tramos con el del medio completo', () => {
    const out = splitByLocalDay({ start: cr('2026-09-21T22:00:00'), end: cr('2026-09-23T02:00:00') }, TZ);
    expect(out.map(x => x.date)).toEqual(['2026-09-21', '2026-09-22', '2026-09-23']);
    expect(out[1].minutes).toBe(1440);
  });

  it('cruce de fin de mes: 30 de septiembre a 1 de octubre', () => {
    const out = splitByLocalDay({ start: cr('2026-09-30T23:30:00'), end: cr('2026-10-01T00:30:00') }, TZ);
    expect(out).toEqual([
      { date: '2026-09-30', minutes: 30 },
      { date: '2026-10-01', minutes: 30 },
    ]);
  });
});

describe('spanMinutes', () => {
  it('redondea al minuto mas cercano', () => {
    expect(spanMinutes({ start: cr('2026-09-22T09:00:00'), end: cr('2026-09-22T09:00:29') })).toBe(0);
    expect(spanMinutes({ start: cr('2026-09-22T09:00:00'), end: cr('2026-09-22T09:00:31') })).toBe(1);
  });

  it('un span invertido da cero, no negativo', () => {
    expect(spanMinutes({ start: cr('2026-09-22T11:00:00'), end: cr('2026-09-22T09:00:00') })).toBe(0);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/lib/timesheet.test.ts`
Expected: FAIL — `Failed to resolve import "./timesheet"`

- [ ] **Step 3: Implementar**

```ts
import { localDayStart, localDayEnd, localDateString, zonedTimeToUtc } from './local-date';

export type Period = 'day' | 'week' | 'month';

export interface Span {
  start: Date;
  end: Date;
}

/**
 * Límites del período que contiene `anchor`, en zona local.
 *
 * La semana arranca LUNES, como los calendarios de acá. `getDay()` pone el
 * domingo en 0, así que un ancla en domingo saltaría a la semana siguiente sin
 * el ajuste — el caso que la prueba fija.
 */
export function periodBounds(anchor: Date, period: Period, tz: string): Span {
  if (period === 'day') {
    return { start: localDayStart(anchor, tz), end: localDayEnd(anchor, tz) };
  }

  const dayStart = localDayStart(anchor, tz);
  const localDate = localDateString(anchor, tz);
  const [y, m, d] = localDate.split('-').map(Number);

  if (period === 'week') {
    // Día de la semana leído a mediodía local para que ningún desfase de zona
    // lo corra de día.
    const noon = zonedTimeToUtc(y, m, d, 12, 0, 0, tz);
    const mondayFirst = (noon.getUTCDay() + 6) % 7;
    const start = new Date(dayStart.getTime() - mondayFirst * 86_400_000);
    const lastDay = new Date(start.getTime() + 6 * 86_400_000);
    return { start, end: localDayEnd(lastDay, tz) };
  }

  const start = zonedTimeToUtc(y, m, 1, 0, 0, 0, tz);
  const nextMonth = zonedTimeToUtc(y, m + 1, 1, 0, 0, 0, tz);
  return { start, end: new Date(nextMonth.getTime() - 1) };
}

/**
 * Intersección de `span` con `within`, o `null` si no se tocan.
 *
 * Un contacto de borde exacto devuelve `null` y no un rango de duración cero:
 * un tramo de 0 minutos en el reporte es ruido que no aporta nada.
 */
export function clipSpan(span: Span, within: Span): Span | null {
  const start = span.start > within.start ? span.start : within.start;
  const end = span.end < within.end ? span.end : within.end;
  return start < end ? { start, end } : null;
}

/** Minutos del span, redondeados. Un span invertido da 0, nunca negativo. */
export function spanMinutes(span: Span): number {
  const ms = span.end.getTime() - span.start.getTime();
  return ms <= 0 ? 0 : Math.round(ms / 60_000);
}

/**
 * Parte un span en tramos por día local. Un Concentrado de lunes 23:00 a martes
 * 01:00 aporta 60 minutos a cada día, no 120 a uno solo.
 */
export function splitByLocalDay(span: Span, tz: string): Array<{ date: string; minutes: number }> {
  const out: Array<{ date: string; minutes: number }> = [];
  if (span.end <= span.start) return out;

  let cursor = span.start;
  // Cota de seguridad: un span corrupto de años no debe colgar el proceso.
  for (let guard = 0; guard < 400 && cursor < span.end; guard++) {
    const dayEnd = localDayEnd(cursor, tz);
    const chunkEnd = dayEnd < span.end ? dayEnd : span.end;
    const minutes = spanMinutes({ start: cursor, end: chunkEnd });
    if (minutes > 0) out.push({ date: localDateString(cursor, tz), minutes });
    cursor = new Date(chunkEnd.getTime() + 1);
  }
  return out;
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/lib/timesheet.test.ts`
Expected: PASS, 17 pruebas.

- [ ] **Step 5: Typecheck y commit**

```bash
npx tsc --noEmit
git add src/lib/timesheet.ts src/lib/timesheet.test.ts
git commit -m "feat(office): logica pura de periodos y recorte para el dashboard de tiempos"
```

---

### Task 2: Servicio de tiempo en oficina

**Files:**
- Create: `src/services/timesheet.service.ts`
- Test: `src/lib/timesheet.test.ts` (ampliar, ver paso 1)

**Interfaces:**
- Consumes: `Span`, `splitByLocalDay`, `clipSpan`, `spanMinutes` de Task 1
- Produces:
  - `interface OfficeDay { date: string; minutes: number }`
  - `interface OfficeTime { userId: string; totalMinutes: number; byDay: OfficeDay[] }`
  - `class TimesheetService { constructor(ctx: PluginContext, tzOf: () => string); async officeTime(userIds: string[], span: Span): Promise<Map<string, OfficeTime>> }`

`tzOf` es una función y no un string porque `ctx.plugin.config` se hidrata DESPUÉS de registrar el plugin — mismo patrón que `SnapshotService` y `OrgService`.

- [ ] **Step 1: Escribir la prueba pura del agregador**

Agregar a `src/lib/timesheet.test.ts`. La prueba cubre la función pura que el servicio usará; la consulta a base se verifica en el Task 5 contra datos reales.

```ts
import { aggregateSessions } from './timesheet';

describe('aggregateSessions', () => {
  const TZ2 = DEFAULT_TZ;
  const within = { start: cr('2026-09-21T00:00:00'), end: cr('2026-09-27T23:59:59') };

  it('suma sesiones cerradas por dia', () => {
    const out = aggregateSessions([
      { start: cr('2026-09-21T08:00:00'), end: cr('2026-09-21T12:00:00') },
      { start: cr('2026-09-21T13:00:00'), end: cr('2026-09-21T17:00:00') },
      { start: cr('2026-09-22T08:00:00'), end: cr('2026-09-22T16:00:00') },
    ], within, TZ2);
    expect(out.totalMinutes).toBe(480 + 480);
    expect(out.byDay).toEqual([
      { date: '2026-09-21', minutes: 480 },
      { date: '2026-09-22', minutes: 480 },
    ]);
  });

  it('recorta una sesion que empieza antes del periodo', () => {
    const out = aggregateSessions(
      [{ start: cr('2026-09-20T22:00:00'), end: cr('2026-09-21T02:00:00') }],
      within, TZ2,
    );
    expect(out.totalMinutes).toBe(120);
    expect(out.byDay).toEqual([{ date: '2026-09-21', minutes: 120 }]);
  });

  it('descarta sesiones enteramente fuera del periodo', () => {
    const out = aggregateSessions(
      [{ start: cr('2026-09-10T08:00:00'), end: cr('2026-09-10T17:00:00') }],
      within, TZ2,
    );
    expect(out.totalMinutes).toBe(0);
    expect(out.byDay).toEqual([]);
  });

  it('una sesion que cruza medianoche aporta a los dos dias', () => {
    const out = aggregateSessions(
      [{ start: cr('2026-09-22T22:00:00'), end: cr('2026-09-23T02:00:00') }],
      within, TZ2,
    );
    expect(out.byDay).toEqual([
      { date: '2026-09-22', minutes: 120 },
      { date: '2026-09-23', minutes: 120 },
    ]);
  });

  it('los dias salen ordenados aunque las sesiones lleguen desordenadas', () => {
    const out = aggregateSessions([
      { start: cr('2026-09-23T08:00:00'), end: cr('2026-09-23T09:00:00') },
      { start: cr('2026-09-21T08:00:00'), end: cr('2026-09-21T09:00:00') },
    ], within, TZ2);
    expect(out.byDay.map(d => d.date)).toEqual(['2026-09-21', '2026-09-23']);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/lib/timesheet.test.ts`
Expected: FAIL — `aggregateSessions is not exported`

- [ ] **Step 3: Implementar `aggregateSessions` en `src/lib/timesheet.ts`**

```ts
export interface OfficeDay {
  date: string;
  minutes: number;
}

export interface OfficeAggregate {
  totalMinutes: number;
  byDay: OfficeDay[];
}

/**
 * Suma sesiones dentro de un período, partidas por día local.
 *
 * Recibe spans ya resueltos (la sesión abierta la cierra el llamador contra
 * `min(now, fin del período)`), así que acá no hay noción de "abierta": eso
 * mantiene la función pura y hace que el caso raro se pruebe en un solo lugar.
 */
export function aggregateSessions(sessions: Span[], within: Span, tz: string): OfficeAggregate {
  const byDate = new Map<string, number>();

  for (const s of sessions) {
    const clipped = clipSpan(s, within);
    if (!clipped) continue;
    for (const { date, minutes } of splitByLocalDay(clipped, tz)) {
      byDate.set(date, (byDate.get(date) ?? 0) + minutes);
    }
  }

  const byDay = [...byDate.entries()]
    .map(([date, minutes]) => ({ date, minutes }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { totalMinutes: byDay.reduce((acc, d) => acc + d.minutes, 0), byDay };
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/lib/timesheet.test.ts`
Expected: PASS, 22 pruebas.

- [ ] **Step 5: Crear el servicio**

```ts
import type { PluginContext } from '@vla/plugin-sdk';
import { aggregateSessions, type OfficeAggregate, type Span } from '../lib/timesheet';

export interface OfficeTime extends OfficeAggregate {
  userId: string;
}

export class TimesheetService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly tzOf: () => string,
  ) {}

  /**
   * Tiempo en oficina por persona dentro del período.
   *
   * Una consulta para todo el grupo, no una por persona. `checkOutAt IS NULL`
   * es la sesión abierta: se cierra contra el fin del período (que el llamador
   * ya acotó a `now` cuando el período incluye el presente), para que consultar
   * una semana vieja no muestre una sesión corriendo hasta hoy.
   */
  async officeTime(userIds: string[], span: Span): Promise<Map<string, OfficeTime>> {
    const result = new Map<string, OfficeTime>();
    if (userIds.length === 0) return result;

    const rows = await this.ctx.prisma.checkInRecord.findMany({
      where: {
        userId: { in: userIds },
        checkInAt: { lte: span.end },
        OR: [{ checkOutAt: null }, { checkOutAt: { gte: span.start } }],
      },
      select: { userId: true, checkInAt: true, checkOutAt: true },
      orderBy: { checkInAt: 'asc' },
    });

    const byUser = new Map<string, Span[]>();
    for (const r of rows as any[]) {
      const end: Date = r.checkOutAt ?? span.end;
      const list = byUser.get(r.userId) ?? [];
      list.push({ start: r.checkInAt, end });
      byUser.set(r.userId, list);
    }

    const tz = this.tzOf();
    for (const userId of userIds) {
      const agg = aggregateSessions(byUser.get(userId) ?? [], span, tz);
      result.set(userId, { userId, ...agg });
    }
    return result;
  }
}
```

- [ ] **Step 6: Typecheck y commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/lib/timesheet.ts src/lib/timesheet.test.ts src/services/timesheet.service.ts
git commit -m "feat(office): servicio de tiempo en oficina sobre CheckInRecord"
```

---

### Task 3: Alcance de visibilidad y endpoint

**Files:**
- Create: nada
- Modify: `src/index.ts`
- Test: `src/lib/timesheet.test.ts` (ampliar)

**Interfaces:**
- Consumes: `TimesheetService.officeTime`, `org.managedUserIds(viewerId)`, `periodBounds`
- Produces: `GET /p/office/timesheet/office?anchor=&period=&userId=`

- [ ] **Step 1: Prueba pura del alcance**

```ts
import { resolveScope } from './timesheet';

describe('resolveScope', () => {
  const managed = new Set(['b', 'c']);

  it('uno mismo siempre esta incluido', () => {
    expect(resolveScope('a', managed, false).has('a')).toBe(true);
  });

  it('un jefe ve a sus directos', () => {
    const s = resolveScope('a', managed, false);
    expect([...s].sort()).toEqual(['a', 'b', 'c']);
  });

  it('quien no tiene gente a cargo solo se ve a si mismo', () => {
    expect([...resolveScope('z', new Set(), false)]).toEqual(['z']);
  });

  it('ADMIN devuelve null, que significa "sin restriccion"', () => {
    expect(resolveScope('a', managed, true)).toBeNull();
  });
});

describe('canSee', () => {
  it('ADMIN ve a cualquiera', () => {
    expect(canSee(null, 'quien-sea')).toBe(true);
  });

  it('fuera del conjunto es false', () => {
    expect(canSee(new Set(['a', 'b']), 'z')).toBe(false);
  });

  it('dentro del conjunto es true', () => {
    expect(canSee(new Set(['a', 'b']), 'b')).toBe(true);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/lib/timesheet.test.ts`
Expected: FAIL — `resolveScope is not exported`

- [ ] **Step 3: Implementar en `src/lib/timesheet.ts`**

```ts
/**
 * Conjunto de personas que el viewer puede consultar, o `null` si no tiene
 * restricción (ADMIN).
 *
 * `null` y no "todos los ids" a propósito: el endpoint no siempre tiene la
 * lista completa a mano, y un `null` explícito obliga al llamador a decidir qué
 * significa, en vez de comparar contra un conjunto que podría estar incompleto
 * y negar acceso por accidente.
 */
export function resolveScope(
  viewerId: string,
  managedUserIds: Set<string>,
  isAdmin: boolean,
): Set<string> | null {
  if (isAdmin) return null;
  return new Set<string>([viewerId, ...managedUserIds]);
}

export function canSee(scope: Set<string> | null, userId: string): boolean {
  return scope === null || scope.has(userId);
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/lib/timesheet.test.ts`
Expected: PASS, 29 pruebas.

- [ ] **Step 5: Registrar el endpoint en `src/index.ts`**

Instanciar el servicio junto a los demás (cerca de donde se crea `snapshot`):

```ts
const timesheet = new TimesheetService(ctx, tz);
```

Registrar el endpoint. **Va antes de cualquier ruta paramétrica bajo `/timesheet`** — hoy no hay ninguna, pero la regla se respeta desde el principio:

```ts
// ── Dashboard de tiempos ────────────────────────────────────────────────────

/**
 * Tiempo en oficina del período. El alcance lo resuelve el servidor: uno mismo
 * más los directos, o todo si es ADMIN.
 *
 * Pedir a alguien fuera del alcance devuelve 403 y no un resultado vacío: un
 * vacío se lee como "no hizo nada" e induce una conclusión falsa sobre una
 * persona.
 */
ctx.router.get('/timesheet/office', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), async (req, res) => {
  const viewerId = (req as any).user?.sub;
  if (!viewerId) return res.status(401).json({ message: 'Unauthorized' });

  const period = (req.query.period as Period) || 'week';
  if (!['day', 'week', 'month'].includes(period)) {
    return res.status(400).json({ message: 'period debe ser day, week o month' });
  }

  const anchorRaw = req.query.anchor as string | undefined;
  const anchor = anchorRaw ? new Date(`${anchorRaw}T12:00:00Z`) : new Date();
  if (Number.isNaN(anchor.getTime())) {
    return res.status(400).json({ message: 'anchor inválido, se espera YYYY-MM-DD' });
  }

  const isAdmin = (req as any).user?.role === 'ADMIN';
  const scope = resolveScope(viewerId, await org.managedUserIds(viewerId), isAdmin);

  const target = (req.query.userId as string) || viewerId;
  if (!canSee(scope, target)) {
    return res.status(403).json({ message: 'No tenés acceso al tiempo de esa persona' });
  }

  const bounds = periodBounds(anchor, period, tz());
  // El fin efectivo nunca pasa del presente: un período que incluye hoy no debe
  // contar horas que todavía no ocurrieron.
  const now = new Date();
  const span = { start: bounds.start, end: bounds.end < now ? bounds.end : now };

  const byUser = await timesheet.officeTime([target], span);
  res.json({
    period,
    from: bounds.start.toISOString(),
    to: bounds.end.toISOString(),
    office: byUser.get(target) ?? { userId: target, totalMinutes: 0, byDay: [] },
  });
});

/** A quién puede consultar el viewer. Alimenta el selector de persona. */
ctx.router.get('/timesheet/scope', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), async (req, res) => {
  const viewerId = (req as any).user?.sub;
  if (!viewerId) return res.status(401).json({ message: 'Unauthorized' });

  const isAdmin = (req as any).user?.role === 'ADMIN';
  const scope = resolveScope(viewerId, await org.managedUserIds(viewerId), isAdmin);

  const where = scope === null ? { isActive: true } : { isActive: true, id: { in: [...scope] } };
  const users = await ctx.prisma.user.findMany({
    where,
    select: { id: true, firstName: true, lastName: true, email: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });

  res.json({ viewerId, isAdmin, users });
});
```

Agregar los imports que falten al inicio de `src/index.ts`:

```ts
import { TimesheetService } from './services/timesheet.service';
import { periodBounds, resolveScope, canSee, type Period } from './lib/timesheet';
```

- [ ] **Step 6: Verificar que las rutas existen y typecheck**

```bash
npx tsc --noEmit
grep -nE "router\.get\('/timesheet" src/index.ts
```
Expected: dos rutas, `/timesheet/office` y `/timesheet/scope`.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/lib/timesheet.ts src/lib/timesheet.test.ts
git commit -m "feat(office): endpoints de tiempo en oficina con alcance por jefe directo"
```

---

### Task 4: Pantalla de tiempos — estructura y tiempo en oficina

**Files:**
- Create: `frontend/src/components/TimesheetScreen.tsx`, `frontend/src/components/PeriodPicker.tsx`
- Modify: `frontend/src/api.ts`, `frontend/src/types.ts`, `frontend/src/App.tsx`, `plugin.json`

**Interfaces:**
- Consumes: `GET /p/office/timesheet/office`, `GET /p/office/timesheet/scope`
- Produces: componente `TimesheetScreen`, accesible desde el encabezado de Office

- [ ] **Step 1: Tipos en `frontend/src/types.ts`**

```ts
export interface OfficeDay {
  date: string;
  minutes: number;
}

export interface TimesheetOfficeResponse {
  period: 'day' | 'week' | 'month';
  from: string;
  to: string;
  office: { userId: string; totalMinutes: number; byDay: OfficeDay[] };
}

export interface TimesheetScope {
  viewerId: string;
  isAdmin: boolean;
  users: Array<{ id: string; firstName: string; lastName: string; email: string }>;
}
```

- [ ] **Step 2: Clientes en `frontend/src/api.ts`**

```ts
export const getTimesheetScope = () =>
  api.get<TimesheetScope>(`${PLUGIN}/timesheet/scope`);

export const getOfficeTime = (period: string, anchor: string, userId?: string) => {
  const qs = new URLSearchParams({ period, anchor });
  if (userId) qs.set('userId', userId);
  return api.get<TimesheetOfficeResponse>(`${PLUGIN}/timesheet/office?${qs}`);
};
```

Agregar `TimesheetOfficeResponse` y `TimesheetScope` al import de tipos al inicio del archivo.

- [ ] **Step 3: `PeriodPicker.tsx`**

```tsx
import { isoDate } from '../calendar';

export type Period = 'day' | 'week' | 'month';

const ETIQUETA: Record<Period, string> = { day: 'Día', week: 'Semana', month: 'Mes' };
const PASO_DIAS: Record<Period, number> = { day: 1, week: 7, month: 0 };

/**
 * Selector de período: día, semana o mes, con navegación adelante y atrás.
 *
 * El ancla es un `YYYY-MM-DD` y se mueve con componentes locales, nunca con
 * `toISOString()`: en UTC−6 eso correría un día en cada click.
 */
export function PeriodPicker({ period, anchor, onChange }: {
  period: Period;
  anchor: string;
  onChange: (period: Period, anchor: string) => void;
}) {
  const mover = (dir: -1 | 1) => {
    const [y, m, d] = anchor.split('-').map(Number);
    if (period === 'month') {
      const nm = m + dir;
      const ny = nm < 1 ? y - 1 : nm > 12 ? y + 1 : y;
      const mm = nm < 1 ? 12 : nm > 12 ? 1 : nm;
      onChange(period, isoDate(ny, mm - 1, 1));
      return;
    }
    const base = new Date(y, m - 1, d);
    base.setDate(base.getDate() + dir * PASO_DIAS[period]);
    onChange(period, isoDate(base.getFullYear(), base.getMonth(), base.getDate()));
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
        {(['day', 'week', 'month'] as Period[]).map(p => (
          <button
            key={p}
            onClick={() => onChange(p, anchor)}
            className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
              period === p ? 'bg-white font-semibold text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {ETIQUETA[p]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => mover(-1)} aria-label="Período anterior"
          className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">‹</button>
        <button onClick={() => mover(1)} aria-label="Período siguiente"
          className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">›</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `TimesheetScreen.tsx` — versión de Entrega 1**

Modal a pantalla completa con el mismo lenguaje visual que `HolidayManager` (`max-w-5xl`, `rounded-3xl`, encabezado con título y botón de cerrar). Contenido:

1. Encabezado: título «Tiempos», `PeriodPicker`, botón cerrar.
2. Selector de persona: `<select>` con `scope.users`. Si `users.length === 1`, no se renderiza el selector — se muestra el nombre.
3. Tarjeta «Tiempo en oficina»: total del período en `Xh Ym` y una barra por día con su etiqueta.
4. Estado vacío: «Sin tiempo registrado en este período.»

Formateo de minutos a `Xh Ym` con un helper local:

```tsx
function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
```

- [ ] **Step 5: Enganchar en `App.tsx`**

**Restricción descubierta al planificar, cambia lo acordado.** La spec pide «ruta propia en el menú» (`/dashboard/office-tiempos`). No es alcanzable: **un plugin declara UNA ruta**. `plugin.json` tiene `route` en singular, `NavSidebar.tsx` renderiza `plugin.route`, y `dashboard/[plugin]/page.tsx` resuelve por nombre o por esa ruta única. Una segunda entrada de menú exigiría un segundo plugin (manifiesto, esquema y despliegue propios, con la lógica de estados y organigrama duplicada) o un cambio en el core.

Lo que sí se hace, y conserva casi todo lo buscado: **vista a pantalla completa dentro de la SPA de Office**, no un modal, con enlace directo por query param. Se ve como una pantalla propia y es compartible por URL; lo que no da es una línea aparte en el menú lateral.

Estado en `App.tsx`, leyendo el parámetro al montar para que `/dashboard/office?view=tiempos` abra directo:

```tsx
const [view, setView] = useState<'oficina' | 'tiempos'>(
  new URLSearchParams(window.location.search).get('view') === 'tiempos' ? 'tiempos' : 'oficina',
);

const irA = (v: 'oficina' | 'tiempos') => {
  setView(v);
  const url = new URL(window.location.href);
  if (v === 'tiempos') url.searchParams.set('view', 'tiempos');
  else url.searchParams.delete('view');
  window.history.replaceState({}, '', url);
};
```

Cuando `view === 'tiempos'`, `App` renderiza `<TimesheetScreen onClose={() => irA('oficina')} />` **en lugar** del mapa, dentro del mismo `PluginShell`. Ocupa la pantalla completa y `onClose` vuelve a la oficina.

Botón en `officeActions` con el mismo estilo que el de Feriados pero **sin gating por `office.manage`** — todo el mundo puede ver lo suyo:

```tsx
<button onClick={() => irA('tiempos')}
  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] text-gray-500 hover:bg-gray-100 transition-colors"
  title="Tiempos">
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
  Tiempos
</button>
```

Y el render junto a los otros modales:

```tsx
// Reemplaza al mapa, no se superpone: es una vista, no un modal.
{view === 'tiempos'
  ? <TimesheetScreen onClose={() => irA('oficina')} />
  : /* ...el mapa y la barra lateral de siempre... */ null}
```

- [ ] **Step 6: Build y verificación en navegador**

```bash
npx tsc --noEmit
npm run build:frontend
```

Levantar el entorno local (`docker start vla_postgres vla_redis`, `npm run dev -w @vla/api` en `vla-system`), copiar `dist` y `frontend/dist` al plugin instalado, y abrir la pantalla. Verificar:
- el total coincide con la suma de las barras diarias
- cambiar de día a semana a mes cambia los números
- las flechas no corren el período un día de más
- un usuario sin gente a cargo no ve el selector de persona

- [ ] **Step 7: Commit**

```bash
git add frontend/src plugin.json
git commit -m "feat(office): pantalla de tiempos con el reporte de tiempo en oficina"
```

---

### Task 5: Verificación contra datos reales y despliegue de la Entrega 1

**Files:** ninguno nuevo

- [ ] **Step 1: Contrastar contra la base**

En el entorno local, comparar lo que muestra la pantalla contra SQL directo para un usuario y una semana:

```sql
SELECT date_trunc('day', "checkInAt" AT TIME ZONE 'America/Costa_Rica') AS dia,
       SUM("totalMinutes") AS minutos
  FROM virtual_office."CheckInRecord"
 WHERE "userId" = '<id>' AND "checkOutAt" IS NOT NULL
   AND "checkInAt" >= '<inicio>' AND "checkInAt" < '<fin>'
 GROUP BY 1 ORDER BY 1;
```

Los totales deben coincidir salvo por sesiones que cruzan medianoche, donde la pantalla parte y el SQL de arriba no. Verificar ese caso a mano con una sesión que cruce.

- [ ] **Step 2: Suite completa**

```bash
npx tsc --noEmit && npx vitest run && npm run build && npm run build:frontend
```

- [ ] **Step 3: Subir versión y desplegar**

Subir `version` a `1.3.0` en `plugin.json`, `package.json` y `frontend/package.json`. `vlaMinVersion` queda en `1.1.0`.

Desplegar según `reference_plugin_deploy_restart`: respaldo, copiar `dist` + `ui` al volumen, y **`sudo docker restart vla_api`** — `docker compose up -d` NO recarga plugins.

- [ ] **Step 4: Verificar en producción**

```bash
# version cargada
sudo docker logs vla_api --since 5m 2>&1 | grep -oE "office v[0-9.]+" | tail -1
# el endpoint existe (401 = existe y pide auth)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/v1/p/office/timesheet/scope
# sin errores propios
sudo docker logs vla_api --since 5m 2>&1 | grep '"level":50' | grep -c '"context":"office"'
```

- [ ] **Step 5: Commit**

```bash
git add plugin.json package.json frontend/package.json
git commit -m "chore(office): version 1.3.0 — entrega 1 del dashboard de tiempos"
```

---

## Entrega 2 — Desglose por estado

### Task 6: Migración de la tabla de intervalos

**Files:**
- Create: `migrations/001_status_intervals.up.sql`, `migrations/001_status_intervals.down.sql`

`vla-plugin-office` no tiene directorio `migrations/` todavía: esta es la primera. El core las aplica al arrancar con `search_path` fijado en `plugin_office` y las registra en `core."PluginMigration"`.

- [ ] **Step 1: Escribir la migración de subida**

```sql
-- Plugin: office | Migration 001 — Historial de estados
-- Schema: plugin_office (aislado; el core fija el search_path, por eso no hay prefijo)
--
-- Existe porque PresenceStatus guarda UNA fila por persona y se sobreescribe en
-- cada cambio: el estado anterior se pierde. Sin esta tabla no hay forma de
-- responder "cuanto tiempo estuvo en Concentrado".

CREATE TABLE IF NOT EXISTS office_status_intervals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text        NOT NULL,
  status        text        NOT NULL,
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz,
  justification text,
  source        text        NOT NULL DEFAULT 'WEB'
);

CREATE INDEX IF NOT EXISTS office_status_intervals_user_time_idx
  ON office_status_intervals (user_id, started_at);

CREATE INDEX IF NOT EXISTS office_status_intervals_time_idx
  ON office_status_intervals (started_at);

-- La invariante que impide contar doble: como maximo UN intervalo abierto por
-- persona. La garantiza Postgres, no el cuidado del programador.
CREATE UNIQUE INDEX IF NOT EXISTS office_status_intervals_one_open_per_user
  ON office_status_intervals (user_id) WHERE ended_at IS NULL;

-- Siembra: sin esto nadie aparece hasta su siguiente transicion, y quien este
-- sentado en Concentrado hoy no se contabiliza por horas. El tiempo anterior no
-- se inventa (no existe), pero desde este minuto todos quedan contados.
INSERT INTO office_status_intervals (user_id, status, started_at, justification, source)
SELECT p."userId", p.status::text, now(), p.justification, 'SEED'
  FROM virtual_office."PresenceStatus" p
 WHERE NOT EXISTS (
   SELECT 1 FROM office_status_intervals i
    WHERE i.user_id = p."userId" AND i.ended_at IS NULL
 );
```

- [ ] **Step 2: Escribir la migración de bajada**

```sql
-- Plugin: office | Rollback 001
-- OJO: destruye el historial de estados completo. No hay forma de reconstruirlo.
DROP TABLE IF EXISTS office_status_intervals;
```

- [ ] **Step 3: Aplicar en local y verificar la invariante**

Reiniciar el API local para que aplique la migración. Después:

```sql
SET search_path TO plugin_office, public;
-- la siembra dejo un intervalo abierto por persona
SELECT count(*) FROM office_status_intervals WHERE ended_at IS NULL;
-- el indice unico rechaza un segundo abierto para la misma persona
INSERT INTO office_status_intervals (user_id, status, started_at)
VALUES ((SELECT user_id FROM office_status_intervals LIMIT 1), 'FOCUS', now());
```
Expected: el `INSERT` falla con `duplicate key value violates unique constraint "office_status_intervals_one_open_per_user"`.

- [ ] **Step 4: Commit**

```bash
git add migrations/
git commit -m "feat(office): migracion de office_status_intervals con siembra e invariante"
```

---

### Task 7: Registro de transiciones

**Files:**
- Modify: `src/services/presence.service.ts`

**Interfaces:**
- Produces: `private async recordTransition(userId: string, status: string, at: Date, justification: string | null, source: CheckSource): Promise<void>`

Los tres caminos que escriben `status` son `checkIn` (`AVAILABLE`), `checkOut` (`OFFLINE`) y `updateStatus`. `layout.service.ts` solo escribe posición y el `upsert` de `index.ts:583` usa `update: {}`. No hay más.

- [ ] **Step 1: Implementar el helper**

```ts
/**
 * Registra el cambio de estado en el historial.
 *
 * Cerrar el intervalo abierto e insertar el nuevo van en UNA sentencia con CTE:
 * cada llamada a `ctx.query` abre su propia transacción, así que dos llamadas
 * separadas podrían dejar a alguien sin intervalo abierto si falla la segunda.
 *
 * Si el intervalo abierto ya tiene ese mismo estado, solo se actualiza la
 * justificación. Reescribir el motivo de un Concentrado no debe cortar el
 * tiempo acumulado.
 *
 * NUNCA lanza: un fallo acá no puede impedir que alguien cambie su estado. El
 * costo aceptado es que un fallo deja el historial divergido en silencio, y eso
 * se detecta en el reporte como "sin registrar" creciendo.
 */
private async recordTransition(
  userId: string,
  status: string,
  at: Date,
  justification: string | null,
  source: CheckSource,
): Promise<void> {
  try {
    const abierto = await this.ctx.query<{ status: string }>(
      'SELECT status FROM office_status_intervals WHERE user_id = $1 AND ended_at IS NULL LIMIT 1',
      [userId],
    );

    if (abierto.length > 0 && abierto[0].status === status) {
      await this.ctx.query(
        'UPDATE office_status_intervals SET justification = $2 WHERE user_id = $1 AND ended_at IS NULL',
        [userId, justification],
      );
      return;
    }

    // Una sola sentencia: el CTE cierra y el INSERT abre, atómicamente.
    // Empieza con WITH y lleva RETURNING para que `ctx.query` la ejecute por la
    // vía que devuelve filas.
    await this.ctx.query(
      `WITH cerrado AS (
         UPDATE office_status_intervals
            SET ended_at = $2
          WHERE user_id = $1 AND ended_at IS NULL
        RETURNING id
       )
       INSERT INTO office_status_intervals (user_id, status, started_at, justification, source)
       VALUES ($1, $3, $2, $4, $5)
       RETURNING id`,
      [userId, at.toISOString(), status, justification, source],
    );
  } catch (e) {
    this.ctx.logger.warn(`No se pudo registrar la transición de ${userId} a ${status}: ${e}`);
  }
}
```

- [ ] **Step 2: Llamarlo desde los tres caminos**

En `checkIn`, después del `upsert` de `presenceStatus` y antes del `return`:

```ts
await this.recordTransition(userId, 'AVAILABLE', now, null, source);
```

En `checkOut`, en el mismo lugar relativo:

```ts
await this.recordTransition(userId, 'OFFLINE', now, null, source);
```

En `updateStatus`, después del `upsert`:

```ts
await this.recordTransition(userId, status, now, extra.justification ?? null, 'WEB');
```

- [ ] **Step 3: Verificar la cadena en local**

Reiniciar el API. Con un usuario de prueba: entrar a la oficina, cambiar a Concentrado con justificación, cambiar a Almuerzo, salir. Después:

```sql
SET search_path TO plugin_office, public;
SELECT status, started_at, ended_at, source, justification
  FROM office_status_intervals
 WHERE user_id = '<id>' ORDER BY started_at;
```
Expected: cadena sin huecos — el `ended_at` de cada fila es el `started_at` de la siguiente, exactamente una fila con `ended_at IS NULL`, y la de Concentrado con su justificación.

- [ ] **Step 4: Verificar que reescribir la justificación no parte el intervalo**

Poner Concentrado, anotar el `started_at`, volver a poner Concentrado con otra justificación. El `started_at` no debe cambiar y no debe aparecer una fila nueva.

- [ ] **Step 5: Verificar el escape de texto libre**

Poner un estado con justificación `O'Brien dijo \"no\" \\ ayer`. Confirmar que se guarda literal y que no rompe la consulta. `standard_conforming_strings` está en `on` en producción, así que duplicar comillas simples alcanza; esta prueba lo confirma en vez de asumirlo.

- [ ] **Step 6: Verificar que un fallo no rompe la presencia**

Renombrar temporalmente la tabla (`ALTER TABLE office_status_intervals RENAME TO tmp_x`), cambiar de estado, y confirmar que **el cambio de estado funciona** y que aparece el warning en el log. Restaurar el nombre después.

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/services/presence.service.ts
git commit -m "feat(office): registrar transiciones de estado en office_status_intervals"
```

---

### Task 8: Agregación del desglose y reconciliación

**Files:**
- Modify: `src/lib/timesheet.ts`, `src/lib/timesheet.test.ts`, `src/services/timesheet.service.ts`

**Interfaces:**
- Produces:
  - `interface StatusSlice { status: string; minutes: number }`
  - `aggregateIntervals(intervals: Array<Span & { status: string }>, within: Span, tz: string): StatusSlice[]`
  - `reconcile(connectedMinutes: number, slices: StatusSlice[]): { slices: StatusSlice[]; unaccountedMinutes: number }`
  - `TimesheetService.statusBreakdown(userId: string, span: Span): Promise<StatusSlice[]>`
  - `TimesheetService.coverageStart(): Promise<string | null>`

- [ ] **Step 1: Pruebas**

```ts
import { aggregateIntervals, reconcile } from './timesheet';

describe('aggregateIntervals', () => {
  const TZ3 = DEFAULT_TZ;
  const within = { start: cr('2026-09-22T00:00:00'), end: cr('2026-09-22T23:59:59') };

  it('suma por estado y descarta OFFLINE', () => {
    const out = aggregateIntervals([
      { status: 'AVAILABLE', start: cr('2026-09-22T08:00:00'), end: cr('2026-09-22T10:00:00') },
      { status: 'FOCUS',     start: cr('2026-09-22T10:00:00'), end: cr('2026-09-22T12:00:00') },
      { status: 'AVAILABLE', start: cr('2026-09-22T13:00:00'), end: cr('2026-09-22T14:00:00') },
      { status: 'OFFLINE',   start: cr('2026-09-22T18:00:00'), end: cr('2026-09-22T23:00:00') },
    ], within, TZ3);
    expect(out).toEqual([
      { status: 'AVAILABLE', minutes: 180 },
      { status: 'FOCUS', minutes: 120 },
    ]);
  });

  it('recorta contra el periodo', () => {
    const out = aggregateIntervals(
      [{ status: 'FOCUS', start: cr('2026-09-21T22:00:00'), end: cr('2026-09-22T02:00:00') }],
      within, TZ3,
    );
    expect(out).toEqual([{ status: 'FOCUS', minutes: 120 }]);
  });

  it('ordena de mayor a menor', () => {
    const out = aggregateIntervals([
      { status: 'BRB',   start: cr('2026-09-22T08:00:00'), end: cr('2026-09-22T08:30:00') },
      { status: 'FOCUS', start: cr('2026-09-22T09:00:00'), end: cr('2026-09-22T12:00:00') },
    ], within, TZ3);
    expect(out.map(s => s.status)).toEqual(['FOCUS', 'BRB']);
  });

  it('sin intervalos devuelve lista vacia', () => {
    expect(aggregateIntervals([], within, TZ3)).toEqual([]);
  });
});

describe('reconcile', () => {
  it('la diferencia sale como sin registrar', () => {
    const out = reconcile(480, [{ status: 'FOCUS', minutes: 300 }]);
    expect(out.unaccountedMinutes).toBe(180);
  });

  it('cuando cuadra, sin registrar es cero', () => {
    const out = reconcile(300, [{ status: 'FOCUS', minutes: 300 }]);
    expect(out.unaccountedMinutes).toBe(0);
  });

  it('si los tramos superan el tiempo conectado, se recortan proporcionalmente', () => {
    // Puede pasar si alguien quedo con estado activo fuera de una sesion de
    // oficina. Mostrar mas tiempo en estados que conectado seria absurdo.
    const out = reconcile(100, [
      { status: 'FOCUS', minutes: 150 },
      { status: 'AVAILABLE', minutes: 50 },
    ]);
    expect(out.unaccountedMinutes).toBe(0);
    expect(out.slices.reduce((a, s) => a + s.minutes, 0)).toBe(100);
    expect(out.slices[0].minutes).toBe(75);
  });

  it('tiempo conectado cero deja todo en cero', () => {
    const out = reconcile(0, [{ status: 'FOCUS', minutes: 60 }]);
    expect(out.slices.every(s => s.minutes === 0)).toBe(true);
    expect(out.unaccountedMinutes).toBe(0);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/lib/timesheet.test.ts`
Expected: FAIL — `aggregateIntervals is not exported`

- [ ] **Step 3: Implementar**

```ts
export interface StatusSlice {
  status: string;
  minutes: number;
}

/** Estados que no entran en el desglose ni en la base del porcentaje. */
const EXCLUIDOS = new Set(['OFFLINE']);

/**
 * Minutos por estado dentro del período.
 *
 * OFFLINE queda fuera: un fin de semana son 62 horas en ese estado y se come
 * todo el gráfico, dejando los porcentajes sin significado.
 */
export function aggregateIntervals(
  intervals: Array<Span & { status: string }>,
  within: Span,
  tz: string,
): StatusSlice[] {
  const porEstado = new Map<string, number>();

  for (const iv of intervals) {
    if (EXCLUIDOS.has(iv.status)) continue;
    const clipped = clipSpan({ start: iv.start, end: iv.end }, within);
    if (!clipped) continue;
    // Se parte por día y se vuelve a sumar: el recorte por día es lo que hace
    // que un intervalo que cruza medianoche no se cuente de más en la vista
    // diaria, y usar la misma función acá mantiene los dos totales coherentes.
    const minutes = splitByLocalDay(clipped, tz).reduce((a, x) => a + x.minutes, 0);
    if (minutes > 0) porEstado.set(iv.status, (porEstado.get(iv.status) ?? 0) + minutes);
  }

  return [...porEstado.entries()]
    .map(([status, minutes]) => ({ status, minutes }))
    .sort((a, b) => b.minutes - a.minutes || a.status.localeCompare(b.status));
}

/**
 * Ajusta el desglose contra el tiempo conectado real de `CheckInRecord`.
 *
 * `CheckInRecord` es la autoridad: es el dato que existe desde abril y el que la
 * gente reconoce como su jornada. El desglose es una subdivisión suya.
 *
 * La diferencia se devuelve como `unaccountedMinutes` y se muestra como «sin
 * registrar». Escondida en un redondeo, esa señal —que el registro está
 * perdiendo escrituras— no se vería nunca.
 */
export function reconcile(
  connectedMinutes: number,
  slices: StatusSlice[],
): { slices: StatusSlice[]; unaccountedMinutes: number } {
  const suma = slices.reduce((a, s) => a + s.minutes, 0);

  if (connectedMinutes <= 0) {
    return { slices: slices.map(s => ({ ...s, minutes: 0 })), unaccountedMinutes: 0 };
  }

  if (suma <= connectedMinutes) {
    return { slices, unaccountedMinutes: connectedMinutes - suma };
  }

  // Los tramos superan lo conectado: se recortan proporcionalmente. El último
  // absorbe el resto del redondeo para que la suma cierre exacta.
  const factor = connectedMinutes / suma;
  const ajustados = slices.map(s => ({ ...s, minutes: Math.floor(s.minutes * factor) }));
  const resto = connectedMinutes - ajustados.reduce((a, s) => a + s.minutes, 0);
  if (ajustados.length > 0) ajustados[ajustados.length - 1].minutes += resto;
  return { slices: ajustados, unaccountedMinutes: 0 };
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/lib/timesheet.test.ts`
Expected: PASS, 38 pruebas.

- [ ] **Step 5: Métodos en el servicio**

```ts
/**
 * Intervalos del período. El intervalo abierto se cierra contra el fin del
 * span, que el llamador ya acotó a `now` cuando el período incluye el presente.
 */
async statusBreakdown(userId: string, span: Span): Promise<StatusSlice[]> {
  const rows = await this.ctx.query<{ status: string; started_at: string; ended_at: string | null }>(
    `SELECT status, started_at, ended_at
       FROM office_status_intervals
      WHERE user_id = $1
        AND started_at <= $3
        AND (ended_at IS NULL OR ended_at >= $2)
      ORDER BY started_at`,
    [userId, span.start.toISOString(), span.end.toISOString()],
  );

  const intervals = rows.map(r => ({
    status: r.status,
    start: new Date(r.started_at),
    end: r.ended_at ? new Date(r.ended_at) : span.end,
  }));

  return aggregateIntervals(intervals, span, this.tzOf());
}

/**
 * Fecha desde la que hay registro, en `YYYY-MM-DD` local, o `null` si la tabla
 * está vacía. Sale de la tabla y no de una constante para que siga siendo cierta
 * aunque se recree o se purgue.
 */
async coverageStart(): Promise<string | null> {
  const rows = await this.ctx.query<{ min: string | null }>(
    'SELECT MIN(started_at)::text AS min FROM office_status_intervals',
  );
  const min = rows[0]?.min;
  return min ? localDateString(new Date(min), this.tzOf()) : null;
}
```

Agregar al import del servicio: `aggregateIntervals`, `type StatusSlice`, y `localDateString` de `../lib/local-date`.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/lib/timesheet.ts src/lib/timesheet.test.ts src/services/timesheet.service.ts
git commit -m "feat(office): agregacion del desglose por estado con reconciliacion"
```

---

### Task 9: Ampliar el endpoint con el desglose

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Extender `/timesheet/office`**

Reemplazar el `res.json` final por:

```ts
const office = byUser.get(target) ?? { userId: target, totalMinutes: 0, byDay: [] };
const crudo = await timesheet.statusBreakdown(target, span);
const { slices, unaccountedMinutes } = reconcile(office.totalMinutes, crudo);

res.json({
  period,
  from: bounds.start.toISOString(),
  to: bounds.end.toISOString(),
  office,
  breakdown: slices,
  unaccountedMinutes,
  coverageStart: await timesheet.coverageStart(),
});
```

Agregar `reconcile` al import de `./lib/timesheet`.

- [ ] **Step 2: Verificar a mano**

Con el entorno local y una sesión real, pedir:

```bash
curl -s -b /tmp/ck.txt 'http://localhost:3001/api/v1/p/office/timesheet/office?period=day&anchor=2026-09-22' | python3 -m json.tool
```
Expected: `breakdown` con los estados del día, `unaccountedMinutes` ≥ 0, `coverageStart` con la fecha de la siembra, y la suma de `breakdown` + `unaccountedMinutes` igual a `office.totalMinutes`.

- [ ] **Step 3: Verificar el 403**

Pedir `?userId=<id de alguien que no es tu directo>` con un usuario no ADMIN.
Expected: `403` con `{"message":"No tenés acceso al tiempo de esa persona"}`, **no** un 200 con datos vacíos.

- [ ] **Step 4: Commit**

```bash
npx tsc --noEmit
git add src/index.ts
git commit -m "feat(office): el endpoint de tiempos devuelve el desglose por estado"
```

---

### Task 10: Gráfico del desglose y aviso de cobertura

**Files:**
- Create: `frontend/src/components/TimesheetBreakdown.tsx`
- Modify: `frontend/src/components/TimesheetScreen.tsx`, `frontend/src/types.ts`, `frontend/src/api.ts`

- [ ] **Step 1: Ampliar los tipos**

```ts
export interface StatusSlice {
  status: string;
  minutes: number;
}
```

Y en `TimesheetOfficeResponse`:

```ts
  breakdown: StatusSlice[];
  unaccountedMinutes: number;
  coverageStart: string | null;
```

- [ ] **Step 2: `TimesheetBreakdown.tsx`**

Barra apilada horizontal más leyenda. Los colores salen de `statusConfig.ts` (`STATUS_CFG[status].color`) para que un Concentrado se vea igual acá que en el mapa. El tramo «sin registrar» va en `#e5e7eb` con la etiqueta «Sin registrar».

```tsx
import { cfgOf } from '../statusConfig';
import type { StatusSlice } from '../types';

const SIN_REGISTRAR = '#e5e7eb';

export function TimesheetBreakdown({ slices, unaccountedMinutes, totalMinutes }: {
  slices: StatusSlice[];
  unaccountedMinutes: number;
  totalMinutes: number;
}) {
  if (totalMinutes <= 0) {
    return <p className="py-6 text-center text-xs text-gray-400">Sin tiempo conectado en este período.</p>;
  }

  const tramos = [
    ...slices.map(s => ({ label: cfgOf(s.status).label, color: cfgOf(s.status).color, minutes: s.minutes })),
    ...(unaccountedMinutes > 0
      ? [{ label: 'Sin registrar', color: SIN_REGISTRAR, minutes: unaccountedMinutes }]
      : []),
  ];

  const pct = (m: number) => (m / totalMinutes) * 100;

  return (
    <div>
      <div className="flex h-6 w-full overflow-hidden rounded-xl">
        {tramos.map(t => (
          <div
            key={t.label}
            style={{ width: `${pct(t.minutes)}%`, backgroundColor: t.color }}
            title={`${t.label}: ${Math.round(pct(t.minutes))}%`}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1">
        {tramos.map(t => (
          <li key={t.label} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ backgroundColor: t.color }} />
            <span className="flex-1 text-gray-600">{t.label}</span>
            <span className="tabular-nums text-gray-500">{Math.round(pct(t.minutes))}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Aviso de cobertura en `TimesheetScreen`**

Cuando `coverageStart` existe y el período consultado empieza antes:

```tsx
{coverageStart && from.slice(0, 10) < coverageStart && (
  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
    <p className="text-[11px] leading-relaxed text-amber-800">
      El desglose por estado empezó a registrarse el <strong>{fmtDateOnly(coverageStart)}</strong>.
      Antes de esa fecha solo hay tiempo en oficina — un desglose vacío acá no significa
      que no se trabajó.
    </p>
  </div>
)}
```

El aviso importa: durante las primeras semanas la mayoría de las consultas caen parcial o totalmente fuera del rango con datos, y el tiempo en oficina SÍ tendrá números en ese mismo período.

- [ ] **Step 4: Build y verificación en navegador**

```bash
npx tsc --noEmit && npm run build:frontend
```

Verificar:
- los porcentajes suman 100
- los colores coinciden con los del mapa (Concentrado `#60a5fa`, Almuerzo `#fb923c`)
- «Sin registrar» aparece cuando hay diferencia y desaparece cuando no
- consultando una semana anterior a la siembra aparece el aviso de cobertura
- responsive a 390px sin desborde
- cero errores de consola

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(office): grafico del desglose por estado con aviso de cobertura"
```

---

### Task 11: Ausencias y feriados del período

**Files:**
- Modify: `src/lib/timesheet.ts`, `src/lib/timesheet.test.ts`, `src/services/timesheet.service.ts`, `src/index.ts`, `frontend/src/components/TimesheetScreen.tsx`

Las ausencias y los feriados **no viven en `PresenceStatus`** — se calculan al vuelo en el snapshot — así que no aparecen en los intervalos y hay que traerlos de su propia fuente.

**Interfaces:**
- Consumes: `absences.listForUserDetailed(userId, from, to)` → `AbsenceRecord[]` con `{ id, userId, type, startAt, endAt, justification? }`; `holidays.effectiveByUserId(instant, countryOf, tz)` → `Map<userId, justification|null>`
- Produces:
  - `interface AbsenceTally { type: string; days: number; minutes: number }`
  - `tallyAbsences(records, within, workdayHours, tz): AbsenceTally[]`
  - `TimesheetService.absences(userId, span): Promise<AbsenceTally[]>`
- Config nueva: `WORKDAY_HOURS`, leída como `(ctx.plugin.config.WORKDAY_HOURS as number) || 8`

- [ ] **Step 1: Pruebas**

```ts
import { tallyAbsences } from './timesheet';

describe('tallyAbsences', () => {
  const TZ4 = DEFAULT_TZ;
  const semana = { start: cr('2026-09-21T00:00:00'), end: cr('2026-09-27T23:59:59') };

  it('VACACIONES de 3 dias da 3 dias y 24 horas con jornada de 8', () => {
    const out = tallyAbsences([
      { type: 'VACACIONES', startAt: cr('2026-09-21T00:00:00'), endAt: cr('2026-09-23T23:59:59') },
    ], semana, 8, TZ4);
    expect(out).toEqual([{ type: 'VACACIONES', days: 3, minutes: 3 * 8 * 60 }]);
  });

  it('PERMISO usa su duracion real, no la jornada completa', () => {
    // Un permiso de 2 horas no puede contar como un dia entero.
    const out = tallyAbsences([
      { type: 'PERMISO', startAt: cr('2026-09-22T14:00:00'), endAt: cr('2026-09-22T16:00:00') },
    ], semana, 8, TZ4);
    expect(out).toEqual([{ type: 'PERMISO', days: 0, minutes: 120 }]);
  });

  it('recorta una ausencia que empieza antes del periodo', () => {
    const out = tallyAbsences([
      { type: 'INCAPACIDAD', startAt: cr('2026-09-19T00:00:00'), endAt: cr('2026-09-22T23:59:59') },
    ], semana, 8, TZ4);
    expect(out[0].days).toBe(2); // solo lunes 21 y martes 22
  });

  it('descarta ausencias enteramente fuera del periodo', () => {
    const out = tallyAbsences([
      { type: 'VACACIONES', startAt: cr('2026-08-01T00:00:00'), endAt: cr('2026-08-05T23:59:59') },
    ], semana, 8, TZ4);
    expect(out).toEqual([]);
  });

  it('agrupa varias del mismo tipo', () => {
    const out = tallyAbsences([
      { type: 'PERMISO', startAt: cr('2026-09-21T09:00:00'), endAt: cr('2026-09-21T10:00:00') },
      { type: 'PERMISO', startAt: cr('2026-09-23T09:00:00'), endAt: cr('2026-09-23T11:00:00') },
    ], semana, 8, TZ4);
    expect(out).toEqual([{ type: 'PERMISO', days: 0, minutes: 180 }]);
  });

  it('una jornada distinta cambia las horas pero no los dias', () => {
    const out = tallyAbsences([
      { type: 'VACACIONES', startAt: cr('2026-09-21T00:00:00'), endAt: cr('2026-09-22T23:59:59') },
    ], semana, 6, TZ4);
    expect(out).toEqual([{ type: 'VACACIONES', days: 2, minutes: 2 * 6 * 60 }]);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/lib/timesheet.test.ts`
Expected: FAIL — `tallyAbsences is not exported`

- [ ] **Step 3: Implementar**

```ts
export interface AbsenceTally {
  type: string;
  /** Días completos, solo para las de rango. PERMISO siempre da 0. */
  days: number;
  minutes: number;
}

/** Tipos que ocupan el día entero. PERMISO no está: lleva hora real. */
const DIA_COMPLETO = new Set(['VACACIONES', 'INCAPACIDAD']);

/**
 * Ausencias del período, en días y en horas equivalentes.
 *
 * Un día de vacaciones no tiene duración medible: no hay dato del que
 * inferirla, así que se convierte con una jornada fija configurable. PERMISO es
 * la excepción — viaja con hora de inicio y fin dentro del mismo día, así que
 * aporta su duración real. Contar un permiso de dos horas como un día entero
 * inflaría el reporte de quien pidió un rato para un trámite.
 */
export function tallyAbsences(
  records: Array<{ type: string; startAt: Date; endAt: Date }>,
  within: Span,
  workdayHours: number,
  tz: string,
): AbsenceTally[] {
  const porTipo = new Map<string, { days: number; minutes: number }>();

  for (const r of records) {
    const clipped = clipSpan({ start: r.startAt, end: r.endAt }, within);
    if (!clipped) continue;

    const acc = porTipo.get(r.type) ?? { days: 0, minutes: 0 };
    if (DIA_COMPLETO.has(r.type)) {
      const dias = splitByLocalDay(clipped, tz).length;
      acc.days += dias;
      acc.minutes += dias * workdayHours * 60;
    } else {
      acc.minutes += spanMinutes(clipped);
    }
    porTipo.set(r.type, acc);
  }

  return [...porTipo.entries()]
    .map(([type, v]) => ({ type, ...v }))
    .sort((a, b) => b.minutes - a.minutes || a.type.localeCompare(b.type));
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/lib/timesheet.test.ts`
Expected: PASS, 44 pruebas.

- [ ] **Step 5: Método en el servicio**

El constructor de `TimesheetService` recibe ahora también el servicio de ausencias y la jornada:

```ts
constructor(
  private readonly ctx: PluginContext,
  private readonly tzOf: () => string,
  private readonly absencesSvc: AbsenceService,
  private readonly workdayHoursOf: () => number,
) {}

async absences(userId: string, span: Span): Promise<AbsenceTally[]> {
  const rows = await this.absencesSvc.listForUserDetailed(userId, span.start, span.end);
  return tallyAbsences(
    (rows as any[]).map(r => ({ type: r.type, startAt: r.startAt, endAt: r.endAt })),
    span,
    this.workdayHoursOf(),
    this.tzOf(),
  );
}
```

En `src/index.ts`, al instanciar:

```ts
const timesheet = new TimesheetService(
  ctx, tz, absences,
  () => (ctx.plugin.config.WORKDAY_HOURS as number) || 8,
);
```

**Feriados quedan fuera de esta versión.** `holidays.effectiveByUserId` resuelve un instante puntual, no un rango, y recorrer el período día por día llamándolo sería N consultas por semana. Agregar la variante por rango es trabajo propio que no bloquea el resto del dashboard. La pantalla dice «feriados no incluidos» donde correspondería, para que la omisión sea visible y no se lea como «no tuvo feriados».

- [ ] **Step 6: Devolverlas en el endpoint**

Agregar al `res.json` de `/timesheet/office`:

```ts
  absences: await timesheet.absences(target, span),
```

- [ ] **Step 7: Mostrarlas en la pantalla**

Tarjeta «Ausencias» bajo el desglose, con una fila por tipo usando la etiqueta y el ícono de `statusConfig.ts` (`PERMISO` 📄, `VACACIONES` 🏖, `INCAPACIDAD` 🏥). Para las de rango, «3 días · 24h»; para PERMISO, solo «2h». Si no hay ninguna, la tarjeta no se renderiza.

Debajo, en gris pequeño: «Los feriados no están incluidos en este total.»

- [ ] **Step 8: Commit**

```bash
npx tsc --noEmit && npx vitest run && npm run build:frontend
git add src/lib/timesheet.ts src/lib/timesheet.test.ts src/services/timesheet.service.ts src/index.ts frontend/src
git commit -m "feat(office): ausencias del periodo en dias y horas equivalentes"
```

---

### Task 12: Selector de jefe directo

**Files:**
- Modify: `frontend/src/components/HolidayManager.tsx`

14 de 35 personas no tienen `departmentId` en Bitrix, así que no se les resuelve jefe y quedarían invisibles para todos en el dashboard. `PUT /org/:userId` ya acepta `managerUserId` y ya rechaza con 400 que alguien sea su propio jefe; `GET /org/roster` ya devuelve `managerUserId`. Falta solo la interfaz.

- [ ] **Step 1: Agregar el selector en `PersonasTab`**

Junto al selector de país, uno de jefe con las mismas personas del roster:

```tsx
<select
  value={u.managerUserId ?? ''}
  disabled={savingUser === u.userId}
  onChange={e => onSetManager(u.userId, e.target.value || null)}
  aria-label={`Jefe de ${u.firstName} ${u.lastName}`}
  className="flex-shrink-0 rounded-xl border border-gray-200 bg-white px-2 py-1 text-[11px] focus:border-gray-400 focus:outline-none disabled:opacity-50"
>
  <option value="">Sin jefe</option>
  {roster.filter(o => o.userId !== u.userId).map(o => (
    <option key={o.userId} value={o.userId}>{o.firstName} {o.lastName}</option>
  ))}
</select>
```

La propia persona se excluye de sus opciones: el backend lo rechazaría con 400, y ofrecer una opción que siempre falla es una trampa.

- [ ] **Step 2: Handler con la misma defensa que el país**

```ts
async function handleSetManager(userId: string, managerUserId: string | null) {
  const actual = roster?.find(u => u.userId === userId);
  if (!actual) return;
  if ((actual.managerUserId ?? null) === managerUserId) return;

  setSavingUser(userId);
  setError(null);
  try {
    await setOrg(userId, { managerUserId });
    await reloadRoster();
  } catch (e) {
    setError(errorMessage(e, 'No se pudo guardar el jefe'));
  } finally {
    setSavingUser(null);
  }
}
```

El corte por valor sin cambio es el mismo que evita escrituras espurias en el selector de país.

- [ ] **Step 3: Verificar en navegador**

- asignar un jefe y confirmar que persiste tras recargar
- confirmar que la propia persona no aparece entre sus opciones
- confirmar que un cambio sin cambio real no manda petición (interceptar `fetch` y contar)

- [ ] **Step 4: Commit**

```bash
npx tsc --noEmit && npm run build:frontend
git add frontend/src/components/HolidayManager.tsx
git commit -m "feat(office): selector de jefe directo en la pestana Personas"
```

---

### Task 13: Verificación final y despliegue de la Entrega 2

- [ ] **Step 1: Suite completa**

```bash
npx tsc --noEmit && npx vitest run && npm run build && npm run build:frontend
```

- [ ] **Step 2: Verificar la invariante bajo concurrencia**

Disparar dos cambios de estado simultáneos para el mismo usuario y confirmar que sigue habiendo exactamente un intervalo abierto:

```sql
SET search_path TO plugin_office, public;
SELECT user_id, count(*) FROM office_status_intervals
 WHERE ended_at IS NULL GROUP BY user_id HAVING count(*) > 1;
```
Expected: cero filas.

- [ ] **Step 3: Verificar la cadena sin solapes**

```sql
SET search_path TO plugin_office, public;
SELECT a.user_id, a.started_at, a.ended_at, b.started_at
  FROM office_status_intervals a
  JOIN office_status_intervals b
    ON a.user_id = b.user_id AND a.id <> b.id
 WHERE a.ended_at > b.started_at AND a.started_at < b.started_at
 LIMIT 5;
```
Expected: cero filas.

- [ ] **Step 4: Subir versión y desplegar**

Subir a `1.4.0` en los tres `package.json`/`plugin.json`. Desplegar con respaldo previo y **`sudo docker restart vla_api`**.

- [ ] **Step 5: Verificar en producción**

```bash
sudo docker logs vla_api --since 5m 2>&1 | grep -oE "office v[0-9.]+" | tail -1
# la migracion quedo registrada
sudo docker exec vla_postgres psql -U vla_user -d vla_system_db -tAc \
  "SELECT \"pluginName\", version FROM core.\"PluginMigration\" WHERE \"pluginName\"='office';"
# la siembra dejo un intervalo por persona
sudo docker exec vla_postgres psql -U vla_user -d vla_system_db -tAc \
  "SET search_path TO plugin_office, public; SELECT count(*) FROM office_status_intervals WHERE ended_at IS NULL;"
# sin errores propios
sudo docker logs vla_api --since 5m 2>&1 | grep '"level":50' | grep -c '"context":"office"'
```

Expected: `office v1.4.0`, migración `001_status_intervals` registrada, ~36 intervalos abiertos (uno por fila de `PresenceStatus`), cero errores de office.

Los `MessageCounterError` de Baileys tras el reinicio son ruido conocido del plugin de campañas, no de office.

- [ ] **Step 6: Commit**

```bash
git add plugin.json package.json frontend/package.json
git commit -m "chore(office): version 1.4.0 — entrega 2 del dashboard de tiempos"
```

---

## Notas para quien ejecute

- **El dashboard arranca casi vacío.** El desglose solo tiene datos desde el despliegue. No es un bug; es la consecuencia de que `PresenceStatus` nunca guardó historial. El tiempo en oficina sí tiene 157 días.
- **`ctx.query` inlinea los parámetros** por interpolación de string, escapando comillas simples. `standard_conforming_strings` está en `on` en producción, así que alcanza — pero el Task 7 lo verifica con texto real en vez de asumirlo.
- **`docker compose up -d api` no recarga plugins.** Solo recrea el contenedor si cambió la imagen, y el plugin vive en un volumen. Usar `docker restart vla_api`. El síntoma engaña: un endpoint nuevo devuelve 401 (no 404) porque la ruta paramétrica se lo traga.
- **Si un endpoint nuevo bajo `/org` o `/timesheet` devuelve datos raros**, revisar el orden de registro: las rutas literales van antes de las paramétricas.
