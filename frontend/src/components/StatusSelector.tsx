import { useState } from 'react';
import { ABSENCE_GROUP, DAY_GROUP, STATUS_CFG, cfgOf } from '../statusConfig';
import type { ResolvedStatus } from '../statusConfig';

export function StatusSelector({ current, onPick, onManageAbsences, disabled, dropUp }: {
  current: string;
  onPick: (s: ResolvedStatus) => void;
  /** Abre la lista de ausencias propias, el único lugar donde se cancelan. */
  onManageAbsences: () => void;
  disabled: boolean;
  dropUp?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const st = cfgOf(current);

  const pick = (s: ResolvedStatus) => {
    onPick(s);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors disabled:opacity-50"
      >
        <span className={`w-2 h-2 rounded-full ${st.dot}`} />
        <span className={`text-xs font-medium ${st.text}`}>{st.label}</span>
        <svg className={`w-3 h-3 text-gray-400 transition-transform ${dropUp ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className={`absolute ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'} right-0 w-52 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-40`}>
          <Group title="Estado del día" items={DAY_GROUP} current={current} onPick={pick} />
          <div className="border-t border-gray-100" />
          <Group title="Ausencia" items={ABSENCE_GROUP} current={current} onPick={pick} />
          {/* Sin esta entrada una ausencia no se puede deshacer desde ningún
              lado: al estar ausente, el resolver ignora el estado del día, así
              que volver a elegir "Disponible" no la levanta. */}
          <div className="border-t border-gray-100" />
          <button
            onClick={() => { onManageAbsences(); setOpen(false); }}
            className="w-full px-3 py-2 text-left text-xs text-gray-500 transition-colors hover:bg-gray-50"
          >
            Mis ausencias…
          </button>
        </div>
      )}
    </div>
  );
}

function Group({ title, items, current, onPick }: {
  title: string;
  items: ResolvedStatus[];
  current: string;
  onPick: (s: ResolvedStatus) => void;
}) {
  return (
    <div>
      <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </div>
      {items.map(s => {
        const cfg = STATUS_CFG[s];
        return (
          <button
            key={s}
            onClick={() => onPick(s)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${current === s ? 'bg-gray-50 font-semibold' : ''}`}
          >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
            <span className={cfg.text}>{cfg.label}</span>
            {cfg.icon && <span className="ml-auto text-xs">{cfg.icon}</span>}
          </button>
        );
      })}
    </div>
  );
}
