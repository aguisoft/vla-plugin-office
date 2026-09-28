# Dashboard de equipo y cumplimiento — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para ejecutar tarea por tarea.
> Los pasos usan casillas (`- [ ]`) para seguimiento.

**Meta:** que un jefe vea a todo su equipo junto y sepa quién se salió de su
norma, y que RRHH vea si el dato es confiable — sin que quien no marca entrada
aparezca como si no hubiera trabajado.

**Arquitectura:** lógica pura nueva en `src/lib/` (norma, días con registro,
entrada habitual, cobertura), un servicio que orquesta, dos endpoints nuevos, y
la pantalla de Tiempos pasa a dos pestañas conservando el detalle por persona que
ya existe.

**Stack:** TypeScript, Express 4 sobre el SDK de plugins del core, Prisma para el
esquema `virtual_office`, `ctx.query` para el esquema `plugin_office`, React +
Tailwind, vitest sin mocks.

**Spec:** `docs/superpowers/specs/2026-09-25-dashboard-equipo-design.md`

## Restricciones globales

- **Zona horaria:** API y Postgres en UTC, operación en UTC−6. Todo bucketing por
  día y hora usa `src/lib/local-date.ts`. Nunca `toISOString()` ni `new Date(iso)`
  para fechas de calendario.
- **`ctx.query`** fija `search_path` dentro de una transacción; el SQL va sin
  prefijo de esquema. Cada llamada es su propia transacción: lo atómico va en UNA
  sentencia.
- **Express 4 no atrapa rechazos de promesas.** Todo handler nuevo va envuelto en
  `asyncRoute` (ya existe en `src/index.ts`).
- **Degradar, no mentir.** Una fuente ilegible devuelve un estado explícito de «no
  disponible», nunca un vacío.
- **Nunca un vacío o un cero que se lea como «no hizo nada».** Principio rector.
- **Lógica pura en `src/lib/`,** probada con vitest sin mocks. Los servicios
  orquestan, no calculan.
- Textos de interfaz y comentarios en español con acentos correctos.
- Tailwind sin `darkMode`: no usar clases `dark:`.
- `plugin.json`, `package.json` y `frontend/package.json` se suben juntos de
  versión, en la tarea de despliegue y no antes.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/lib/team-stats.ts` (nuevo) | Norma, variación, días con registro, entrada habitual, clasificación «sin registrar» |
| `src/lib/team-stats.test.ts` (nuevo) | Sus pruebas |
| `src/lib/coverage.ts` (nuevo) | Matriz hora × día de cobertura |
| `src/lib/coverage.test.ts` (nuevo) | Sus pruebas |
| `src/services/team.service.ts` (nuevo) | Arma las filas del equipo y las excepciones |
| `src/services/compliance.service.ts` (nuevo) | Contadores y listas de toda la organización |
| `src/index.ts` (modificar) | `GET /timesheet/team`, `/compliance`, `/export` |
| `frontend/src/components/TimesheetScreen.tsx` (modificar) | Dos pestañas; conserva el detalle actual |
| `frontend/src/components/TeamTable.tsx` (nuevo) | Tabla del equipo y franja de excepciones |
| `frontend/src/components/CoverageMap.tsx` (nuevo) | Mapa de cobertura |
| `frontend/src/components/ComplianceTab.tsx` (nuevo) | Pestaña de cumplimiento |
| `frontend/src/api.ts`, `types.ts` (modificar) | Firmas y tipos nuevos |

Se decide un archivo por componente y no uno solo grande porque
`TimesheetScreen.tsx` ya tiene ~290 líneas y las tres piezas nuevas se prueban y
se revisan por separado.

---

## ENTREGA 1 — La tabla del equipo

Lo primero es la columna «sin registrar»: sin ella, media empresa parece no
trabajar y el resto del tablero pierde credibilidad antes de que nadie lo use.

### Task 1: Días con registro y clasificación «sin registrar»

**Archivos:**
- Crear: `src/lib/team-stats.ts`
- Probar: `src/lib/team-stats.test.ts`

**Interfaces:**
- Consume: `Span`, `clipSpan`, `splitByLocalDay` de `src/lib/timesheet.ts`;
  `localDateString` de `src/lib/local-date.ts`.
- Produce:
  ```ts
  export interface SesionCruda { start: Date; end: Date }
  export type EstadoRegistro = 'con-registro' | 'sin-registrar';
  export function diasConRegistro(sesiones: SesionCruda[], within: Span, tz: string): string[]
  export function diasHabiles(within: Span, tz: string): string[]
  export function estadoRegistro(sesiones: SesionCruda[], within: Span): EstadoRegistro
  ```

- [ ] **Paso 1: Escribir las pruebas que fallan**

```ts
import { describe, it, expect } from 'vitest';
import { diasConRegistro, diasHabiles, estadoRegistro } from './team-stats';

const TZ = 'America/Costa_Rica';
const span = { start: new Date('2026-09-21T06:00:00Z'), end: new Date('2026-09-28T05:59:59Z') };

