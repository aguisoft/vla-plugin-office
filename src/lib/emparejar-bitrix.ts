/**
 * Quién es quién entre Bitrix y system, para la sincronización de jornadas.
 *
 * Antes se emparejaba solo por email: si el email de Bitrix era distinto del
 * de system, la persona quedaba afuera aunque estuviera vinculada. El
 * 5-oct-2026 Yamila y Micaela marcaron entrada en Bitrix y office no se enteró.
 * Primero manda el vínculo guardado (BitrixUserMapping); el email es el respaldo.
 */

export interface UsuarioBitrix {
  ID: string | number;
  EMAIL?: string | null;
}

export function emparejarUsuarios(
  bitrixUsers: UsuarioBitrix[],
  vinculos: Map<string, string>,
  porEmail: Map<string, string>,
): Array<{ bitrix: UsuarioBitrix; userId: string; por: 'vinculo' | 'email' }> {
  const salida: Array<{ bitrix: UsuarioBitrix; userId: string; por: 'vinculo' | 'email' }> = [];
  const usados = new Set<string>();
  for (const bu of bitrixUsers) {
    const id = String(bu.ID);
    const vinculado = vinculos.get(id);
    if (vinculado && !usados.has(vinculado)) {
      salida.push({ bitrix: bu, userId: vinculado, por: 'vinculo' });
      usados.add(vinculado);
    }
  }
  for (const bu of bitrixUsers) {
    if (vinculos.has(String(bu.ID))) continue;
    const userId = porEmail.get(String(bu.EMAIL ?? '').toLowerCase());
    if (userId && !usados.has(userId)) {
      salida.push({ bitrix: bu, userId, por: 'email' });
      usados.add(userId);
    }
  }
  return salida;
}
