import { useEffect, useMemo, useState } from 'react';
import { getOrgChart, ApiError } from '../api';
import { buildOrgTree, type NodoOrg, type PersonaChart } from '../lib/org-tree';

/**
 * El organigrama. Lo ve cualquier colaborador.
 *
 * Es un árbol INDENTADO y plegable, no un diagrama de cajas y líneas. Un
 * diagrama clásico obliga a hacer zoom o a desplazarse en dos ejes, y con 23
 * personas ya no entra en un teléfono; la indentación se lee igual en
 * cualquier ancho y responde la pregunta real —de quién depende cada quien—
 * sin pedirle nada al que mira.
 *
 * Solo lectura a propósito: jefe, departamento y país se corrigen en la
 * pantalla de administración, y tener dos lugares donde editar lo mismo es
 * la forma más rápida de que los dos queden mal.
 */
export function OrgChart({ onClose }: { onClose: () => void }) {
  const [personas, setPersonas] = useState<PersonaChart[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const [cerrados, setCerrados] = useState<Set<string>>(new Set());

  useEffect(() => {
    getOrgChart()
      .then(d => setPersonas(d.personas))
      .catch(e => {
        const detail = e instanceof ApiError ? (e.detail as { message?: string } | undefined) : undefined;
        setError(detail?.message ?? 'No se pudo cargar el organigrama');
      });
  }, []);

  const arbol = useMemo(() => buildOrgTree(personas ?? []), [personas]);

  // El filtro ilumina, no poda: esconder a los jefes de quien coincide
  // dejaría el resultado sin la cadena de mando, que es justamente lo que se
  // viene a mirar acá.
  const coincide = useMemo(() => {
    const q = filtro.trim().toLocaleLowerCase('es');
    if (!q) return null;
    return (p: PersonaChart) =>
      (p.nombre ?? '').toLocaleLowerCase('es').includes(q) ||
      (p.departamento ?? '').toLocaleLowerCase('es').includes(q);
  }, [filtro]);

  const alternar = (userId: string) => setCerrados(prev => {
    const s = new Set(prev);
    if (s.has(userId)) s.delete(userId); else s.add(userId);
    return s;
  });

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 md:px-6">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
        >
          ← Volver
        </button>
        <h2 className="text-sm font-medium text-gray-800">Organigrama</h2>
        {personas && (
          <span className="text-[10px] text-gray-400">{personas.length} personas activas</span>
        )}
        <input
          value={filtro}
          onChange={e => setFiltro(e.target.value)}
          placeholder="Buscar por nombre o departamento"
          className="ml-auto w-48 rounded-xl border border-gray-200 px-2.5 py-1 text-[11px] md:w-64"
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {error && <p className="py-12 text-center text-xs text-rose-600">{error}</p>}
        {!error && !personas && <p className="py-12 text-center text-xs text-gray-400">Cargando…</p>}

        {personas && (
          <>
            {arbol.ciclos.length > 0 && (
              /* Un ciclo de jefaturas es un dato malo que alguien tiene que
                 corregir, no algo que la pantalla pueda resolver. Se nombra a
                 los involucrados: sin eso, esas personas simplemente no
                 aparecerían y nadie sabría por qué. */
              <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-800">
                <p className="font-medium">Hay jefaturas circulares y no se pueden dibujar</p>
                {arbol.ciclos.map((c, i) => (
                  <p key={i} className="mt-1">
                    {c.map(p => p.nombre ?? 'nombre no disponible').join(' → ')} → {c[0].nombre ?? 'nombre no disponible'}
                  </p>
                ))}
                <p className="mt-1 text-rose-700">
                  Hay que corregir el jefe de alguno de ellos en Feriados → Organización.
                </p>
              </div>
            )}

            {arbol.cima.length === 0 && arbol.huerfanos.length === 0 && (
              <p className="py-12 text-center text-xs text-gray-400">
                No hay jerarquía que mostrar todavía.
              </p>
            )}

            <ul className="space-y-1">
              {arbol.cima.map(n => (
                <Rama key={n.persona.userId} nodo={n} nivel={0}
                      coincide={coincide} cerrados={cerrados} alternar={alternar} />
              ))}
            </ul>

            {arbol.huerfanos.length > 0 && (
              <div className="mt-6 border-t border-gray-100 pt-4">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                  Su jefe ya no está activo
                </p>
                <p className="mb-2 text-[10px] text-gray-500">
                  Dependen de alguien que fue desactivado, así que no se pueden colgar
                  de nadie. Aparecen acá para no perderlos del organigrama.
                </p>
                <ul className="space-y-1">
                  {arbol.huerfanos.map(n => (
                    <Rama key={n.persona.userId} nodo={n} nivel={0}
                          coincide={coincide} cerrados={cerrados} alternar={alternar} />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Rama({ nodo, nivel, coincide, cerrados, alternar }: {
  nodo: NodoOrg;
  nivel: number;
  coincide: ((p: PersonaChart) => boolean) | null;
  cerrados: Set<string>;
  alternar: (userId: string) => void;
}) {
  const { persona, equipo, totalAbajo } = nodo;
  const plegado = cerrados.has(persona.userId);
  const resaltado = coincide ? coincide(persona) : false;

  return (
    <li>
      <div
        /* La indentación es padding y no margen para que la fila resaltada
           cubra todo el ancho: un fondo que arranca corrido se lee como una
           columna torcida, no como un resultado de búsqueda. */
        style={{ paddingLeft: `${nivel * 18}px` }}
        className={`flex items-center gap-2 rounded-xl py-1.5 pr-2 ${resaltado ? 'bg-amber-50' : ''}`}
      >
        {equipo.length > 0 ? (
          <button
            type="button"
            onClick={() => alternar(persona.userId)}
            aria-expanded={!plegado}
            aria-label={plegado ? `Mostrar el equipo de ${persona.nombre ?? 'esta persona'}` : `Ocultar el equipo de ${persona.nombre ?? 'esta persona'}`}
            className="w-4 shrink-0 text-[10px] text-gray-400 hover:text-gray-700"
          >
            {plegado ? '▸' : '▾'}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        <span className={`truncate text-xs ${persona.nombre ? 'text-gray-800' : 'italic text-gray-400'}`}>
          {/* El backend manda null cuando no hay nombre. Un hueco en blanco no
              diría de quién habla la fila. */}
          {persona.nombre ?? 'Nombre no disponible'}
        </span>

        {persona.departamento && (
          <span className="shrink-0 text-[10px] text-gray-400">· {persona.departamento}</span>
        )}

        {totalAbajo > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
            {totalAbajo} {totalAbajo === 1 ? 'persona' : 'personas'}
          </span>
        )}
      </div>

      {!plegado && equipo.length > 0 && (
        <ul className="space-y-1">
          {equipo.map(h => (
            <Rama key={h.persona.userId} nodo={h} nivel={nivel + 1}
                  coincide={coincide} cerrados={cerrados} alternar={alternar} />
          ))}
        </ul>
      )}
    </li>
  );
}
