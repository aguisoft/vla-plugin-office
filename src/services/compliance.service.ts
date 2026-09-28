import type { PluginContext } from '@vla/plugin-sdk';
import { periodBounds, type Period } from '../lib/timesheet';
import { nombresPorUsuario } from '../lib/user-names';
import type { TeamService } from './team.service';
import type { OrgService } from './org.service';
import type { HolidayService } from './holiday.service';
import type { TimesheetService } from './timesheet.service';

/**
 * Reporte de cumplimiento de TODA la organización, para `office.manage`.
 *
 * Cada campo es una fuente independiente y cada uno degrada por su cuenta:
 * que una consulta falle no puede llevarse las otras. `null` es "no se pudo
 * leer" -- la interfaz lo muestra como «no disponible» -- y NUNCA se
 * reemplaza por `0` ni por un arreglo vacío, que en una pantalla de
 * cumplimiento se leería como "está todo bien" cuando en realidad nadie
 * pudo comprobarlo. Mismo principio que `FilaEquipo.estado` ya aplica fila
 * por fila; acá se aplica campo por campo.
 *
 * DESVÍO DEL BRIEF (task-9-brief.md): la interfaz original no dejaba
 * ningún campo en `null`, lo cual contradice el propio texto del brief un
 * párrafo más abajo ("Cada contador que no se pueda leer devuelve `null`").
 * Se corrige acá agregando `| null` donde hace falta -- ver el reporte de
 * la tarea para el detalle.
 */
export interface Cumplimiento {
  sinMarcar30Dias: Array<{ userId: string; nombre: string; departamento: string | null }> | null;
  sesionesAbiertas: Array<{ userId: string; nombre: string; desde: string }> | null;
  sinJefe: Array<{ userId: string; nombre: string }> | null;
  sinDepartamento: Array<{ userId: string; nombre: string }> | null;
  feriadosCargados: number | null;
  ausenciasDelPeriodo: number | null;
  historialEstadosDesde: string | null;
  /**
   * `departamentoId` es `null` para la fila sintética "(sin departamento)"
   * (I2) y viaja para que la interfaz tenga una `key` de React estable que
   * no dependa del NOMBRE -- dos departamentos homónimos son dos filas con
   * el mismo `departamento` pero distinto `departamentoId`.
   */
  porDepartamento: Array<{ departamentoId: string | null; departamento: string; total: number; sinMarcar: number }> | null;
}

