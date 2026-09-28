import type { ReactNode } from 'react';
import type { Cumplimiento } from '../types';
import { fmtDateOnly } from '../format';
import { complianceExportUrl } from '../api';

/**
 * Pestaña de Cumplimiento: le sirve a RRHH, no al jefe, y responde una sola
 * pregunta -- ¿se puede confiar en los números del resto del tablero? En
 * producción 9 de 22 personas activas no marcan entrada, hay 9 sesiones que
 * nunca se cerraron, y no hay ni un feriado cargado; mientras eso siga así,
 * el resto del tablero descansa sobre datos incompletos.
 *
 * Solo se monta con `office.manage` -- ver `TimesheetScreen`, que la oculta
 * por completo (no la atenúa) si el permiso falta. Una pestaña que no se
 * puede abrir es ruido.
 *
 * Cada renglón es una fuente INDEPENDIENTE, tal como las entrega
 * `ComplianceService`: que una falle no puede llevarse a las otras. Un
 * contador en `null` se muestra literalmente como «no disponible» -- nunca
 * como `0` ni como una lista vacía, que en esta pantalla se leería como
 * "está todo bien" cuando en realidad nadie pudo comprobarlo.
 */

/** Ícono de aviso, igual al que ya usa `TeamTable` para lo mismo. */
function IconoAviso({ className = '' }: { className?: string }) {
  return (
    <svg className={`h-3.5 w-3.5 flex-shrink-0 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.947-3.374L13.949 4.75c-.866-1.5-3.032-1.5-3.898 0L2.697 16.5zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

/**
 * Un contador con su `<details>` de personas -- nativo, sin estado propio,
 * que ya trae la semántica de "desplegable" que pide el Requisito 2. `lista
 * === null` es la fuente que falló: se ve distinto (ámbar, «no disponible»)
 * de `lista.length === 0`, que es un cero real -- de verdad no hay nadie.
 */
function Contador({ titulo, lista, renderPersona }: {
  titulo: string;
  lista: Array<{ userId: string }> | null;
  renderPersona: (item: any) => ReactNode;
}) {
  if (lista === null) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">{titulo}</p>
        <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-amber-800">
          <IconoAviso className="text-amber-500" />
          no disponible
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-amber-600">
          No se pudo leer esta fuente -- no es un dato sobre la organización.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-100 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{titulo}</p>
      <p className="mt-1 text-lg font-bold text-gray-800">{lista.length}</p>
      {lista.length > 0 && (
        <details className="mt-2 group">
          <summary className="cursor-pointer list-none text-[11px] font-medium text-gray-500 hover:text-gray-700">
            Ver {lista.length === 1 ? 'a la persona' : 'a las personas'}
          </summary>
          <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2">
            {lista.map(item => (
              <li key={item.userId} className="text-xs text-gray-600">{renderPersona(item)}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Estadística simple sin lista -- feriados cargados, ausencias del período, historial de estados. */
function Estadistica({ titulo, valor }: { titulo: string; valor: string | number | null }) {
  const noDisponible = valor === null;
  return (
    <div className={`rounded-2xl border p-4 ${noDisponible ? 'border-amber-200 bg-amber-50' : 'border-gray-100'}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-wider ${noDisponible ? 'text-amber-600' : 'text-gray-400'}`}>
        {titulo}
      </p>
      {noDisponible ? (
        <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-amber-800">
          <IconoAviso className="text-amber-500" />
          no disponible
        </p>
      ) : (
        <p className="mt-1 text-lg font-bold text-gray-800">{valor}</p>
      )}
    </div>
  );
}

export function ComplianceTab({ data, loading, error, period, anchor }: {
  data: Cumplimiento | null;
  loading: boolean;
  error: string | null;
  period: string;
  anchor: string;
}) {
  if (loading) return <p className="py-12 text-center text-xs text-gray-400">Cargando…</p>;
  if (error) return null; // El banner rojo de la pantalla ya cubre el aviso.
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-400">
          Cumplimiento de toda la organización -- no solo de tu equipo.
        </p>
        {/* Enlace directo, no un fetch: así el navegador maneja la descarga
            y manda la misma cookie de sesión que cualquier otra pantalla. */}
        <a
          href={complianceExportUrl(period, anchor)}
          className="flex-shrink-0 rounded-xl bg-gray-800 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-gray-700"
        >
          Exportar CSV
        </a>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Estadistica titulo="Feriados cargados" valor={data.feriadosCargados} />
        <Estadistica titulo="Ausencias del período" valor={data.ausenciasDelPeriodo} />
        <Estadistica
          titulo="Historial de estados desde"
          valor={data.historialEstadosDesde ? fmtDateOnly(data.historialEstadosDesde) : null}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Contador
          titulo="Sin marcar en 30 días"
          lista={data.sinMarcar30Dias}
          renderPersona={(p: { nombre: string; departamento: string | null }) => (
            <>
              {p.nombre}
              <span className="text-gray-400"> · {p.departamento ?? 'sin departamento'}</span>
            </>
          )}
        />
        <Contador
          titulo="Sesiones abiertas"
          lista={data.sesionesAbiertas}
          renderPersona={(p: { nombre: string; desde: string }) => (
            <>
              {p.nombre}
              <span className="text-gray-400"> · desde {fmtDateOnly(p.desde)}</span>
            </>
          )}
        />
        <Contador
          titulo="Sin jefe asignado"
          lista={data.sinJefe}
          renderPersona={(p: { nombre: string }) => p.nombre}
        />
        <Contador
          titulo="Sin departamento asignado"
          lista={data.sinDepartamento}
          renderPersona={(p: { nombre: string }) => p.nombre}
        />
      </div>

      <div className="rounded-2xl border border-gray-100 p-4">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Por departamento</p>
        {data.porDepartamento === null ? (
          <p className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-800">
            <IconoAviso className="text-amber-500" />
            no disponible
          </p>
        ) : data.porDepartamento.length === 0 ? (
          <p className="text-xs text-gray-400">No hay departamentos cargados.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.porDepartamento.map(d => (
              <li key={d.departamentoId ?? '(sin departamento)'} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-gray-600">{d.departamento}</span>
                <span className="font-medium tabular-nums text-gray-700">{d.sinMarcar} / {d.total}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
