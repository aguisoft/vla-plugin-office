/**
 * Qué guías de uso ofrece el libro del encabezado. Son páginas estáticas que
 * viajan con el plugin (frontend/public/ayuda). La de colaboradores es para
 * todos y su dirección ya se compartió: no se renombra. La de jefes es solo
 * para quien aprueba solicitudes (jefes y RRHH).
 */
export interface Guia {
  id: 'colaboradores' | 'jefes';
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

export function guiasPara(aprueba: boolean): Guia[] {
  return aprueba ? [COLABORADORES, JEFES] : [COLABORADORES];
}
