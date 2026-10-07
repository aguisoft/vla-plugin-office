/**
 * Adjuntos de las solicitudes que llevan justificación (permiso, cita médica,
 * incapacidad): el comprobante del trámite, la constancia médica, la boleta.
 *
 * Son datos de salud o personales, así que se guardan fuera de Bitrix y los
 * sirve office aplicando la MISMA regla que la justificación: la persona, su
 * jefe directo y RRHH. Nadie más, ni con el enlace.
 */

/** Lo que acepta el formulario. Nada ejecutable. */
export const TIPOS_PERMITIDOS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

/** 8 MB por archivo: una foto de un comprobante entra de sobra y el cuerpo
 *  JSON (base64, +33 %) queda bajo el límite de 25 MB del núcleo. */
export const MAX_BYTES = 8 * 1024 * 1024;

/** Tres documentos por solicitud alcanzan para una boleta y sus anexos. */
export const MAX_POR_SOLICITUD = 3;

export interface AdjuntoEntrada {
  nombre: string;
  tipo: string;
  /** Contenido en base64, sin el prefijo `data:`. */
  contenido: string;
}

export type ErrorAdjunto =
  | { campo: string; error: 'tipo_no_permitido' | 'muy_grande' | 'vacio' | 'nombre_invalido' | 'demasiados' };

/** Tamaño real de un base64, sin decodificarlo. */
export function bytesDeBase64(b64: string): number {
  const limpio = b64.replace(/\s/g, '');
  if (!limpio) return 0;
  const relleno = limpio.endsWith('==') ? 2 : limpio.endsWith('=') ? 1 : 0;
  return Math.floor((limpio.length * 3) / 4) - relleno;
}

/**
 * Nombre seguro para guardar en disco: sin rutas, sin caracteres raros y con
 * la extensión que corresponde al tipo declarado — no a la que venga en el
 * nombre, que es la que podría traer un `.exe` disfrazado.
 */
export function nombreSeguro(nombre: string, tipo: string): string {
  const ext = TIPOS_PERMITIDOS[tipo] ?? 'bin';
  const base = (nombre.split(/[\\/]/).pop() ?? '')
    .replace(/\.[^.]*$/, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ._-]/g, '')
    .trim()
    .slice(0, 60);
  return `${base || 'documento'}.${ext}`;
}

export function validarAdjuntos(entradas: AdjuntoEntrada[]): ErrorAdjunto[] {
  const errores: ErrorAdjunto[] = [];
  if (entradas.length > MAX_POR_SOLICITUD) {
    errores.push({ campo: 'adjuntos', error: 'demasiados' });
    return errores;
  }
  entradas.forEach((a, i) => {
    const campo = `adjuntos[${i}]`;
    if (!TIPOS_PERMITIDOS[a?.tipo]) { errores.push({ campo, error: 'tipo_no_permitido' }); return; }
    if (!a?.nombre || !a.nombre.trim()) { errores.push({ campo, error: 'nombre_invalido' }); return; }
    const bytes = bytesDeBase64(a?.contenido ?? '');
    if (bytes <= 0) { errores.push({ campo, error: 'vacio' }); return; }
    if (bytes > MAX_BYTES) errores.push({ campo, error: 'muy_grande' });
  });
  return errores;
}
