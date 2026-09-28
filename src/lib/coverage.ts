import { clipSpan, type Span } from './timesheet';
import { localDateString, zonedTimeToUtc } from './local-date';
import type { SesionCruda } from './team-stats';

export interface Celda { fecha: string; hora: number; personas: number }

/**
 * Matriz de cobertura horaria: cuánta gente distinta del equipo estaba
 * conectada en cada combinación de fecha local y hora local.
 *
 * `horaMin`/`horaMax` se derivan de los datos y no son una constante fija:
 * un turno que trabaja de 22:00 a 02:00 no puede desaparecer del mapa por
 * caer fuera de un rango de horas "de oficina" supuesto de antemano.
 */
export interface Matriz {
  horaMin: number;
  horaMax: number;
  fechas: string[];
  celdas: Celda[];
}

/** Hora local (0-23) de un instante. */
function horaLocal(instant: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false });
  const parte = fmt.formatToParts(instant).find(p => p.type === 'hour');
  // 'en-US' con hour12:false devuelve "24" para la medianoche en algunos
  // entornos; se normaliza, mismo truco que `minutosLocales` en team-stats.ts.
  return Number(parte?.value ?? '0') % 24;
}

/**
 * Último instante (ms) de la hora local que contiene a `instant`.
 *
 * `Date.UTC`, dentro de `zonedTimeToUtc`, normaliza por su cuenta el desborde
 * de hora 23+1=24 hacia el día siguiente -- el mismo mecanismo que ya usa
 * `localDayEnd` para el desborde de día a día -- así que no hace falta un
 * caso especial para la última hora del día.
 */
function finDeHoraLocal(instant: Date, tz: string): Date {
  const fecha = localDateString(instant, tz);
  const [y, m, d] = fecha.split('-').map(Number);
  const hora = horaLocal(instant, tz);
  const inicioSiguiente = zonedTimeToUtc(y, m, d, hora + 1, 0, 0, tz);
  return new Date(inicioSiguiente.getTime() - 1);
}

/**
 * Cuánta gente del equipo estaba conectada, por fecha local y hora local.
 *
 * Recibe sesiones YA resueltas (sin noción de "abierta" en esta función),
 * igual que `aggregateSessions` en `timesheet.ts`: quien llama es quien
 * conoce si una sesión sigue abierta y la acota con `capOpenSession` antes de
 * pasarla acá -- ver `TeamService`, que construye estas mismas sesiones para
 * las filas de la tabla. Duplicar esa cota adentro de una función que se
 * quiere pura solo abriría la puerta a que las dos rutas (fila y celda) den
 * números distintos sobre la misma sesión.
 *
 * Cuenta PERSONAS y no sesiones: el acumulador es un
 * `Map<fecha, Map<hora, Set<userId>>>`, y es el `Set` el que garantiza que
 * alguien que entra y sale tres veces en la misma hora siga sumando 1, no 3.
 *
 * Con al menos una sesión, `fechas` cubre TODOS los días locales del período,
 * no solo los que tuvieron gente. Un día entero sin nadie es el hueco de
 * cobertura más grande que existe, y es justo el que esta matriz viene a
 * mostrar: si solo se devolvieran los días con datos, un martes en el que no se
 * conectó nadie se vería idéntico a un martes que ni siquiera se pidió.
 *
 * La excepción es el período COMPLETAMENTE vacío (o un `porPersona` vacío):
 * ahí sí se devuelve `celdas: []`, y ese vacío es la señal que la interfaz usa
 * para no dibujar nada. Sin una sola sesión no hay mapa de cobertura del que
 * hablar; con una sola, el mapa muestra el período entero.
 */
/**
 * Todos los días locales que toca el período, en orden. Se itera sobre FECHAS
 * locales y no sobre instantes: anclar el cursor al día UTC perdería el primer
 * día cuando el arranque local cae por la tarde, que es el mismo error que ya
 * se corrigió en `diasHabiles` (ver `team-stats.ts`).
 */
function fechasDelPeriodo(within: Span, tz: string): string[] {
  const ultima = localDateString(within.end, tz);
  const cursor = new Date(`${localDateString(within.start, tz)}T12:00:00Z`);
  const out: string[] = [];
  let fecha = localDateString(cursor, tz);
  while (fecha <= ultima) {
    out.push(fecha);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    fecha = localDateString(cursor, tz);
  }
  return out;
}

export function coverageMatrix(
  porPersona: Array<{ userId: string; sesiones: SesionCruda[] }>,
  within: Span,
  tz: string,
): Matriz {
  // fecha -> hora -> personas distintas conectadas esa hora.
  const porFecha = new Map<string, Map<number, Set<string>>>();
  let horaMin = Infinity;
  let horaMax = -Infinity;

  for (const { userId, sesiones } of porPersona) {
    for (const sesion of sesiones) {
      const clipped = clipSpan(sesion, within);
      if (!clipped) continue;

      let cursor = clipped.start;
      // Cota de seguridad: un span corrupto no debe colgar el proceso. Mismo
      // patrón que el `guard` de `splitByLocalDay`, pero por hora en vez de
      // por día -- 10.000 horas son más de 400 días, de sobra para cualquier
      // sesión real dentro de un período de día/semana/mes.
      for (let guard = 0; guard < 10_000 && cursor < clipped.end; guard++) {
        const finHora = finDeHoraLocal(cursor, tz);
        const finTramo = finHora < clipped.end ? finHora : clipped.end;
        if (finTramo > cursor) {
          const fecha = localDateString(cursor, tz);
          const hora = horaLocal(cursor, tz);

          let porHora = porFecha.get(fecha);
          if (!porHora) { porHora = new Map(); porFecha.set(fecha, porHora); }
          let personas = porHora.get(hora);
          if (!personas) { personas = new Set(); porHora.set(hora, personas); }
          personas.add(userId);

          if (hora < horaMin) horaMin = hora;
          if (hora > horaMax) horaMax = hora;
        }
        cursor = new Date(finTramo.getTime() + 1);
      }
    }
  }

  if (porFecha.size === 0) return { horaMin: 0, horaMax: 0, fechas: [], celdas: [] };

  const fechas = fechasDelPeriodo(within, tz);
  const celdas: Celda[] = [];
  for (const fecha of fechas) {
    // Puede no existir: un día sin nadie conectado igual dibuja su fila, toda
    // en ceros. Ese es el punto.
    const porHora = porFecha.get(fecha);
    for (let hora = horaMin; hora <= horaMax; hora++) {
      // Celda en cero (dentro del rango horaMin..horaMax) se produce igual
      // que una con datos -- es la que la interfaz pinta como un punto gris,
      // distinta de una hora fuera del rango, que ni siquiera existe acá.
      celdas.push({ fecha, hora, personas: porHora?.get(hora)?.size ?? 0 });
    }
  }

  return { horaMin, horaMax, fechas, celdas };
}
