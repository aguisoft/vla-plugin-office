import type { PersonaChart, SaludOrg } from '../lib/org-tree';

/**
 * El detalle de la salud del organigrama, con NOMBRES y no solo conteos.
 *
 * «3 sin departamento» no sirve para arreglar nada: hay que saber quiénes son.
 * La barra lateral da el número porque está siempre a la vista; este modal se
 * abre cuando alguien va a actuar, y entonces necesita la lista.
 *
 * Cada grupo explica POR QUÉ importa. Un panel de diagnóstico que enumera
 * problemas sin decir qué consecuencia tienen entrena a ignorarlo.
 */

const TINTA = { fuerte: '#111827', medio: '#4b5563', suave: '#6b7280' } as const;

export function OrgHealthModal({ salud, total, onClose }: {
  salud: SaludOrg;
  total: number;
  onClose: () => void;
}) {
  const grupos: Array<{ titulo: string; porque: string; gente: PersonaChart[] }> = [
    {
      titulo: 'Sin jefe ni gente a cargo',
      porque: 'No cuelgan de nadie y nadie cuelga de ellos: quedaron fuera del árbol.',
      gente: salud.sueltos,
    },
    {
      titulo: 'Su jefe fue desactivado',
      porque: 'Hay que reasignarles jefe; mientras tanto el organigrama los muestra aparte.',
      gente: salud.huerfanos,
    },
    {
      titulo: 'Sin departamento',
      porque: 'Sin área no entran en el reparto por departamento ni en el tablero de equipo.',
      gente: salud.sinDepartamento,
    },
  ].filter(g => g.gente.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(17,24,39,.4)' }}>
      <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Salud del organigrama"
        className="relative z-10 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-medium tracking-tight" style={{ color: TINTA.fuerte }}>
              Salud del organigrama
            </h3>
            <p className="mt-0.5 text-[11px]" style={{ color: TINTA.suave }}>
              Revisión de las {total} personas activas.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded px-2 text-[13px] hover:bg-black/5" style={{ color: TINTA.suave }}>
            ✕
          </button>
        </div>

        {salud.sana ? (
          <p className="mt-4 rounded-xl p-3 text-[12px]" style={{ background: '#f2f9f4', color: '#166534' }}>
            Sin datos que corregir. Todos tienen jefe o son gerencia general, todos
            tienen departamento, y no hay jefaturas circulares.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {salud.ciclos.length > 0 && (
              <section>
                <h4 className="text-[12px] font-medium" style={{ color: TINTA.fuerte }}>Jefaturas circulares</h4>
                <p className="mb-1 text-[11px]" style={{ color: TINTA.suave }}>
                  A reporta a B y B reporta a A. Mientras exista, esas personas no se
                  pueden dibujar en el árbol.
                </p>
                {salud.ciclos.map((c, i) => (
                  <p key={i} className="text-[11px]" style={{ color: TINTA.medio }}>
                    {c.map(p => p.nombre ?? 'nombre no disponible').join(' → ')} → {c[0].nombre ?? 'nombre no disponible'}
                  </p>
                ))}
              </section>
            )}

            {grupos.map(g => (
              <section key={g.titulo}>
                <h4 className="text-[12px] font-medium" style={{ color: TINTA.fuerte }}>
                  {g.titulo} <span style={{ color: TINTA.suave }}>({g.gente.length})</span>
                </h4>
                <p className="mb-1 text-[11px]" style={{ color: TINTA.suave }}>{g.porque}</p>
                <ul className="text-[11px]" style={{ color: TINTA.medio }}>
                  {g.gente.map(p => (
                    <li key={p.userId}>
                      {p.nombre ?? 'Nombre no disponible'}
                      {p.departamento ? ' · ' + p.departamento : ''}
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            <p className="text-[11px]" style={{ color: TINTA.suave }}>
              Todo esto se corrige en Feriados → Organización.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