describe('estadoRegistro', () => {
  it('sin ninguna sesion que interseque el periodo -> sin-registrar', () => {
    expect(estadoRegistro([], span)).toBe('sin-registrar');
  });

  it('una sesion enteramente ANTES del periodo no cuenta', () => {
    const vieja = [{ start: new Date('2026-09-01T14:00:00Z'), end: new Date('2026-09-01T22:00:00Z') }];
    expect(estadoRegistro(vieja, span)).toBe('sin-registrar');
  });

  it('una sesion que interseca aunque sea un minuto -> con-registro', () => {
    const borde = [{ start: new Date('2026-09-20T20:00:00Z'), end: new Date('2026-09-21T06:01:00Z') }];
    expect(estadoRegistro(borde, span)).toBe('con-registro');
  });

  it('sin-registrar NO es lo mismo que cero minutos: la distincion es el punto', () => {
    // Una sesion degenerada (inicio == fin) existe pero no aporta minutos.
    // Tiene registro: la persona marco. Mostrarla como "sin registrar" seria
    // tan falso como mostrar 0m a quien nunca marco.
    const degenerada = [{ start: new Date('2026-09-22T14:00:00Z'), end: new Date('2026-09-22T14:00:00Z') }];
    expect(estadoRegistro(degenerada, span)).toBe('con-registro');
  });
});

describe('diasConRegistro', () => {
  it('cuenta el DIA, no la sesion: tres sesiones en un dia son un dia', () => {
    const tres = [
      { start: new Date('2026-09-22T14:00:00Z'), end: new Date('2026-09-22T16:00:00Z') },
      { start: new Date('2026-09-22T17:00:00Z'), end: new Date('2026-09-22T19:00:00Z') },
      { start: new Date('2026-09-22T20:00:00Z'), end: new Date('2026-09-22T22:00:00Z') },
    ];
    expect(diasConRegistro(tres, span, TZ)).toEqual(['2026-09-22']);
  });

  it('una sesion que cruza medianoche local cuenta los dos dias', () => {
    // 22:00 a 02:00 hora local = dos dias locales distintos.
    const cruza = [{ start: new Date('2026-09-23T04:00:00Z'), end: new Date('2026-09-23T08:00:00Z') }];
    expect(diasConRegistro(cruza, span, TZ)).toEqual(['2026-09-22', '2026-09-23']);
  });

  it('recorta contra el periodo: lo de afuera no suma dias', () => {
    const desborda = [{ start: new Date('2026-09-19T14:00:00Z'), end: new Date('2026-09-22T16:00:00Z') }];
    expect(diasConRegistro(desborda, span, TZ)).toEqual(['2026-09-21', '2026-09-22']);
  });

  it('sin sesiones da lista vacia', () => {
    expect(diasConRegistro([], span, TZ)).toEqual([]);
  });
});

describe('diasHabiles', () => {
  it('una semana de lunes a domingo da 5 dias habiles', () => {
    expect(diasHabiles(span, TZ)).toEqual([
      '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25',
    ]);
  });

  it('un periodo de un solo sabado da cero', () => {
    const sabado = { start: new Date('2026-09-26T06:00:00Z'), end: new Date('2026-09-27T05:59:59Z') };
    expect(diasHabiles(sabado, TZ)).toEqual([]);
  });
});
```

- [ ] **Paso 2: Correr y ver que fallan**

Ejecutar: `npx vitest run src/lib/team-stats.test.ts`
Esperado: FALLA con «Failed to resolve import ./team-stats».

- [ ] **Paso 3: Implementar**

```ts
import { clipSpan, splitByLocalDay, type Span } from './timesheet';
import { localDateString } from './local-date';

export interface SesionCruda { start: Date; end: Date }

export type EstadoRegistro = 'con-registro' | 'sin-registrar';

/**
 * Si la persona marco o no en el periodo.
 *
 * Es la distincion mas importante de toda la pantalla: en produccion 9 de 22
 * personas activas no marcan entrada, y mostrarlas con "0m" las hace ver como si
 * no hubieran trabajado. `sin-registrar` significa "no hay dato", no "no hubo
 * trabajo", y la interfaz tiene que decirlo con esas palabras.
 *
 * Basta con que UNA sesion interseque el periodo. Una sesion degenerada
 * (inicio == fin) cuenta como registro: la persona marco, aunque no aporte
 * minutos.
 */
export function estadoRegistro(sesiones: SesionCruda[], within: Span): EstadoRegistro {
  const hay = sesiones.some(s => s.start <= within.end && s.end >= within.start);
  return hay ? 'con-registro' : 'sin-registrar';
}

/**
 * Dias LOCALES distintos con al menos un minuto de sesion dentro del periodo.
 *
 * Se cuenta el dia y no la sesion: quien entra y sale tres veces en un dia
 * trabajo un dia, no tres. Y se parte por dia local para que una sesion que
 * cruza medianoche cuente los dos dias que de verdad toco.
 */
export function diasConRegistro(sesiones: SesionCruda[], within: Span, tz: string): string[] {
  const dias = new Set<string>();
  for (const s of sesiones) {
    const clipped = clipSpan(s, within);
    if (!clipped) continue;
    for (const tramo of splitByLocalDay(clipped, tz)) {
      if (tramo.minutes > 0) dias.add(tramo.date);
    }
  }
  return [...dias].sort();
}

/**
 * Dias de lunes a viernes dentro del periodo, en fechas locales.
 *
 * Es el denominador de "N de M dias". Los feriados se descontarian aca cuando
 * RRHH los cargue -- hoy hay 0 en produccion, asi que el denominador es
 * simplemente los habiles. No se inventan: un feriado no cargado no existe.
 */
