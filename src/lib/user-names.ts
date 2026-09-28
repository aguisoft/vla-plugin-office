import type { PluginContext } from '@vla/plugin-sdk';

export interface NombreInfo { firstName: string; lastName: string; email: string }

/**
 * Nombre y correo de cada persona, desde la tabla de usuarios del core.
 *
 * Compartido entre `TeamService` y `ComplianceService` (Task 9): los dos
 * arman su propia lista de personas pero necesitan el mismo nombre para
 * mostrarlo, y los dos tienen que degradar igual -- en Express 4 un rechazo
 * de promesa sin atrapar mata el proceso entero. Antes de Task 9 vivía
 * duplicado como método privado de `TeamService`; se sube acá para no repetir
 * la misma consulta y el mismo try/catch una tercera vez.
 *
 * DESVÍO (fix-A, I1): antes degradaba a `new Map()` -- un mapa vacío es
 * indistinguible de "esta consulta trajo cero filas por otra razón", y cada
 * llamador terminaba mostrando filas con nombre en blanco pero minutos
 * reales, o excepciones que caían al `userId` crudo (un UUID no es un
 * nombre; nadie sabe a quién señala). Ahora `null` es explícito: "esta
 * consulta no se pudo leer", y cada llamador decide cómo degradar -- ver
 * `TeamService.filaSinNombres` y `ComplianceService.nombreDe`.
 */
export async function nombresPorUsuario(
  ctx: PluginContext, userIds: string[],
): Promise<Map<string, NombreInfo> | null> {
  try {
    const rows = await ctx.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return new Map((rows as any[]).map(u => [
      u.id,
      { firstName: u.firstName, lastName: u.lastName, email: u.email },
    ]));
  } catch (e) {
    ctx.logger.warn(`nombresPorUsuario: no se pudieron leer los nombres de usuario: ${e}`);
    return null;
  }
}
