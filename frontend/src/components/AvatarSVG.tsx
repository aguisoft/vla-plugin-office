import { STATUS_CFG } from '../App';
import type { AvatarCfg } from '../types';

export function AvatarSVG({ cfg, size = 40, status, isCheckedIn = true }: {
  cfg: AvatarCfg | null;
  size?: number;
  status: string;
  isCheckedIn?: boolean;
}) {
  const skin  = cfg?.skinColor  ?? '#F5CBA7';
  const hair  = cfg?.hairColor  ?? '#2C2C2C';
  const shirt = cfg?.shirtColor ?? '#3498DB';
  const style = cfg?.hairStyle  ?? 'short';
  const acc   = cfg?.accessory  ?? 'none';
  const emoji = cfg?.emoji;
  const dot   = STATUS_CFG[status]?.dot ?? 'bg-gray-300';
  const s     = size;
  const cx    = s / 2;
  const r     = s * 0.28;

  const hairPath: Record<string, string> = {
    short:    `M${cx - r},${cx * 0.72} Q${cx},${cx * 0.3} ${cx + r},${cx * 0.72}`,
    long:     `M${cx - r * 1.1},${cx * 0.72} Q${cx},${cx * 0.2} ${cx + r * 1.1},${cx * 0.72} L${cx + r * 0.9},${cx * 1.8} Q${cx},${cx * 2} ${cx - r * 0.9},${cx * 1.8} Z`,
    curly:    `M${cx - r},${cx * 0.72} Q${cx - r * 0.5},${cx * 0.25} ${cx},${cx * 0.35} Q${cx + r * 0.5},${cx * 0.25} ${cx + r},${cx * 0.72}`,
    bald:     '',
    ponytail: `M${cx - r},${cx * 0.72} Q${cx},${cx * 0.3} ${cx + r},${cx * 0.72} M${cx + r * 0.8},${cx * 0.8} Q${cx + r * 1.4},${cx * 1.2} ${cx + r * 1.1},${cx * 1.6}`,
    mohawk:   `M${cx - r * 0.3},${cx * 0.65} L${cx},${cx * 0.15} L${cx + r * 0.3},${cx * 0.65}`,
    afro:     `M${cx - r * 1.1},${cx * 0.85} Q${cx - r * 1.2},${cx * 0.3} ${cx},${cx * 0.25} Q${cx + r * 1.2},${cx * 0.3} ${cx + r * 1.1},${cx * 0.85}`,
    buzz:     `M${cx - r * 0.95},${cx * 0.72} Q${cx},${cx * 0.38} ${cx + r * 0.95},${cx * 0.72}`,
  };

  // Map Tailwind dot class to hex color for SVG use
  const dotColors: Record<string, string> = {
    'bg-green-400':  '#4ade80',
    'bg-red-400':    '#f87171',
    'bg-purple-400': '#c084fc',
    'bg-blue-400':   '#60a5fa',
    'bg-orange-400': '#fb923c',
    'bg-yellow-400': '#facc15',
    'bg-gray-300':   '#d1d5db',
  };
  const dotColor = dotColors[dot] ?? '#d1d5db';

  return (
    <div className="relative inline-flex flex-col items-center" style={{ width: s, height: s + (emoji ? 14 : 0) }}>
      {emoji && (
        <span className="absolute -top-3 select-none" style={{ fontSize: s * 0.3 }}>{emoji}</span>
      )}
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ opacity: isCheckedIn ? 1 : 0.35 }}>
        {/* Shirt/body */}
        <ellipse cx={cx} cy={s * 0.88} rx={r * 1.15} ry={r * 0.7} fill={shirt} />
        {/* Head */}
        <circle cx={cx} cy={cx * 0.95} r={r} fill={skin} />
        {/* Hair */}
        {style !== 'bald' && hairPath[style] && (
          <path d={hairPath[style]} fill={hair} stroke={hair}
            strokeWidth={style === 'mohawk' ? 3 : 0} strokeLinecap="round" />
        )}
        {/* Eyes */}
        <circle cx={cx - r * 0.32} cy={cx * 0.9} r={r * 0.1} fill="#2C2C2C" />
        <circle cx={cx + r * 0.32} cy={cx * 0.9} r={r * 0.1} fill="#2C2C2C" />
        {/* Smile */}
        <path d={`M${cx - r * 0.25},${cx * 1.05} Q${cx},${cx * 1.18} ${cx + r * 0.25},${cx * 1.05}`}
          fill="none" stroke="#8B4513" strokeWidth={r * 0.12} strokeLinecap="round" />
        {/* Accessories */}
        {acc === 'glasses' && (
          <g fill="none" stroke="#555" strokeWidth={r * 0.1}>
            <circle cx={cx - r * 0.3} cy={cx * 0.9} r={r * 0.2} />
            <circle cx={cx + r * 0.3} cy={cx * 0.9} r={r * 0.2} />
            <line x1={cx - r * 0.1} y1={cx * 0.9} x2={cx + r * 0.1} y2={cx * 0.9} />
          </g>
        )}
        {acc === 'headphones' && (
          <path d={`M${cx - r * 0.9},${cx * 0.75} Q${cx},${cx * 0.3} ${cx + r * 0.9},${cx * 0.75}`}
            fill="none" stroke="#555" strokeWidth={r * 0.18} strokeLinecap="round" />
        )}
        {acc === 'hat' && (
          <g fill={hair}>
            <rect x={cx - r * 1.05} y={cx * 0.6} width={r * 2.1} height={r * 0.15} rx={2} />
            <rect x={cx - r * 0.55} y={cx * 0.25} width={r * 1.1} height={r * 0.45} rx={3} />
          </g>
        )}
        {acc === 'earbuds' && (
          <g fill="#555">
            <circle cx={cx - r * 0.95} cy={cx * 0.95} r={r * 0.12} />
            <circle cx={cx + r * 0.95} cy={cx * 0.95} r={r * 0.12} />
          </g>
        )}
        {/* Status dot */}
        <circle cx={s - r * 0.4} cy={s - r * 0.4} r={s * 0.11} fill={dotColor} stroke="white" strokeWidth={1.5} />
      </svg>
    </div>
  );
}