// OJO: la primera version de este fragmento tenia un bug y se corrigio en
// e1963a1. Anclaba el cursor al dia CALENDARIO UTC de `within.start`, asi que
// cuando la hora UTC del arranque era < 6 —el instante local caia por la tarde
// del dia anterior en UTC−6— el primer dia habil no se generaba nunca.
// La version correcta itera sobre FECHAS locales; ver `src/lib/team-stats.ts`.
export function diasHabiles(within: Span, tz: string): string[] {
  const ultima = localDateString(within.end, tz);
  const cursor = new Date(`${localDateString(within.start, tz)}T12:00:00Z`);
  const out: string[] = [];
  let fecha = localDateString(cursor, tz);
  while (fecha <= ultima) {
    if (esDiaHabil(fecha)) out.push(fecha);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    fecha = localDateString(cursor, tz);
  }
  return out;
}
```

- [ ] **Paso 4: Correr y ver que pasan**

Ejecutar: `npx vitest run src/lib/team-stats.test.ts`
Esperado: PASAN las 10.

- [ ] **Paso 5: Commit**

```bash
git add src/lib/team-stats.ts src/lib/team-stats.test.ts
git commit -m "feat(office): dias con registro y la distincion sin-registrar vs cero"
```

---

### Task 2: La norma y su variación

**Archivos:**
- Modificar: `src/lib/team-stats.ts`
- Probar: `src/lib/team-stats.test.ts`

**Interfaces:**
- Consume: `Period` y `periodBounds` de `src/lib/timesheet.ts`.
- Produce:
  ```ts
  export const PERIODOS_NORMA: Record<Period, number>; // day:20, week:8, month:6
  export interface Norma { promedioMinutos: number; periodosUsados: number }
  export function computeNorm(totalesPrevios: number[]): Norma
  export type Variacion =
    | { tipo: 'sin-base' }
    | { tipo: 'calculada'; pct: number; destacar: boolean };
  export function variacion(actual: number, norma: Norma): Variacion
  ```

- [ ] **Paso 1: Escribir las pruebas que fallan**

```ts
import { computeNorm, variacion, PERIODOS_NORMA } from './team-stats';

describe('computeNorm', () => {
  it('promedia los periodos con actividad', () => {
    expect(computeNorm([600, 500, 700])).toEqual({ promedioMinutos: 600, periodosUsados: 3 });
  });

  it('EXCLUYE los periodos en cero: incluirlos arrastra la norma y todo parece un record', () => {
    // Vacaciones o semanas sin marcar. Con los ceros el promedio daria 300 y una
    // semana normal de 600 se veria como "+100%", que es una alarma falsa.
    expect(computeNorm([600, 0, 600, 0])).toEqual({ promedioMinutos: 600, periodosUsados: 2 });
  });

  it('todos en cero da una norma sin base', () => {
    expect(computeNorm([0, 0, 0])).toEqual({ promedioMinutos: 0, periodosUsados: 0 });
  });

  it('redondea a minuto entero', () => {
    expect(computeNorm([100, 101]).promedioMinutos).toBe(101);
  });
});

describe('variacion', () => {
  it('con menos de 3 periodos comparables NO da porcentaje', () => {
    // Un +300% contra una sola semana previa es ruido que induce a actuar sobre nada.
    expect(variacion(600, { promedioMinutos: 150, periodosUsados: 2 })).toEqual({ tipo: 'sin-base' });
  });

  it('con 3 o mas calcula el porcentaje', () => {
    expect(variacion(660, { promedioMinutos: 600, periodosUsados: 3 }))
      .toEqual({ tipo: 'calculada', pct: 10, destacar: false });
  });

  it('no destaca una fluctuacion de +-15%: destacar todo entrena a ignorar las flechas', () => {
    expect(variacion(690, { promedioMinutos: 600, periodosUsados: 8 }).tipo).toBe('calculada');
    expect((variacion(690, { promedioMinutos: 600, periodosUsados: 8 } ) as any).destacar).toBe(false);
  });

  it('destaca una caida real', () => {
    expect(variacion(420, { promedioMinutos: 600, periodosUsados: 8 }))
      .toEqual({ tipo: 'calculada', pct: -30, destacar: true });
  });

  it('una norma en cero no divide: sin base', () => {
    expect(variacion(600, { promedioMinutos: 0, periodosUsados: 0 })).toEqual({ tipo: 'sin-base' });
  });

  it('las ventanas por tipo de periodo son las de la spec', () => {
    expect(PERIODOS_NORMA).toEqual({ day: 20, week: 8, month: 6 });
  });
});
```

- [ ] **Paso 2: Correr y ver que fallan**

Ejecutar: `npx vitest run src/lib/team-stats.test.ts -t norma`
Esperado: FALLA con «computeNorm is not a function».

- [ ] **Paso 3: Implementar**

```ts
import type { Period } from './timesheet';

/** Cuantos periodos anteriores entran en la norma, por tipo de periodo. */
export const PERIODOS_NORMA: Record<Period, number> = { day: 20, week: 8, month: 6 };

export interface Norma { promedioMinutos: number; periodosUsados: number }

/**
 * Promedio de los periodos anteriores, ignorando los que no tuvieron actividad.
 *
 * Los ceros se excluyen a proposito: unas vacaciones o una racha sin marcar
 * arrastrarian la norma hacia abajo y despues cualquier semana normal se veria
 * como un record. La norma tiene que describir como trabaja la persona cuando
 * trabaja.
 */
