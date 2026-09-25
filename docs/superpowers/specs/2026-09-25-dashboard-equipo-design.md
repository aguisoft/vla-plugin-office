# Dashboard de Tiempos: vista de equipo y cumplimiento

**Fecha:** 2026-09-25
**Plugin:** `office` (a partir de v1.6.1)
**Reemplaza:** la pantalla de persona-única de `2026-09-22-dashboard-tiempos-design.md`,
que se conserva como vista de detalle.

---

## El problema que esto resuelve

La pantalla actual obliga a elegir una persona de un desplegable. Un jefe con
cinco directos hace cinco consultas y tiene que recordar los números para
compararlos. No hay forma de ver al equipo junto, ni de saber quién se salió de
su propia norma.

Pero el problema más grave es otro, y se midió contra producción el 2026-09-25:

**9 de las 22 personas activas no tienen un solo registro en 30 días.** Las nueve
están correctamente mapeadas a Bitrix; simplemente no marcan entrada. Entre ellas
están gerencia general, los dos de Marketing, el de Finanzas y uno de Development.

Hoy la pantalla las muestra con **0m** y la leyenda «Sin tiempo registrado en este
período». Un gerente lee eso como «no trabajó». Es exactamente la conclusión falsa
que el diseño anterior existía para evitar, solo que aplicada a media empresa.

Ninguna visualización nueva vale nada mientras ese cero siga pareciendo un dato.

---

## Qué mide esta pantalla, y qué no

Mide **presencia**: si la persona estaba conectada, cuándo, y en qué estado.

No mide productividad ni resultados. Son cosas distintas y mezclarlas hace daño:
un gerente que optimiza horas-conectado consigue que la gente deje la sesión
abierta, no que produzca más.

Los resultados ya viven en el plugin `kpis` (`/goals/:year/:month`, `/templates`,
`/my-kpis`, notas por empleado y por departamento). Replicar metas acá crearía dos
sistemas que se contradicen. **Esta pantalla no define, muestra ni evalúa metas.**

---

## Fuentes de datos y sus límites

Medido contra producción el 2026-09-25:

| Fuente | Qué hay | Límite |
|---|---|---|
| `virtual_office.CheckInRecord` | 3.002 sesiones desde 2026-04-08, 36 personas | Solo 11–17 personas/mes. 98% viene de Bitrix timeman |
| `plugin_office.office_status_intervals` | 72 filas desde 2026-09-24 | Dos días. Sin historia para tendencias de estado |
| `virtual_office.AbsenceRecord` | 0 filas | — |
| `virtual_office.Holiday` | 0 filas | — |
| `virtual_office.MeetingInvite` | 0 filas | — |
| Sesiones abiertas sin cerrar | 9 en septiembre, 11 en abril | Ya acotadas a `MAX_OPEN_SESSION_HOURS` al reportar |

Consecuencia de diseño: **todo lo que dependa del desglose por estado sale vacío
durante las primeras semanas**, y la pantalla tiene que decirlo (ya existe
`coverageStart` para eso). Lo que sí se puede calcular hoy, con cinco meses de
historia, es tiempo en oficina, promedios, tendencia y cobertura horaria — pero
solo de quien marca.

---

## Estructura: dos pestañas

### Pestaña «Equipo»

Visible para cualquiera con `office.view`. Si el alcance del viewer tiene una sola
persona (nadie a cargo), **no se muestra la tabla**: se va directo al detalle
personal, que es el comportamiento de hoy y es el correcto.

El alcance lo resuelve el servidor con `resolveScope`/`canSee`, sin cambios: uno
mismo más los directos, o todo si es ADMIN. Pedir a alguien fuera del alcance
sigue devolviendo 403 y nunca un resultado vacío.

#### Franja de excepciones

Arriba de todo, antes de cualquier tabla, lo que requiere acción:

```
⚠ 3 sin marcar entrada en 30 días · 1 sesión sin cerrar desde el 12-sep
```

Solo se renderiza si hay algo. Cada excepción enlaza al filtro correspondiente.

#### Tabla del equipo

Una fila por persona del alcance:

