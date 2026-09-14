import type { ReactNode } from 'react';

/**
 * Envoltorio compartido de los modales de payload: overlay + panel + título.
 * `dot` es el punto de color del estado que se está fijando — opcional porque
 * no todos los modales representan un único estado puntual (p. ej. la alerta
 * de participantes ausentes que agrega la Task 22).
 */
export function Shell({ title, dot, onClose, children }: {
  title: string;
  dot?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}
          <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

/** `<input type="time">` con label arriba, mismo estilo que el resto de los campos de los modales. */
export function TimeField({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex-1 text-xs text-gray-500">
      {label}
      <input
        type="time"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-gray-200 p-2 text-xs focus:border-gray-400 focus:outline-none"
      />
    </label>
  );
}

/** `<input type="date">` con label arriba; `min`/`max` acotan el rango elegible (p. ej. feriados movibles). */
export function DateField({ label, value, onChange, min, max }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
}) {
  return (
    <label className="flex-1 text-xs text-gray-500">
      {label}
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        min={min}
        max={max}
        className="mt-1 w-full rounded-xl border border-gray-200 p-2 text-xs focus:border-gray-400 focus:outline-none"
      />
    </label>
  );
}

/** Fila Cancelar/Confirmar de todos los modales; `confirmLabel` deja mostrar el contador de caracteres faltantes. */
export function Actions({ onClose, onConfirm, disabled, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar' }: {
  onClose: () => void;
  onConfirm: () => void;
  disabled?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}) {
  return (
    <div className="mt-3 flex items-center justify-end gap-2">
      <button onClick={onClose} className="rounded-xl px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100">
        {cancelLabel}
      </button>
      <button
        disabled={disabled}
        onClick={onConfirm}
        className="rounded-xl bg-gray-800 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-gray-300"
      >
        {confirmLabel}
      </button>
    </div>
  );
}