export function computeNorm(totalesPrevios: number[]): Norma {
  const conActividad = totalesPrevios.filter(m => m > 0);
  if (conActividad.length === 0) return { promedioMinutos: 0, periodosUsados: 0 };
  const suma = conActividad.reduce((a, b) => a + b, 0);
  return {
    promedioMinutos: Math.round(suma / conActividad.length),
    periodosUsados: conActividad.length,
  };
}

export type Variacion =
  | { tipo: 'sin-base' }
  | { tipo: 'calculada'; pct: number; destacar: boolean };

/** Debajo de esto es fluctuacion normal y no se senala. */
const UMBRAL_DESTACAR = 15;

/** Menos de esto no alcanza para hablar de una norma. */
const MINIMO_PERIODOS = 3;

/**
 * Variacion del periodo actual contra la norma de la persona.
 *
 * Siempre contra uno mismo y nunca contra el equipo: comparar entre companeros
 * premia a quien mas horas aguanta, no a quien mejor trabaja.
 *
 * `destacar` existe para que la interfaz no ponga una flecha en cada fila. Si
 * todo se senala, nada se lee.
 */
export function variacion(actual: number, norma: Norma): Variacion {
  if (norma.periodosUsados < MINIMO_PERIODOS || norma.promedioMinutos <= 0) {
    return { tipo: 'sin-base' };
  }
  const pct = Math.round(((actual - norma.promedioMinutos) / norma.promedioMinutos) * 100);
  return { tipo: 'calculada', pct, destacar: Math.abs(pct) >= UMBRAL_DESTACAR };
}
```

- [ ] **Paso 4: Correr y ver que pasan**

Ejecutar: `npx vitest run src/lib/team-stats.test.ts`
Esperado: PASAN todas.

- [ ] **Paso 5: Commit**

```bash
git add src/lib/team-stats.ts src/lib/team-stats.test.ts
git commit -m "feat(office): norma contra uno mismo, sin base con menos de 3 periodos"
```

---

### Task 3: Entrada habitual

**Archivos:**
- Modificar: `src/lib/team-stats.ts`
- Probar: `src/lib/team-stats.test.ts`

**Interfaces:**
- Produce:
  ```ts
  export function entradaHabitual(primerasEntradas: Date[], tz: string): string | null
  ```
  Devuelve `"HH:MM"` local o `null` si hay menos de 3 muestras.

- [ ] **Paso 1: Escribir las pruebas que fallan**

```ts
import { entradaHabitual } from './team-stats';
const TZ = 'America/Costa_Rica';

describe('entradaHabitual', () => {
  it('usa la MEDIANA, no el promedio: un dia a las 4am no corre la hora habitual', () => {
    // 8:00, 8:10, 8:20, 8:30 y un 4:00 suelto. El promedio daria ~7:24; la
    // mediana se queda en 8:10, que es la hora a la que esta persona entra.
    const dias = [
      new Date('2026-09-21T14:00:00Z'), // 08:00 local
      new Date('2026-09-22T14:10:00Z'), // 08:10
      new Date('2026-09-23T14:20:00Z'), // 08:20
      new Date('2026-09-24T14:30:00Z'), // 08:30
      new Date('2026-09-25T10:00:00Z'), // 04:00  <- el outlier
    ];
    expect(entradaHabitual(dias, TZ)).toBe('08:10');
  });

  it('con numero par de muestras promedia las dos del medio', () => {
    const dias = [
      new Date('2026-09-21T14:00:00Z'), // 08:00
      new Date('2026-09-22T14:20:00Z'), // 08:20
      new Date('2026-09-23T15:00:00Z'), // 09:00
      new Date('2026-09-24T15:40:00Z'), // 09:40
    ];
    expect(entradaHabitual(dias, TZ)).toBe('08:40');
  });

  it('con menos de 3 dias no hay habito que reportar', () => {
    expect(entradaHabitual([new Date('2026-09-21T14:00:00Z')], TZ)).toBeNull();
    expect(entradaHabitual([], TZ)).toBeNull();
  });

  it('ancla en hora LOCAL, no UTC', () => {
    // 14:00 UTC es 08:00 en UTC-6. Si se leyera en UTC diria "14:00".
    const dias = Array.from({ length: 3 }, (_, i) =>
      new Date(`2026-09-2${1 + i}T14:00:00Z`));
    expect(entradaHabitual(dias, TZ)).toBe('08:00');
  });
});
```

- [ ] **Paso 2: Correr y ver que fallan**

Ejecutar: `npx vitest run src/lib/team-stats.test.ts -t entradaHabitual`
Esperado: FALLA con «entradaHabitual is not a function».

- [ ] **Paso 3: Implementar**

```ts
/** Minutos desde la medianoche LOCAL. */
function minutosLocales(d: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const partes = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  // Intl devuelve "24" para la medianoche en algunos entornos; se normaliza.
  const h = Number(partes.hour) % 24;
  return h * 60 + Number(partes.minute);
}

/** Minimo de dias para hablar de un habito. */
const MINIMO_DIAS_HABITO = 3;

/**
 * Hora local a la que la persona suele entrar, como "HH:MM".
 *
 * Mediana y no promedio: el dia que alguien entro a las 4am para una entrega
 * correria el promedio media hora y el numero dejaria de describir su rutina.
 * La mediana lo ignora.
 *
 * Recibe UNA entrada por dia (la primera de cada dia); pasarle todas las
 * sesiones sesgaria el resultado hacia quien entra y sale varias veces.
 */