| Columna | Definición |
|---|---|
| Persona | Nombre y correo |
| Período | Minutos en oficina, ya acotados por `capOpenSession` |
| vs. su promedio | Variación contra su propia norma (ver abajo) |
| Días con registro | `N de M`, donde M son los días laborables del período |
| Entrada habitual | Mediana de la hora local de entrada |
| Último | Fecha del último check-in, en lenguaje relativo |

**«Sin registrar» no es cero.** Si la persona no tiene ninguna sesión que
interseque el período, la fila muestra `sin registrar` en gris, no `0m`, y las
columnas derivadas quedan en `—`. Esta es la pieza central del diseño: es la
diferencia entre «no marcó» y «no trabajó».

#### Mapa de cobertura

Matriz hora × día del período: cuánta gente del equipo estaba conectada en cada
hora local. Responde «¿puedo agendar algo a las 3?» y «¿quién abre la mañana?»,
que ningún total contesta.

```
        L    M    M    J    V
 8h     ·    1    ·    1    ·
10h     3    4    4    4    3
14h     4    4    3    4    2
17h     2    1    2    1    ·
```

#### Detalle por persona

Un clic en una fila abre la vista que ya existe: total, barras por día, desglose
por estado, ausencias, avisos de cobertura y de cota. Ese trabajo se conserva
íntegro; solo cambia cómo se llega a él.

### Pestaña «Cumplimiento»

Solo con `office.manage`. Oculta para el resto — no atenuada: una pestaña que no
se puede abrir es ruido.

```
Sin marcar en 30 días        9   → Marketing 2/2, Finanzas 1/1, Development 1/2
Sesiones abiertas sin cerrar 9   → la más vieja, del 12-sep
Sin jefe asignado            2
Sin departamento             3
Feriados cargados            0
Ausencias del período        0
Historial de estados desde   2026-09-24
```

Cada renglón despliega la lista de personas. Incluye comparativa por departamento
y exportación CSV para evaluaciones y planillas.

A diferencia de la pestaña «Equipo», esta **abarca a toda la organización**, no al
alcance del viewer: `office.manage` ya es el permiso que da acceso a los datos de
todos (organigrama, ausencias ajenas, feriados).

---

## Definiciones que tienen que ser exactas

### La norma («vs. su promedio»)

La norma es el promedio del **mismo tipo de período** sobre los períodos
anteriores:

| Período visto | Ventana de la norma |
|---|---|
| Día | los 20 días laborables anteriores |
| Semana | las 8 semanas anteriores |
| Mes | los 6 meses anteriores |

Reglas:

1. **Se excluyen los períodos sin ningún registro.** Incluirlos arrastraría la
   norma a cero y haría que cualquier semana normal se viera como un récord.
2. **Con menos de 3 períodos comparables no se muestra porcentaje**, se muestra
   `sin base`. Un `+300%` calculado contra una sola semana previa es ruido que
   induce a actuar sobre nada.
3. El período en curso **no entra** en su propia norma.
4. La variación se muestra con una flecha solo cuando supera el ±15%. Por debajo
   de eso es fluctuación normal y señalarla entrena a ignorar las flechas.

La norma es contra uno mismo y nunca contra el equipo. Comparar entre compañeros
premia a quien más horas aguanta, no a quien mejor trabaja.

### Días con registro

`N de M`, donde `M` son los días del período que caen de lunes a viernes,
descontando feriados del país de la persona cuando los haya. Con 0 feriados
cargados hoy, M es simplemente los días hábiles.

Se cuenta el **día**, no la sesión: alguien con tres sesiones cortas en un día
cuenta uno.

### Entrada habitual

Mediana —no promedio— de la hora local de `checkInAt` de la primera sesión de cada
día, sobre la misma ventana que la norma. La mediana resiste el día que alguien
entró a las 4am; el promedio no.

Requiere al menos 3 días con registro; con menos, `—`.

### Sin registrar

Una persona está «sin registrar» en un período cuando **no tiene ninguna fila de
`CheckInRecord` que interseque ese período**. Es distinto de tener 0 minutos, que
puede pasar si una sesión existe pero se recorta a nada contra los límites.

