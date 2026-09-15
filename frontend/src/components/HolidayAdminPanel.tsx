import { useEffect, useState } from 'react';
import { listHolidays, createHoliday, deleteHoliday, ApiError } from '../api';
import type { StatusError } from '../api';
import { fmtDateOnly } from '../format';
import { DateField } from './modalParts';
import type { Holiday } from '../types';

const currentYear = new Date().getFullYear();

/**
 * Panel administrativo: RRHH carga el calendario de feriados por país. Sigue
 * el envoltorio de `BitrixSettings.tsx` -- `embedded` para vivir dentro de
 * una página, o modal flotante si no -- pero el gating por `office.manage`
 * vive en el llamador (`App.tsx`), igual que ahí: este componente no sabe
 * nada de permisos, confía en que solo se monte cuando corresponde.
 */
export function HolidayAdminPanel({ onClose, embedded }: { onClose: () => void; embedded?: boolean }) {
  const [holidays, setHolidays] = useState<Holiday[] | null>(null);
  const [year, setYear] = useState(currentYear);
  const [country, setCountry] = useState('');

  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [newCountry, setNewCountry] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = () =>
    // Se guarda siempre en mayúsculas (ver handleCreate); si el filtro no
    // hace lo mismo, escribir "cr" no encuentra los feriados de "CR".
    listHolidays(year, country.trim().toUpperCase() || undefined).then(setHolidays).catch(() => setHolidays([]));

  useEffect(() => { void reload(); }, [year, country]);

  async function handleCreate() {
    setCreating(true);
    setFormError(null);
    try {
      await createHoliday({ date, name: name.trim(), country: newCountry.trim().toUpperCase() });
      setDate('');
      setName('');
      setNewCountry('');
      await reload();
    } catch (e) {
      const detail = e instanceof ApiError ? (e.detail as StatusError | undefined) : undefined;
      setFormError(detail?.errors?.[0]?.message ?? detail?.message ?? 'No se pudo crear el feriado');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteHoliday(id);
      setHolidays(prev => prev?.filter(h => h.id !== id) ?? prev);
    } catch {
      await reload();
    } finally {
      setDeletingId(null);
    }
  }

  const canCreate = !!date && name.trim().length > 0 && newCountry.trim().length > 0 && !creating;

  const content = (
    <>
      {!embedded && (
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-800">Feriados</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Alta de feriado */}
      <div className="mb-5">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Nuevo feriado
        </p>
        <div className="flex items-center gap-2">
          <DateField label="Fecha" value={date} onChange={setDate} />
          <label className="flex-1 text-xs text-gray-500">
            País
            <input
              type="text"
              value={newCountry}
              onChange={e => setNewCountry(e.target.value)}
              placeholder="CR"
              maxLength={2}
              className="mt-1 w-full rounded-xl border border-gray-200 p-2 text-xs uppercase focus:border-gray-400 focus:outline-none"
            />
          </label>
        </div>
        <label className="mt-2 block text-xs text-gray-500">
          Nombre
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Día de la Independencia"
            className="mt-1 w-full rounded-xl border border-gray-200 p-2 text-xs focus:border-gray-400 focus:outline-none"
          />
        </label>
        {formError && <p className="mt-2 text-xs text-red-500">{formError}</p>}
        <button
          onClick={handleCreate}
          disabled={!canCreate}
          className="mt-3 w-full rounded-xl bg-gray-800 py-2 text-xs font-semibold text-white transition-colors disabled:bg-gray-300"
        >
          {creating ? 'Guardando…' : 'Agregar feriado'}
        </button>
      </div>

      <div className="my-4 border-t border-gray-100" />

      {/* Filtros */}
      <div className="mb-3 flex items-center gap-2">
        <label className="flex-1 text-xs text-gray-500">
          Año
          <input
            type="number"
            value={year}
            onChange={e => setYear(Number(e.target.value) || currentYear)}
            className="mt-1 w-full rounded-xl border border-gray-200 p-2 text-xs focus:border-gray-400 focus:outline-none"
          />
        </label>
        <label className="flex-1 text-xs text-gray-500">
          País
          <input
            type="text"
            value={country}
            onChange={e => setCountry(e.target.value)}
            placeholder="Todos"
            maxLength={2}
            className="mt-1 w-full rounded-xl border border-gray-200 p-2 text-xs uppercase focus:border-gray-400 focus:outline-none"
          />
        </label>
      </div>

      {/* Tabla */}
      {holidays === null ? (
        <p className="py-4 text-center text-xs text-gray-400">Cargando…</p>
      ) : holidays.length === 0 ? (
        <p className="py-4 text-center text-xs text-gray-400">
          No hay feriados cargados para este filtro.
        </p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {holidays.map(h => (
            <li key={h.id} className="flex items-center justify-between rounded-xl px-2.5 py-2 text-xs hover:bg-gray-50">
              <div className="min-w-0">
                <span className="font-semibold text-gray-700">{fmtDateOnly(h.date)}</span>
                <span className="ml-2 text-gray-400">{h.country}</span>
                <p className="truncate text-gray-500">{h.name}</p>
              </div>
              <button
                onClick={() => handleDelete(h.id)}
                disabled={deletingId === h.id}
                className="flex-shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold text-red-500 hover:bg-red-50 disabled:opacity-50"
              >
                Borrar
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
        {content}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-96 overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        {content}
      </div>
    </div>
  );
}