export function entradaHabitual(primerasEntradas: Date[], tz: string): string | null {
  if (primerasEntradas.length < MINIMO_DIAS_HABITO) return null;

  const mins = primerasEntradas.map(d => minutosLocales(d, tz)).sort((a, b) => a - b);
  const medio = Math.floor(mins.length / 2);
  const mediana = mins.length % 2 === 1
    ? mins[medio]
    : Math.round((mins[medio - 1] + mins[medio]) / 2);

  const hh = String(Math.floor(mediana / 60)).padStart(2, '0');
  const mm = String(mediana % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
```

- [ ] **Paso 4: Correr y ver que pasan**

Ejecutar: `npx vitest run src/lib/team-stats.test.ts`
Esperado: PASAN todas.

- [ ] **Paso 5: Commit**

```bash
git add src/lib/team-stats.ts src/lib/team-stats.test.ts
git commit -m "feat(office): entrada habitual por mediana, resistente al dia raro"
```

---

### Task 4: TeamService

**Archivos:**
- Crear: `src/services/team.service.ts`
- Probar: `src/services/team.service.test.ts`
- Consulta: `src/services/presence.service.test.ts:32,89` tiene el doble mínimo de
  `ctx` con `rejectWith`. Reusar ese patrón, no inventar otro.

**Interfaces:**
- Consume: `OrgService.roster`, `TimesheetService`, `src/lib/team-stats.ts`,
  `periodBounds` de `src/lib/timesheet.ts`.
- Produce:
  ```ts
  export interface FilaEquipo {
    userId: string; firstName: string; lastName: string; email: string;
    // Un valor MÁS que la lógica pura: `no-disponible` para cuando la
    // consulta falla. Si una falla de base se presentara como
    // `sin-registrar`, el jefe vería lo mismo que si la persona no hubiera
    // marcado, y no tendría cómo distinguirlo.
    estado: EstadoRegistro | 'no-disponible';
    totalMinutes: number;
    openSessionCapped: boolean;
    variacion: Variacion;
    diasConRegistro: number;
    diasHabiles: number;
    entradaHabitual: string | null;
    ultimoRegistro: string | null;   // YYYY-MM-DD local
  }
  export interface Excepciones {
    sinMarcar30Dias: Array<{ userId: string; nombre: string }>;
    sesionesAbiertas: Array<{ userId: string; nombre: string; desde: string }>;
  }
  export class TeamService {
    constructor(ctx, tzOf: () => string, maxOpenSessionHoursOf: () => number)
    filas(userIds: string[], period: Period, anchor: Date): Promise<FilaEquipo[]>
    excepciones(userIds: string[]): Promise<Excepciones>
  }
  ```

- [ ] **Paso 1: Escribir las pruebas que fallan**

Cubrir como mínimo, con el doble de `ctx`:
1. Una persona sin ninguna sesión sale con `estado: 'sin-registrar'` y
   `totalMinutes: 0` — y la prueba afirma **las dos cosas**, porque es la
   combinación que la interfaz tiene que distinguir de un cero real.
2. Una persona con sesiones sale `con-registro` y su total coincide con
   `aggregateSessions`.
3. La norma se calcula sobre los períodos anteriores y **no** incluye el actual.
4. Una sesión abierta vieja aparece en `excepciones.sesionesAbiertas` con su fecha
   de inicio.
5. Si la consulta de sesiones rechaza, `filas()` no lanza: devuelve las filas con
   **`estado: 'no-disponible'`** y loguea. Un fallo de base no puede matar el
   proceso ni inventar ceros, y tampoco puede disfrazarse de `sin-registrar`:
   eso le atribuiría a una persona una conducta que no tuvo. La prueba afirma
   las dos cosas — que es `'no-disponible'` y que NO es `'sin-registrar'`.

- [ ] **Paso 2: Correr y ver que fallan**

Ejecutar: `npx vitest run src/services/team.service.test.ts`
Esperado: FALLA con «Failed to resolve import ./team.service».

- [ ] **Paso 3: Implementar**

Puntos que el implementador no puede deducir del contrato:

- **Una sola consulta para todo el equipo y toda la ventana de la norma.** Traer
  `CheckInRecord` de los `userIds` desde el inicio del período más antiguo de la
  norma hasta el fin del período actual, y repartir en memoria. Con 22 personas y
  3.002 filas históricas esto es una consulta, no 22.
- **La sesión abierta se acota** con `capOpenSession` antes de sumar, igual que en
  `TimesheetService.officeTime`. Una sesión olvidada no puede inflar ni el total
  ni la norma.
- **`ultimoRegistro`** sale del `checkInAt` más reciente de la persona **sin
  acotar al período**: la columna responde «¿cuándo se le vio por última vez?», y
  acotarla al período la volvería redundante con `diasConRegistro`.
- **`entradaHabitual`** recibe la primera entrada de cada día local de la ventana
  de la norma, no todas las sesiones.

- [ ] **Paso 4: Correr y ver que pasan**

Ejecutar: `npx vitest run`
Esperado: PASAN todas, incluidas las 283 previas.

- [ ] **Paso 5: Commit**

```bash
git add src/services/team.service.ts src/services/team.service.test.ts
git commit -m "feat(office): TeamService arma las filas del equipo y las excepciones"
```

---

### Task 5: Endpoint `GET /timesheet/team`

**Archivos:**
- Modificar: `src/index.ts`

**Interfaces:**
- Consume: `TeamService`, `resolveScope`, `canSee`, `asyncRoute`.
- Produce: `GET /timesheet/team?period&anchor` → `{ period, from, to, viewerId, isAdmin, filas, excepciones }`

- [ ] **Paso 1: Instanciar el servicio**

El escaneo previo encontró que ninguna tarea creaba la instancia. Va junto a los
demás servicios de `register()`, con el mismo patrón de función perezosa que ya
usan `tz` y `horasConfig` —`ctx.plugin.config` se hidrata después de registrar el
plugin, así que leerlo en el constructor congelaría el valor de respaldo:

```ts
const team = new TeamService(ctx, tz, horasConfig('MAX_OPEN_SESSION_HOURS', 12));
```

- [ ] **Paso 2: Registrar la ruta**

```ts
/**
 * Tabla del equipo del periodo: una fila por persona del alcance.
 *
 * VA ANTES de cualquier ruta parametrica de /timesheet por el orden de registro
 * de Express, igual que /timesheet/scope.
 *
 * El alcance es el mismo de siempre: uno mismo mas los directos, o todo si es
 * ADMIN. No recibe `userId`: esta vista ES el equipo. Quien quiera una persona
 * usa /timesheet/office, que ya valida el 403.
 */
ctx.router.get('/timesheet/team', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (req, res) => {
  const viewerId = (req as any).user?.sub;
  if (!viewerId) return res.status(401).json({ message: 'Unauthorized' });

  const period = (req.query.period as Period) || 'week';
  if (!['day', 'week', 'month'].includes(period)) {
    return res.status(400).json({ message: 'period debe ser day, week o month' });
  }

  const anchorRaw = req.query.anchor as string | undefined;
  // Mediodia UTC a proposito: el mismo YYYY-MM-DD cae en el mismo dia local en
  // UTC-6 sin depender de a que hora corre el servidor.
  const anchor = anchorRaw ? new Date(`${anchorRaw}T12:00:00Z`) : new Date();
  if (Number.isNaN(anchor.getTime())) {
    return res.status(400).json({ message: 'anchor inválido, se espera YYYY-MM-DD' });
  }

  const isAdmin = (req as any).user?.role === 'ADMIN';
  const scope = resolveScope(viewerId, await org.managedUserIds(viewerId), isAdmin);

  const ids = scope === null
    ? (await ctx.prisma.user.findMany({ where: { isActive: true }, select: { id: true } }) as any[]).map(u => u.id)
    : [...scope];

  const bounds = periodBounds(anchor, period, tz());
  const [filas, excepciones] = await Promise.all([
    team.filas(ids, period, anchor),
    team.excepciones(ids),
  ]);

  res.json({
    period,
    from: bounds.start.toISOString(),
    to: bounds.end.toISOString(),
    viewerId,
    isAdmin,
    filas,
    excepciones,
  });
}));
```

- [ ] **Paso 2: Verificar el alcance en vivo**

Con el API local y tres JWT (un ADMIN, un jefe con directos y alguien sin gente a
cargo), confirmar y pegar la salida en el reporte:

```bash
curl -s -H "Authorization: Bearer $JEFE"  'localhost:3001/api/v1/p/office/timesheet/team?period=week' | python3 -m json.tool | head -30
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $SOLO" 'localhost:3001/api/v1/p/office/timesheet/team?period=week'
```

Esperado: el jefe recibe una fila por cada directo más la suya; quien no tiene
gente a cargo recibe 200 con una sola fila (la propia), no 403 — el 403 es para
pedir a alguien ajeno, no para no tener equipo.

- [ ] **Paso 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(office): endpoint GET /timesheet/team acotado al alcance"
```

---

### Task 6: Tabla del equipo en la pantalla

**Archivos:**
- Crear: `frontend/src/components/TeamTable.tsx`
- Modificar: `frontend/src/components/TimesheetScreen.tsx`, `api.ts`, `types.ts`

**Interfaces:**
- Consume: `GET /timesheet/team`.
- Produce: `<TeamTable filas excepciones onSelect={(userId) => void} />`

Requisitos exactos:

1. **Tabla con encabezados** `Persona · Período · vs. su promedio · Días · Entrada
   habitual · Último`. Encabezados reales (`<th scope="col">`), no una fila de
   texto: es la única parte de la interfaz que nombra las columnas.
2. **Los tres estados se ven distintos.** La celda de período nunca muestra `0m`
   para los dos últimos:
   - `con-registro`: el total normal.
   - `sin-registrar`: la palabra `sin registrar` en gris, con ícono de aviso y
     el texto de ayuda «no marcó entrada — no es cero».
   - `no-disponible`: `no disponible` en ámbar, con el texto «no se pudo leer el
     registro — no es un dato sobre esta persona».
   En los dos últimos, `vs. su promedio`, `Días` y `Entrada habitual` muestran `—`.
   Que `sin-registrar` y `no-disponible` se vean IGUAL es un defecto: uno habla
   de la persona y el otro del sistema.
3. **Variación**: `sin-base` muestra `sin base` en gris; `calculada` muestra
   `+8%` / `−21%`, con flecha y color solo si `destacar` es `true`.
4. **Último**: lenguaje relativo — `hoy`, `ayer`, `hace N días`, `nunca`.
   Calculado en hora local con los helpers de `format.ts`.
5. **Clic en una fila** llama a `onSelect(userId)`; la pantalla cambia al detalle
   existente con esa persona y un botón «← Volver al equipo».
6. **Franja de excepciones** arriba, solo si hay algo, en el patrón ámbar ya usado
   (`rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5`, texto
   `text-[11px] text-amber-800`).
7. **Scroll horizontal propio** (`overflow-x-auto`) — seis columnas no entran en
   un teléfono y la página no debe desplazarse de lado.
8. **Si el alcance tiene una sola persona**, no se renderiza la tabla: se va
   directo al detalle. Es el comportamiento de hoy y es el correcto.
9. **`AbortController`** en la carga, con el `AbortError` filtrado por
   `name === 'AbortError'` sin `instanceof`, igual que en `TimesheetScreen`.

- [ ] **Paso 1: Implementar y compilar**

Ejecutar: `npm run build:frontend`
Esperado: sin errores.

- [ ] **Paso 2: Verificar los dos estados que importan**

Con el API local, comprobar en el navegador —o describir con precisión por qué no
se pudo— que una persona sin sesiones muestra `sin registrar` y no `0m`, y que
otra con sesiones muestra su total y su variación.

Playwright está caído desde la entrega anterior. Vale la alternativa: verificar
contra el API real con `curl` que la respuesta trae `estado: 'sin-registrar'` con
`totalMinutes: 0` para quien no marca, y dejar la verificación visual anotada
como deuda en el reporte.

- [ ] **Paso 3: Commit**

```bash
git add frontend/src
git commit -m "feat(office): tabla del equipo; sin registrar deja de verse como cero"
```

---

## ENTREGA 2 — Cobertura horaria

### Task 7: Matriz de cobertura

**Archivos:**
- Crear: `src/lib/coverage.ts`, `src/lib/coverage.test.ts`

**Interfaces:**
- Produce:
  ```ts
  export interface Celda { fecha: string; hora: number; personas: number }
  export interface Matriz { horaMin: number; horaMax: number; fechas: string[]; celdas: Celda[] }
  export function coverageMatrix(
    porPersona: Array<{ userId: string; sesiones: SesionCruda[] }>,
    within: Span, tz: string,
  ): Matriz
  ```

- [ ] **Paso 1: Escribir las pruebas que fallan**

Cubrir:
1. Una persona conectada de 08:00 a 12:00 local marca las horas 8, 9, 10 y 11 con
   `personas: 1`, y no la 12.
2. Dos personas solapadas en la misma hora dan `personas: 2`; la **misma** persona
   con dos sesiones en esa hora da `personas: 1` — se cuentan personas, no
   sesiones.
3. El rango `horaMin`/`horaMax` **se deriva de los datos**, no de una constante:
   alguien que trabaja de 22:00 a 02:00 aparece, no desaparece.
4. Sin sesiones devuelve `fechas: []` y `celdas: []`, y la interfaz no dibuja nada.
5. Una sesión que cruza medianoche local reparte sus horas en los dos días.

- [ ] **Paso 2: Correr y ver que fallan**

Ejecutar: `npx vitest run src/lib/coverage.test.ts`
Esperado: FALLA con «Failed to resolve import ./coverage».

- [ ] **Paso 3: Implementar**

Recortar cada sesión contra el período, acotar las abiertas con `capOpenSession`
antes de contar —una sesión olvidada pintaría cobertura las 24 horas de una
semana— y acumular en un `Map<fecha, Map<hora, Set<userId>>>`. El `Set` es lo que
hace que se cuenten personas y no sesiones.

- [ ] **Paso 4: Correr y ver que pasan**

Ejecutar: `npx vitest run`
Esperado: PASAN todas.

- [ ] **Paso 5: Commit**

```bash
git add src/lib/coverage.ts src/lib/coverage.test.ts
git commit -m "feat(office): matriz de cobertura por hora local, contando personas"
```

---

### Task 8: Mapa de cobertura en la pantalla

**Archivos:**
- Crear: `frontend/src/components/CoverageMap.tsx`
- Modificar: `src/services/team.service.ts`, `src/index.ts` (incluir `cobertura` en
  la respuesta de `/timesheet/team`), `TimesheetScreen.tsx`, `types.ts`

Requisitos:

1. Cuadrícula fechas × horas. Intensidad de color proporcional a `personas /
   máximo`, con el número dentro de la celda.
2. **Celda en cero se ve distinta de celda sin datos**: `·` gris para cero
   personas dentro del rango; nada fuera del rango.
3. Encabezados de día en español abreviado y hora como `8h`.
4. Leyenda de una línea: «cuánta gente del equipo estaba conectada en cada hora».
5. No se renderiza si `fechas` viene vacío.
6. `overflow-x-auto`.

- [ ] **Paso 1: Implementar y compilar**

Ejecutar: `npm run build:frontend && npx vitest run`
Esperado: sin errores, pruebas en verde.

- [ ] **Paso 2: Commit**

```bash
git add src frontend/src
git commit -m "feat(office): mapa de cobertura horaria del equipo"
```

---

## ENTREGA 3 — Cumplimiento

### Task 9: ComplianceService y su endpoint

**Archivos:**
- Crear: `src/services/compliance.service.ts`, `src/services/compliance.service.test.ts`
- Modificar: `src/index.ts`

**Interfaces:**
- Produce:
  ```ts
  export interface Cumplimiento {
    sinMarcar30Dias: Array<{ userId: string; nombre: string; departamento: string | null }>;
    sesionesAbiertas: Array<{ userId: string; nombre: string; desde: string }>;
    sinJefe: Array<{ userId: string; nombre: string }>;
    sinDepartamento: Array<{ userId: string; nombre: string }>;
    feriadosCargados: number;
    ausenciasDelPeriodo: number;
    historialEstadosDesde: string | null;
    porDepartamento: Array<{ departamento: string; total: number; sinMarcar: number }>;
  }
  ```
- Endpoint: `GET /timesheet/compliance` con `PERMS.MANAGE`, envuelto en `asyncRoute`.

A diferencia de `/timesheet/team`, **abarca toda la organización**: `office.manage`
ya es el permiso que da acceso a los datos de todos.

Cada contador que no se pueda leer devuelve `null` y la interfaz muestra «no
disponible», nunca `0`. Un cero inventado en una pantalla de cumplimiento es peor
que un hueco: dice que está todo bien.

- [ ] **Paso 1: Pruebas del servicio** — cubrir que una fuente que rechaza no
  tumba el resto del reporte y que su contador queda en `null`.
- [ ] **Paso 2: Implementar**
- [ ] **Paso 3:** `npx vitest run` en verde
- [ ] **Paso 4: Commit**

```bash
git add src/services/compliance.service.ts src/services/compliance.service.test.ts src/index.ts
git commit -m "feat(office): reporte de cumplimiento de toda la organizacion"
```

---

### Task 10: Pestaña de Cumplimiento y CSV

**Archivos:**
- Crear: `frontend/src/components/ComplianceTab.tsx`
- Modificar: `TimesheetScreen.tsx`, `src/index.ts` (`GET /timesheet/export`)

Requisitos:

1. La pestaña **solo se renderiza con `office.manage`**. Oculta, no atenuada: una
   pestaña que no se puede abrir es ruido. El permiso sale de
   `currentUser?.permissions?.includes('office.manage')` en `App.tsx` y se pasa
   como prop, igual que `canManageHolidays` en `App.tsx:445`. **No** del
   `hasManage` del snapshot: ese es un parámetro interno de `SnapshotService`
   para decidir si se ven las justificaciones ajenas, y `App.tsx` no lo lee.
2. Cada renglón es un contador con su lista desplegable de personas.
3. Comparativa por departamento: `sinMarcar / total`.
4. Botón «Exportar CSV» que descarga `GET /timesheet/export?period&anchor`.
   El CSV lleva BOM UTF-8 para que Excel no rompa los acentos.
5. Un contador en `null` muestra «no disponible», nunca `0`.

- [ ] **Paso 1: Implementar y compilar**
- [ ] **Paso 2: Verificar el 403** — pegar la salida de un `curl` con un token sin
  `office.manage` contra `/timesheet/compliance` y `/timesheet/export`.
- [ ] **Paso 3: Commit**

```bash
git add src frontend/src
git commit -m "feat(office): pestana de cumplimiento con exportacion a CSV"
```

---

### Task 11: Despliegue

**Archivos:** `plugin.json`, `package.json`, `frontend/package.json`

- [ ] **Paso 1:** Subir las tres versiones a `1.7.0`
- [ ] **Paso 2:** `npm run build && npm run build:frontend && npx vitest run`
- [ ] **Paso 3: Pre-vuelo obligatorio** — medir Baileys ANTES de reiniciar:

```bash
sudo docker logs -t vla_api --since 3h 2>&1 | grep -E '"level":(50|60)' \
  | awk '{print $1}' | cut -c1-13 | sort | uniq -c
```

Si la tasa viene escalando, avisar a Carlos antes de reiniciar: un sender de
WhatsApp degradado puede no volver. El despliegue del 2026-09-22 tumbó el Sender 4
justamente así.

- [ ] **Paso 4: Verificar que no hay deriva** — comparar el md5 del `dist`
  desplegado contra un build local del commit que está en producción. Si no
  coinciden, alguien desplegó algo que no tenemos y se va a pisar.
- [ ] **Paso 5:** Respaldar, subir el zip, `docker restart vla_api`, verificar que
  el plugin carga y que los senders siguen conectados.

---

## Autorrevisión del plan

**Cobertura del spec.** Cada sección tiene tarea: «sin registrar» (T1, T6), norma
(T2), entrada habitual (T3), días con registro (T1), tabla (T4–T6), excepciones
(T4–T6), cobertura (T7–T8), cumplimiento (T9–T10), CSV (T10), fuera de alcance
(ninguna tarea toca metas ni kpis).

**Consistencia de tipos.** `EstadoRegistro`, `Norma`, `Variacion` y `SesionCruda`
se definen en T1–T3 y se consumen con los mismos nombres en T4, T7 y T9.
`FilaEquipo` de T4 es lo que T6 renderiza. `Matriz` de T7 es lo que T8 dibuja.

**Lo que se sabe que quedará flojo.** El desglose por estado tendrá dos días de
historia cuando esto se despliegue; la pantalla ya lo avisa con `coverageStart` y
no hay tarea que lo arregle porque solo lo arregla el tiempo. Las ausencias y los
feriados siguen en cero hasta que RRHH los cargue, y el denominador de «días
hábiles» no los descuenta mientras no existan — inventarlos sería peor.
