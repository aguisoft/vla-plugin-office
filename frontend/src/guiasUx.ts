/**
 * Qué guías de uso ofrece el libro del encabezado. Son páginas estáticas que
 * viajan con el plugin (frontend/public/ayuda). La de colaboradores es para
 * todos y su dirección ya se compartió: no se renombra. La de jefes es para
 * quien aprueba solicitudes (jefes y RRHH) y la de RRHH para quien administra
 * la oficina (office.manage).
 */
export interface Guia {
  id: 'colaboradores' | 'jefes' | 'rrhh';
  titulo: string;
  detalle: string;
  archivo: string;
}

const COLABORADORES: Guia = {
  id: 'colaboradores', titulo: 'Guía para colaboradores',
  detalle: 'Entrar, cambiar tu estado, pedir permisos y vacaciones', archivo: 'ayuda/colaboradores.html',
};
const JEFES: Guia = {
  id: 'jefes', titulo: 'Guía para jefes',
  detalle: 'Responder solicitudes, cronómetros y las horas del equipo', archivo: 'ayuda/jefes.html',
};
const RRHH: Guia = {
  id: 'rrhh', titulo: 'Guía para RRHH',
  detalle: 'Personas, feriados y cumplimiento de toda la empresa', archivo: 'ayuda/rrhh.html',
};

export function guiasPara({ aprueba, rrhh }: { aprueba: boolean; rrhh: boolean }): Guia[] {
  if (rrhh) return [COLABORADORES, JEFES, RRHH];
  return aprueba ? [COLABORADORES, JEFES] : [COLABORADORES];
}
