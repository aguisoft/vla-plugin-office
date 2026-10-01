import { useEffect, useMemo, useState } from 'react';
import { getOrgChart, ApiError } from '../api';
import {
  buildOrgTree, cadenaDeMando, saludOrg, horaLocalDe,
  type NodoOrg, type PersonaChart,
} from '../lib/org-tree';
import { STATUS_CFG, type ResolvedStatus } from '../statusConfig';

/**
 * El organigrama. Lo ve cualquier colaborador.
 *
 * Árbol indentado y vertical, no un diagrama de cajas y líneas: con 23
 * personas el diagrama clásico no entra en un teléfono y obliga a desplazarse
 * en dos ejes, mientras que la indentación se lee igual en cualquier ancho.
 *
 * Además de la jerarquía muestra el ESTADO y la HORA LOCAL de cada persona.
 * Eso lo convierte de pantalla de consulta en herramienta: no solo decís a
 * quién escalar, sino si está disponible y si su jornada ya empezó —el equipo
 * está repartido en cuatro husos.
 *
 * Solo lectura: jefe, departamento y país se corrigen en la pantalla de
 * administración, y dos lugares para editar lo mismo es la forma más rápida
 * de que los dos queden mal.
 *
 * SOBRE EL COLOR: el estado nunca se codifica solo con color. Cada uno trae su
 * `glifo` de `STATUS_CFG` —figuras separables entre sí— porque un punto de
 * 8px distingue mal dos tonos cercanos, y para quien no ve color no distingue
 * ninguno. Hay pruebas que lo vigilan en `statusConfig.test.ts`.
 */

/** Grises verificados contra el fondo #fafaf9: ninguno baja de 4.5:1. */
const TINTA = { fuerte: '#111827', medio: '#4b5563', suave: '#6b7280' } as const;

