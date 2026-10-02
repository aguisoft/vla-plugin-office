/**
 * Quién tiene la app de escritorio. La app avisa cada tanto («latido») con su
 * versión; con eso la oficina ofrece la descarga solo a quien no la tiene y
 * cuenta cuántos compañeros ya la usan.
 */

/** Sin latido en estos días, se considera que ya no la tiene (desinstaló, cambió de compu). */
export const DIAS_VIGENTE = 14;

export function versionValida(v: unknown): v is string {
  return typeof v === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v);
}

/** -1, 0, 1 como `a < b`, `a == b`, `a > b` (semver sin sufijos). */
export function compararVersiones(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

export interface UsoEscritorio {
  instalada: boolean;
  version: string | null;
  ultimaVez: string | null;
  /** Ya tiene la última publicada (o no hay ninguna publicada). */
  alDia: boolean;
}

export function estadoDeUso(
  fila: { version: string; ultima_vez: string | Date } | null | undefined,
  publicada: string | null,
  ahora: Date,
): UsoEscritorio {
  if (!fila) return { instalada: false, version: null, ultimaVez: null, alDia: false };
  const ultima = new Date(fila.ultima_vez);
  const instalada = !Number.isNaN(ultima.getTime()) && ahora.getTime() - ultima.getTime() <= DIAS_VIGENTE * 86_400_000;
  const alDia = !publicada || !versionValida(fila.version) || compararVersiones(fila.version, publicada) >= 0;
  return { instalada, version: fila.version, ultimaVez: ultima.toISOString(), alDia };
}

/** «112 MB» */
export function textoTamano(bytes: number): string {
  if (!(bytes > 0)) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}