export class ComplianceService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly tzOf: () => string,
    private readonly team: TeamService,
    private readonly org: OrgService,
    private readonly holidays: HolidayService,
    private readonly timesheet: TimesheetService,
  ) {}

  /**
   * Todos los usuarios activos. Base de `sinMarcar30Dias`, `sesionesAbiertas`,
   * `sinJefe`, `sinDepartamento` y `porDepartamento` -- sin esta lista
   * ninguno de esos cinco se puede calcular, así que sus cuatro consultas ni
   * se disparan si esta falla.
   */
  private async usuariosActivos(): Promise<string[] | null> {
    try {
      const rows = await this.ctx.prisma.user.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      return (rows as any[]).map(u => u.id);
    } catch (e) {
      this.ctx.logger.warn(`ComplianceService: no se pudo leer la lista de usuarios activos: ${e}`);
      return null;
    }
  }

  /**
   * `sinMarcar30Dias` y `sesionesAbiertas`, del MISMO cálculo que ya usa la
   * tabla del equipo -- no una segunda consulta a `CheckInRecord` con la
   * misma ventana. `TeamService.excepciones` ahora rechaza si la consulta
   * falla (ver su comentario); acá SÍ se traduce ese rechazo a `null` en
   * los dos campos, a diferencia de `/timesheet/team`, que conserva el
   * arreglo vacío para no cambiar una pantalla ya revisada.
   */
  private async excepciones(userIds: string[]): Promise<{
    sinMarcar30Dias: Array<{ userId: string; nombre: string }> | null;
    sesionesAbiertas: Cumplimiento['sesionesAbiertas'];
  }> {
    try {
      const exc = await this.team.excepciones(userIds);
      return { sinMarcar30Dias: exc.sinMarcar30Dias, sesionesAbiertas: exc.sesionesAbiertas };
    } catch (e) {
      this.ctx.logger.warn(`ComplianceService: no se pudieron leer las excepciones del equipo: ${e}`);
      return { sinMarcar30Dias: null, sesionesAbiertas: null };
    }
  }

  /** País, departamento y jefe de todos los activos. `null` si la consulta falla. */
  private async roster(userIds: string[]) {
    try {
      return await this.org.roster(userIds);
    } catch (e) {
      this.ctx.logger.warn(`ComplianceService: no se pudo leer el organigrama: ${e}`);
      return null;
    }
  }

  /** Catálogo de departamentos con su headcount. `null` si la consulta falla. */
  private async departamentos() {
    try {
      return await this.org.departments();
    } catch (e) {
      this.ctx.logger.warn(`ComplianceService: no se pudo leer el catálogo de departamentos: ${e}`);
      return null;
    }
  }

  /**
   * Cuántos feriados hay cargados en el sistema, sin filtrar por año ni país
   * -- responde "¿hay algo cargado?", no "¿hay algo cargado para hoy?".
   * `HolidayService.list` no atrapa sus propios fallos (a diferencia del
   * resto de las fuentes de este reporte), así que el try/catch va acá.
   */
  private async feriadosCargados(): Promise<number | null> {
    try {
      return (await this.holidays.list()).length;
    } catch (e) {
      this.ctx.logger.warn(`ComplianceService: no se pudo leer el catálogo de feriados: ${e}`);
      return null;
    }
  }

  /**
   * Ausencias (PERMISO/VACACIONES/INCAPACIDAD) que tocan el período pedido,
   * de TODA la organización -- no depende de `usuariosActivos()`, así que
   * degrada por su cuenta aunque esa consulta también falle.
   */
  private async ausenciasDelPeriodo(from: Date, to: Date): Promise<number | null> {
    try {
      return await this.ctx.prisma.absenceRecord.count({
        where: { startAt: { lte: to }, endAt: { gte: from } },
      });
    } catch (e) {
      this.ctx.logger.warn(`ComplianceService: no se pudieron leer las ausencias del período: ${e}`);
      return null;
    }
  }

  /**
   * Reporte de cumplimiento. `period`/`anchor` solo alimentan
   * `ausenciasDelPeriodo` -- el resto de los campos mira el estado actual
   * de la organización, no un recorte de tiempo -- pero viajan igual para
   * que `GET /timesheet/export` pueda pedir EXACTAMENTE lo que la pestaña
   * está mostrando.
   */
  async cumplimiento(period: Period, anchor: Date): Promise<Cumplimiento> {
    const bounds = periodBounds(anchor, period, this.tzOf());

    const [userIds, feriadosCargados, ausenciasDelPeriodo, historialEstadosDesde] = await Promise.all([
      this.usuariosActivos(),
      this.feriadosCargados(),
      this.ausenciasDelPeriodo(bounds.start, bounds.end),
      this.timesheet.coverageStart(),
    ]);

    if (userIds === null) {
      return {
        sinMarcar30Dias: null,
        sesionesAbiertas: null,
        sinJefe: null,
        sinDepartamento: null,
        feriadosCargados,
        ausenciasDelPeriodo,
        historialEstadosDesde,
        porDepartamento: null,
      };
    }

    const [{ sinMarcar30Dias: sinMarcarBase, sesionesAbiertas }, rosterMap, departamentos] = await Promise.all([
      this.excepciones(userIds),
      this.roster(userIds),
      this.departamentos(),
    ]);

    // Nombres de TODOS los activos -- distinto de los nombres que ya trae
    // `excepciones()`, que solo cubren a quien está en esas dos listas.
    // `sinJefe`/`sinDepartamento` necesitan poder nombrar a cualquiera.
    // Nunca lanza (ver `nombresPorUsuario`), pero SÍ puede volver `null` si la
    // consulta falló -- I1: un `userId` crudo no es un nombre, así que ese
    // caso (y el de una persona puntual sin fila en el mapa) dice «no
    // disponible» en vez de imprimir el UUID. La LISTA en sí no se invalida:
    // sigue viniendo de `excepciones()`/`roster()`, fuentes aparte.
    const nombres = await nombresPorUsuario(this.ctx, userIds);
    const nombreDe = (userId: string) => {
      const n = nombres?.get(userId);
      return n ? `${n.firstName} ${n.lastName}` : 'no disponible';
    };

    // `departamento` de cada persona de `sinMarcarBase`, para la columna que
    // pide el brief y para `porDepartamento`. Si el organigrama no se pudo
    // leer, la LISTA sigue siendo válida (viene de `excepciones`, otra
    // fuente) -- solo su columna de departamento degrada, persona por
    // persona, a `null`.
    const sinMarcar30Dias = sinMarcarBase === null ? null : sinMarcarBase.map(p => ({
      ...p,
      departamento: rosterMap?.get(p.userId)?.departmentName ?? null,
    }));

    const sinJefe = rosterMap === null ? null : userIds
      .filter(id => rosterMap.get(id)?.managerUserId == null)
      .map(userId => ({ userId, nombre: nombreDe(userId) }));

    const sinDepartamento = rosterMap === null ? null : userIds
      .filter(id => rosterMap.get(id)?.departmentId == null)
      .map(userId => ({ userId, nombre: nombreDe(userId) }));

    // Necesita el departamento resuelto de CADA activo (no solo de quien
    // está en `sinMarcar30Dias`) para el total por departamento, y la lista
    // ya enriquecida para el numerador -- si cualquiera de las dos fuentes
    // falló, la comparativa completa se vuelve `null` en vez de mostrar un
    // "0/total" que no es cierto.
    //
    // I2, tres defectos del mismo bloque que se corrigen juntos:
    //  1. El total salía de `d.headcount` (`OrgService.departments()`), que
    //     cuenta TODAS las filas de `BitrixUserMapping` sin mirar `isActive`
    //     -- esos mapeos no se borran al desactivar a alguien. Acá se cuenta
    //     desde `rosterMap`, que solo tiene los `userIds` YA FILTRADOS a
    //     activos (`usuariosActivos()` arriba).
    //  2. La unión era por NOMBRE (`p.departamento === d.name`): dos
    //     departamentos homónimos se contaban doble y chocaban en la `key`
    //     de React. Acá se une por `departmentId`.
    //  3. Quien no tiene departamento no aparecía en ninguna fila, así que
    //     la columna no sumaba el total de activos de arriba. Acá se agrega
    //     una fila final "(sin departamento)" con su propio conteo -- la
    //     prueba de abajo (`compliance.service.test.ts`) afirma que la suma
    //     de todas las filas da el total de activos.
    const porDepartamento = (departamentos === null || rosterMap === null || sinMarcar30Dias === null)
      ? null
      : (() => {
          const activosPorDept = new Map<string, number>();
          const sinMarcarPorDept = new Map<string, number>();
          let sinDepto = 0;
          let sinMarcarSinDepto = 0;

          for (const id of userIds) {
            const deptId = rosterMap.get(id)?.departmentId ?? null;
            if (deptId === null) sinDepto++;
            else activosPorDept.set(deptId, (activosPorDept.get(deptId) ?? 0) + 1);
          }
          for (const p of sinMarcar30Dias) {
            const deptId = rosterMap.get(p.userId)?.departmentId ?? null;
            if (deptId === null) sinMarcarSinDepto++;
            else sinMarcarPorDept.set(deptId, (sinMarcarPorDept.get(deptId) ?? 0) + 1);
          }

          const filas: Array<{ departamentoId: string | null; departamento: string; total: number; sinMarcar: number }> =
            departamentos.map(d => ({
              departamentoId: d.id,
              departamento: d.name,
              total: activosPorDept.get(d.id) ?? 0,
              sinMarcar: sinMarcarPorDept.get(d.id) ?? 0,
            }));
          if (sinDepto > 0) {
            filas.push({
              departamentoId: null,
              departamento: '(sin departamento)',
              total: sinDepto,
              sinMarcar: sinMarcarSinDepto,
            });
          }
          return filas;
        })();

    return {
      sinMarcar30Dias,
      sesionesAbiertas,
      sinJefe,
      sinDepartamento,
      feriadosCargados,
      ausenciasDelPeriodo,
      historialEstadosDesde,
      porDepartamento,
    };
  }
}