export function OrgChart({ onClose }: { onClose: () => void }) {
  const [personas, setPersonas] = useState<PersonaChart[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const [depto, setDepto] = useState<string | null>(null);
  const [cerrados, setCerrados] = useState<Set<string>>(new Set());
  const [elegido, setElegido] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => new Date());

  useEffect(() => {
    getOrgChart()
      .then(d => setPersonas(d.personas))
      .catch(e => {
        const detalle = e instanceof ApiError ? (e.detail as { message?: string } | undefined) : undefined;
        setError(detalle?.message ?? 'No se pudo cargar el organigrama');
      });
  }, []);

  // Las horas locales envejecen mientras la pestaña queda abierta. Un minuto
  // es suficiente: nadie mira el reloj de un compañero al segundo.
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const arbol = useMemo(() => buildOrgTree(personas ?? []), [personas]);

  // Las raíces legítimas son las que el propio árbol encontró con gente a
  // cargo, más las que no tienen equipo pero tampoco jefe Y pertenecen a la
  // cima dibujada. `saludOrg` necesita saberlo para no acusar a la gerencia
  // general de ser un dato suelto (ver su comentario).
  const salud = useMemo(
    () => saludOrg(personas ?? [], arbol, new Set(arbol.cima.map(n => n.persona.userId))),
    [personas, arbol],
  );

  const departamentos = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const p of personas ?? []) {
      const d = p.departamento ?? 'Sin departamento';
      cuenta.set(d, (cuenta.get(d) ?? 0) + 1);
    }
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
  }, [personas]);

  /**
   * El filtro ILUMINA, no poda. Esconder a los jefes de quien coincide dejaría
   * el resultado sin la cadena de mando, que es justamente lo que se viene a
   * mirar acá.
   */
  const coincide = useMemo(() => {
    const q = filtro.trim().toLocaleLowerCase('es');
    if (!q && !depto) return null;
    return (p: PersonaChart) => {
      const porTexto = !q
        || (p.nombre ?? '').toLocaleLowerCase('es').includes(q)
        || (p.departamento ?? '').toLocaleLowerCase('es').includes(q);
      const porDepto = !depto || (p.departamento ?? 'Sin departamento') === depto;
      return porTexto && porDepto;
    };
  }, [filtro, depto]);

  const cadena = useMemo(
    () => (elegido ? cadenaDeMando(personas ?? [], elegido) : []),
    [elegido, personas],
  );
  const enCadena = useMemo(() => new Set(cadena.map(p => p.userId)), [cadena]);

  const alternar = (userId: string) => setCerrados(prev => {
    const s = new Set(prev);
    if (s.has(userId)) s.delete(userId); else s.add(userId);
    return s;
  });

  const plegarTodo = () => {
    const conEquipo = new Set<string>();
    const rec = (n: NodoOrg) => { if (n.equipo.length) conEquipo.add(n.persona.userId); n.equipo.forEach(rec); };
    [...arbol.cima, ...arbol.huerfanos].forEach(rec);
    setCerrados(prev => (prev.size > 0 ? new Set() : conEquipo));
  };

  const exportar = () => {
    const filas = [['Nombre', 'Departamento', 'Depende de', 'A cargo', 'Estado', 'País']];
    const porId = new Map((personas ?? []).map(p => [p.userId, p]));
    const aCargo = new Map<string, number>();
    for (const p of personas ?? []) {
      if (p.managerUserId) aCargo.set(p.managerUserId, (aCargo.get(p.managerUserId) ?? 0) + 1);
    }
    for (const p of personas ?? []) {
      filas.push([
        p.nombre ?? '', p.departamento ?? '',
        p.managerUserId ? (porId.get(p.managerUserId)?.nombre ?? '') : '',
        String(aCargo.get(p.userId) ?? 0),
        p.estado ? (STATUS_CFG[p.estado as ResolvedStatus]?.label ?? p.estado) : '',
        p.pais ?? '',
      ]);
    }
    // Misma defensa que el CSV de cumplimiento: una celda que arranca con =,
    // + o - la ejecuta la hoja de cálculo al abrirla.
    const seguro = (v: string) => {
      const x = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
      return /["\n\r,]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
    };
    const csv = '﻿' + filas.map(f => f.map(seguro).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `organigrama-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const comun = { coincide, cerrados, alternar, elegido, setElegido, enCadena, ahora };

  return (
    <div className="flex h-full flex-col" style={{ background: '#fafaf9' }}>
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 md:px-6" style={{ borderColor: '#ececea' }}>
        <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-xs hover:bg-black/5" style={{ color: TINTA.medio }}>
          ← Volver
        </button>
        <h2 className="text-[15px] font-medium tracking-tight" style={{ color: TINTA.fuerte }}>Organigrama</h2>
        {personas && <span className="text-[11px]" style={{ color: TINTA.suave }}>{personas.length} personas</span>}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            value={filtro}
            onChange={e => setFiltro(e.target.value)}
            placeholder="Buscar persona o área"
            className="w-44 rounded-lg border bg-white px-2.5 py-1 text-[11px] md:w-56"
            style={{ borderColor: '#e3e3e0', color: TINTA.fuerte }}
          />
          <button type="button" onClick={plegarTodo}
            className="rounded-lg border bg-white px-2.5 py-1 text-[11px] hover:bg-black/[0.03]"
            style={{ borderColor: '#e3e3e0', color: TINTA.medio }}>
            {cerrados.size > 0 ? 'Desplegar todo' : 'Plegar todo'}
          </button>
          <button type="button" onClick={exportar} disabled={!personas}
            className="rounded-lg border bg-white px-2.5 py-1 text-[11px] hover:bg-black/[0.03] disabled:opacity-40"
            style={{ borderColor: '#e3e3e0', color: TINTA.medio }}>
            Exportar
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <p className="py-12 text-center text-xs" style={{ color: '#b91c1c' }}>{error}</p>}
        {!error && !personas && <p className="py-12 text-center text-xs" style={{ color: TINTA.suave }}>Cargando…</p>}

        {personas && (
          <div className="mx-auto flex max-w-[1400px] flex-col gap-8 px-4 py-6 md:flex-row md:px-8">
            <main className="min-w-0 flex-1">
              {arbol.ciclos.length > 0 && (
                <div className="mb-5 rounded-xl border p-3 text-[11px]" style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }}>
                  <p className="font-medium">Hay jefaturas circulares y no se pueden dibujar</p>
                  {arbol.ciclos.map((c, i) => (
                    <p key={i} className="mt-1">
                      {c.map(p => p.nombre ?? 'nombre no disponible').join(' → ')} → {c[0].nombre ?? 'nombre no disponible'}
                    </p>
                  ))}
                </div>
              )}

              {cadena.length > 1 && (
                <div className="mb-5 rounded-xl border bg-white px-3 py-2.5 text-[11px]" style={{ borderColor: '#e3e3e0' }}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: TINTA.suave }}>Línea de mando</span>
                    <button type="button" onClick={() => setElegido(null)} className="ml-auto text-[10px] hover:underline" style={{ color: TINTA.suave }}>
                      cerrar
                    </button>
                  </div>
                  <p className="mt-1" style={{ color: TINTA.fuerte }}>
                    {cadena.map((p, i) => (
                      <span key={p.userId}>
                        {i > 0 && <span style={{ color: TINTA.suave }}> → </span>}
                        {p.nombre ?? 'nombre no disponible'}
                      </span>
                    ))}
                  </p>
                </div>
              )}

              {arbol.cima.length === 0 && arbol.huerfanos.length === 0 && (
                <p className="py-12 text-center text-xs" style={{ color: TINTA.suave }}>
                  No hay jerarquía que mostrar todavía.
                </p>
              )}

              <ul>
                {arbol.cima.map(n => <Rama key={n.persona.userId} nodo={n} nivel={0} {...comun} />)}
              </ul>

              {arbol.huerfanos.length > 0 && (
                <div className="mt-8 border-t pt-5" style={{ borderColor: '#ececea' }}>
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: TINTA.suave }}>Su jefe ya no está activo</p>
                  <p className="mt-1 mb-3 text-[11px]" style={{ color: TINTA.medio }}>
                    Dependen de alguien que fue desactivado, así que no se pueden colgar de
                    nadie. Aparecen acá para no perderlos del organigrama.
                  </p>
                  <ul>
                    {arbol.huerfanos.map(n => <Rama key={n.persona.userId} nodo={n} nivel={0} {...comun} />)}
                  </ul>
                </div>
              )}
            </main>

            <aside className="w-full shrink-0 md:w-64">
              <Seccion titulo="Departamentos">
                <button type="button" onClick={() => setDepto(null)}
                  className={`flex w-full items-baseline justify-between rounded-md px-2 py-1 text-left text-[11px] ${!depto ? 'bg-black/[0.05]' : 'hover:bg-black/[0.03]'}`}
                  style={{ color: TINTA.fuerte }}>
                  <span>Mostrar todos</span><span style={{ color: TINTA.suave }}>{personas.length}</span>
                </button>
                {departamentos.map(([d, n]) => (
                  <button key={d} type="button" onClick={() => setDepto(depto === d ? null : d)}
                    className={`flex w-full items-baseline justify-between rounded-md px-2 py-1 text-left text-[11px] ${depto === d ? 'bg-black/[0.05]' : 'hover:bg-black/[0.03]'}`}
                    style={{ color: TINTA.fuerte }}>
                    <span className="truncate">{d}</span>
                    <span className="ml-2 shrink-0" style={{ color: TINTA.suave }}>{n}</span>
                  </button>
                ))}
                <p className="mt-2 px-2 text-[10px] leading-relaxed" style={{ color: TINTA.suave }}>
                  Al elegir un área se resalta a su gente sin esconder su línea de mando.
                </p>
              </Seccion>

              <Seccion titulo="Salud del organigrama">
                {salud.sana ? (
                  <p className="px-2 text-[11px]" style={{ color: TINTA.medio }}>
                    Sin datos que corregir: todos tienen jefe o son gerencia general, y
                    todos tienen departamento.
                  </p>
                ) : (
                  <ul className="space-y-1 px-2 text-[11px]" style={{ color: TINTA.medio }}>
                    {salud.sueltos.length > 0 && <li>{salud.sueltos.length} sin jefe ni gente a cargo</li>}
                    {salud.huerfanos.length > 0 && <li>{salud.huerfanos.length} con el jefe desactivado</li>}
                    {salud.ciclos.length > 0 && <li>{salud.ciclos.length} jefatura(s) circular(es)</li>}
                    {salud.sinDepartamento.length > 0 && <li>{salud.sinDepartamento.length} sin departamento</li>}
                  </ul>
                )}
              </Seccion>

              <Seccion titulo="Estados">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-2">
                  {(Object.keys(STATUS_CFG) as ResolvedStatus[]).map(k => (
                    <span key={k} className="flex items-center gap-1.5 text-[10px]" style={{ color: TINTA.medio }}>
                      <span style={{ color: STATUS_CFG[k].color }}>{STATUS_CFG[k].glifo}</span>
                      {STATUS_CFG[k].label}
                    </span>
                  ))}
                </div>
                <p className="mt-2 px-2 text-[10px] leading-relaxed" style={{ color: TINTA.suave }}>
                  Cada estado tiene su propia figura, así que se distinguen sin depender
                  del color.
                </p>
              </Seccion>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 px-2 text-[10px] uppercase tracking-wider" style={{ color: TINTA.suave }}>{titulo}</h3>
      {children}
    </section>
  );
}

interface Comun {
  coincide: ((p: PersonaChart) => boolean) | null;
  cerrados: Set<string>;
  alternar: (userId: string) => void;
  elegido: string | null;
  setElegido: (id: string | null) => void;
  enCadena: Set<string>;
  ahora: Date;
}

function Rama({ nodo, nivel, ...c }: { nodo: NodoOrg; nivel: number } & Comun) {
  const { persona, equipo, totalAbajo } = nodo;
  const plegado = c.cerrados.has(persona.userId);
  const resaltado = c.coincide ? c.coincide(persona) : false;
  const esElegido = c.elegido === persona.userId;
  const enLinea = c.enCadena.has(persona.userId) && !esElegido;

  const cfg = persona.estado ? STATUS_CFG[persona.estado as ResolvedStatus] : undefined;
  const hora = horaLocalDe(persona.pais, c.ahora);

  // El nombre pierde peso a medida que baja el nivel: la jerarquía se lee por
  // tamaño además de por indentación.
  const escala = nivel === 0 ? 'text-[15px] font-medium' : nivel === 1 ? 'text-[13.5px]' : 'text-[12.5px]';

  return (
    <li>
      <div
        style={{
          paddingLeft: `${nivel * 22}px`,
          background: esElegido ? 'rgba(0,0,0,.055)' : resaltado ? '#fdf6e3' : enLinea ? 'rgba(0,0,0,.025)' : undefined,
        }}
        className="flex items-baseline gap-2 rounded-lg py-1.5 pr-2"
      >
        {equipo.length > 0 ? (
          <button
            type="button"
            onClick={() => c.alternar(persona.userId)}
            aria-expanded={!plegado}
            aria-label={plegado ? `Mostrar el equipo de ${persona.nombre ?? 'esta persona'}` : `Ocultar el equipo de ${persona.nombre ?? 'esta persona'}`}
            className="w-4 shrink-0 text-[10px]"
            style={{ color: TINTA.suave }}
          >
            {plegado ? '▸' : '▾'}
          </button>
        ) : <span className="w-4 shrink-0" />}

        <button
          type="button"
          onClick={() => c.setElegido(esElegido ? null : persona.userId)}
          className={`truncate text-left tracking-tight ${escala}`}
          style={{ color: persona.nombre ? TINTA.fuerte : TINTA.suave, fontStyle: persona.nombre ? undefined : 'italic' }}
        >
          {/* El backend manda null cuando no hay nombre: un hueco en blanco no
              diría de quién habla la fila. */}
          {persona.nombre ?? 'Nombre no disponible'}
        </button>

        {persona.departamento && (
          <span className="shrink-0 text-[11px]" style={{ color: TINTA.suave }}>{persona.departamento}</span>
        )}

        <span className="ml-auto flex shrink-0 items-baseline gap-2.5 text-[11px]">
          {cfg && (
            <span className="flex items-center gap-1" style={{ color: TINTA.medio }} title={cfg.label}>
              <span style={{ color: cfg.color }}>{cfg.glifo}</span>
              {cfg.label}
            </span>
          )}
          {hora && <span style={{ color: TINTA.suave }}>{persona.pais} {hora}</span>}
          {totalAbajo > 0 && (
            <span style={{ color: TINTA.suave }}>
              {totalAbajo} {totalAbajo === 1 ? 'persona' : 'personas'}
              {plegado && ' ocultas'}
            </span>
          )}
        </span>
      </div>

      {!plegado && equipo.length > 0 && (
        <ul>
          {equipo.map(h => <Rama key={h.persona.userId} nodo={h} nivel={nivel + 1} {...c} />)}
        </ul>
      )}
    </li>
  );
}
