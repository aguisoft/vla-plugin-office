import { useState } from 'react';
import { cfgOf, SELECTABLE, STATUS_CFG } from '../statusConfig';

export function StatusSelector({ current, onChange, disabled, dropUp }: {
  current: string;
  onChange: (s: string) => void;
  disabled: boolean;
  dropUp?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const st = cfgOf(current);

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
        <div className={`absolute ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'} right-0 w-44 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-40`}>
          {SELECTABLE.map(s => {
            const sc = STATUS_CFG[s];
            return (
              <button
                key={s}
                onClick={() => { onChange(s); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${current === s ? 'bg-gray-50 font-semibold' : ''}`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${sc.dot}`} />
                <span className={sc.text}>{sc.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
