/**
 * Volver es manual (pedido el 12-oct-2026).
 *
 * Antes, al cumplirse la hora, el almuerzo, el «vuelvo pronto» y el
 * «concentrado» volvían solos a Disponible, y al terminar un permiso o una
 * cita la persona aparecía disponible sola. Había gente que todavía no había
 * vuelto: el sistema la daba por disponible y ese tiempo se contaba como
 * trabajado.
 *
 * Ahora el estado sigue —con el cronómetro en rojo, que ven la persona, su
 * jefe y RRHH— hasta que la persona marca Disponible. Al cumplirse la hora le
 * llega un aviso, uno solo. Al terminar un permiso o una cita queda en
 * «Vuelvo pronto», que también cuenta como pausa.
 */

const NOMBRE: Record<string, { quien: string; sigue: string }> = {
  LUNCH: { quien: 'Tu almuerzo', sigue: 'sigue contando como almuerzo' },
  BRB: { quien: 'Tu «vuelvo pronto»', sigue: 'seguís en «Vuelvo pronto»' },
  FOCUS: { quien: 'Tu tiempo de concentración', sigue: 'seguís como «Concentrado»' },
  PERMISO: { quien: 'Tu permiso', sigue: 'quedás en «Vuelvo pronto»' },
  CITA_MEDICA: { quien: 'Tu cita médica', sigue: 'quedás en «Vuelvo pronto»' },
};

/** «Tu almuerzo terminó» / «Terminaba a las 13:00. Marcá Disponible cuando vuelvas: …». */
export function avisoDeVuelta(status: string, terminaba: Date, hora: (d: Date) => string): { titulo: string; cuerpo: string } {
  const n = NOMBRE[status] ?? { quien: 'Tu estado', sigue: 'seguís en ese estado' };
  return {
    titulo: `${n.quien} terminó`,
    cuerpo: `Terminaba a las ${hora(terminaba)}. Marcá Disponible cuando vuelvas: hasta entonces ${n.sigue}.`,
  };
}

/** Justificación del «Vuelvo pronto» en que queda la persona al terminar su permiso o su cita. */
export const JUSTIFICACION_VUELTA: Record<string, string> = {
  PERMISO: 'Volviendo del permiso',
  CITA_MEDICA: 'Volviendo de la cita médica',
};

/**
 * Si al terminar su ausencia la persona pasa a «Vuelvo pronto»: solo en
 * permisos y citas (las de días terminan a medianoche, sin nadie en la
 * oficina), si está en la oficina y si de fondo estaba para atender
 * (Disponible o Concentrado). Si eligió otra cosa, se respeta.
 */
export function quedaVolviendo(o: { tipoAusencia: string; isCheckedIn: boolean; status: string }): boolean {
  return o.tipoAusencia in JUSTIFICACION_VUELTA && o.isCheckedIn && (o.status === 'AVAILABLE' || o.status === 'FOCUS');
}
