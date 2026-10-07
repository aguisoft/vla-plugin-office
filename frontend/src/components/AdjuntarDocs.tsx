import { useRef, useState } from 'react';

export interface DocAdjunto { nombre: string; tipo: string; contenido: string }

const TIPOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_DOCS = 3;

const kb = (b: number) => b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;

/**
 * Documentos de respaldo de la solicitud: la boleta, la constancia médica.
 *
 * Viajan en base64 dentro del mismo JSON de la solicitud, para que el
 * documento y el motivo se guarden juntos o no se guarde ninguno. Los límites
 * se repiten en el servidor; acá están para avisar antes de subir 8 MB al
 * pedo, no como control.
 */
export function AdjuntarDocs({ docs, onChange }: {
  docs: DocAdjunto[];
  onChange: (docs: DocAdjunto[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function elegir(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const nuevos: DocAdjunto[] = [];

    for (const f of Array.from(files)) {
      if (docs.length + nuevos.length >= MAX_DOCS) { setError(`Hasta ${MAX_DOCS} documentos.`); break; }
      if (!TIPOS.includes(f.type)) { setError('Solo PDF o imagen.'); continue; }
      if (f.size > MAX_BYTES) { setError(`"${f.name}" pesa ${kb(f.size)}; el máximo es 8 MB.`); continue; }
      const b64 = await new Promise<string>((ok, fail) => {
        const r = new FileReader();
        // readAsDataURL da "data:<tipo>;base64,<...>": al servidor va solo la cola.
        r.onload = () => ok(String(r.result).split(',')[1] ?? '');
        r.onerror = () => fail(r.error);
        r.readAsDataURL(f);
      }).catch(() => '');
      if (b64) nuevos.push({ nombre: f.name, tipo: f.type, contenido: b64 });
    }

    if (nuevos.length) onChange([...docs, ...nuevos]);
    if (input.current) input.current.value = '';   // permite volver a elegir el mismo archivo
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {docs.map((d, i) => (
          <span key={i} className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-[11px] text-gray-700">
            📎 <span className="max-w-[140px] truncate">{d.nombre}</span>
            <button
              type="button"
              onClick={() => onChange(docs.filter((_, j) => j !== i))}
              className="text-gray-400 hover:text-gray-700"
              aria-label={`Quitar ${d.nombre}`}
            >×</button>
          </span>
        ))}
        {docs.length < MAX_DOCS && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="rounded-lg border border-dashed border-gray-300 px-2 py-1 text-[11px] text-gray-500 hover:border-gray-400"
          >
            📎 Adjuntar documento
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept={TIPOS.join(',')}
        className="hidden"
        onChange={e => elegir(e.target.files)}
      />
      {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
