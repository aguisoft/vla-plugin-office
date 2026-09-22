import { isoDate } from '../calendar';

export type Period = 'day' | 'week' | 'month';

const ETIQUETA: Record<Period, string> = { day: 'Día', week: 'Semana', month: 'Mes' };
const PASO_DIAS: Record<Period, number> = { day: 1, week: 7, month: 0 };

/**
 * Selector de período: día, semana o mes, con navegación adelante y atrás.
 *
 * El ancla es un `YYYY-MM-DD` y se mueve con componentes locales, nunca con
 * `toISOString()`: en UTC−6 eso correría un día en cada click.
 */
export function PeriodPicker({ period, anchor, onChange }: {
  period: Period;
  anchor: string;
  onChange: (period: Period, anchor: string) => void;
}) {
  const mover = (dir: -1 | 1) => {
    const [y, m, d] = anchor.split('-').map(Number);
    if (period === 'month') {
      const nm = m + dir;
      const ny = nm < 1 ? y - 1 : nm > 12 ? y + 1 : y;
      const mm = nm < 1 ? 12 : nm > 12 ? 1 : nm;
      onChange(period, isoDate(ny, mm - 1, 1));
      return;
    }
    const base = new Date(y, m - 1, d);
    base.setDate(base.getDate() + dir * PASO_DIAS[period]);
    onChange(period, isoDate(base.getFullYear(), base.getMonth(), base.getDate()));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
        {(['day', 'week', 'month'] as Period[]).map(p => (
          <button
            key={p}
            onClick={() => onChange(p, anchor)}
            className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
              period === p ? 'bg-white font-semibold text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {ETIQUETA[p]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => mover(-1)} aria-label="Período anterior"
          className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">‹</button>
        <button onClick={() => mover(1)} aria-label="Período siguiente"
          className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">›</button>
      </div>
    </div>
  );
}