En la pestaña de Cumplimiento, «sin marcar en 30 días» usa una ventana fija de 30
días naturales, independiente del período seleccionado.

### Cobertura horaria

Para cada día local del período y cada hora local, la cantidad de personas del
alcance con una sesión que interseca esa hora. Las sesiones abiertas se cierran
contra la cota de `capOpenSession`, igual que en el total, para que una sesión
olvidada no pinte cobertura de 24 horas durante una semana.

El rango de horas se deriva de los datos y no se fija de 6 a 20: alguien que
trabaja de noche tiene que aparecer, no desaparecer por una constante.

---

## Restricciones que el código ya tiene y hay que respetar

- **Zona horaria.** API y Postgres en UTC, operación en UTC−6. Todo el bucketing
  por día y por hora usa los helpers de `src/lib/local-date.ts`. Nunca
  `toISOString()` ni `new Date(iso)` para fechas de calendario.
- **Aislamiento de esquema.** `ctx.query` fija `search_path` dentro de una
  transacción; el SQL va sin prefijo. Cada llamada es su propia transacción.
- **Express 4 no atrapa rechazos de promesas.** Todo handler nuevo va envuelto en
  `asyncRoute`. Una consulta que falle no puede matar el proceso.
- **Degradar, no mentir.** Si una fuente no se puede leer, se devuelve un estado
  explícito de «no disponible», nunca un vacío que se lea como «no hizo nada».
- **Lógica pura en `src/lib/`,** probada con vitest sin mocks. Los servicios
  orquestan, no calculan.
- **Nunca un vacío que se lea como «no hizo nada».** Es el principio rector.
- Textos de interfaz y comentarios en español, con acentos correctos.
- Tailwind sin `darkMode` configurado: no usar clases `dark:`.

---

## Superficie de API

| Endpoint | Permiso | Devuelve |
|---|---|---|
| `GET /timesheet/team?period&anchor` | `office.view` | Filas del equipo, excepciones y matriz de cobertura, dentro del alcance |
| `GET /timesheet/compliance` | `office.manage` | Contadores y listas de toda la organización |
| `GET /timesheet/export?period&anchor` | `office.manage` | CSV de la tabla del equipo más las banderas de cumplimiento |
| `GET /timesheet/office?userId&period&anchor` | `office.view` | Sin cambios. Detalle de una persona |
| `GET /timesheet/scope` | `office.view` | Sin cambios |

`GET /timesheet/team` responde una sola vez con todo lo que la pestaña necesita:
partirlo en tres llamadas obligaría a la pantalla a coordinar tres estados de
carga y tres de error para una vista que es una sola cosa.

---

## Fuera de alcance

- **Metas, objetivos y evaluaciones.** Viven en el plugin `kpis`.
- **Puntaje o índice de productividad.** No se puede derivar de presencia sin
  mentir.
- **Ranking entre compañeros.**
- **Estimar presencia desde la actividad de Bitrix** cuando no hay marcaje.
  Se evaluó y se descartó: legitimaría no marcar, y un número estimado no es
  comparable con uno medido. La decisión fue exigir el marcaje.
- **Alertas automáticas o notificaciones.** La pantalla se consulta; no persigue.
- **Editar el tiempo de alguien a mano.** El dato viene de Bitrix; corregirlo acá
  crearía una segunda verdad.

---

## Qué se puede entregar hoy

| Pieza | Estado |
|---|---|
| Tabla del equipo, norma, días con registro, entrada habitual, último | Hoy — 5 meses de historia |
| Franja de excepciones | Hoy |
| Mapa de cobertura horaria | Hoy |
| Pestaña de Cumplimiento y CSV | Hoy |
| Desglose por estado con historia útil | ~30 días — hoy hay 2 |
| Impacto de ausencias y feriados | Cuando RRHH los cargue — hoy 0 |

La tendencia y la cobertura solo existen para quien marca. Por eso la columna
«sin registrar» es la primera pieza a construir: sin ella, media empresa parece no
trabajar y el resto del tablero pierde credibilidad antes de que nadie lo use.
