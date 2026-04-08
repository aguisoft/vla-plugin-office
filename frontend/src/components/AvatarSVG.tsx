import { useState } from 'react';
import { STATUS_CFG } from '../App';
import type { AvatarCfg } from '../types';

interface Props {
  cfg: AvatarCfg | null;
  photoUrl?: string;
  size?: number;
  status: string;
  isCheckedIn?: boolean;
  name?: string;
}

export function AvatarSVG({ cfg, photoUrl, size = 40, status, isCheckedIn = true, name }: Props) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const dot   = STATUS_CFG[status]?.dot ?? 'bg-gray-300';
  const s     = size;

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
  const dotR = s * 0.11;
  const dotCx = s - dotR - 1;
  const dotCy = s - dotR - 1;

  const emoji = cfg?.emoji;

  // ── Initials avatar (no photo, no custom cfg) ────────────────────────────────
  if (!photoUrl && !cfg) {
    const words = (name ?? '?').trim().split(/\s+/);
    const initials = (words.length >= 2
      ? words[0][0] + words[words.length - 1][0]
      : (words[0] ?? '?').slice(0, 2)
    ).toUpperCase();
    const PALETTE = ['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316','#eab308','#22c55e','#14b8a6','#0ea5e9','#3b82f6'];
    const bgColor = PALETTE[(name ?? '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
    return (
      <div className="relative inline-flex flex-col items-center" style={{ width: s, height: s + (emoji ? 14 : 0) }}>
        <div style={{ width: s, height: s, opacity: isCheckedIn ? 1 : 0.45, position: 'relative' }}>
          <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
            <circle cx={s / 2} cy={s / 2} r={s / 2} fill={bgColor} />
            <text
              x={s / 2} y={s / 2 + s * 0.13}
              textAnchor="middle" fill="white"
              fontSize={s * 0.38} fontWeight="600"
              fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
            >{initials}</text>
            <circle cx={dotCx} cy={dotCy} r={dotR} fill={dotColor} stroke="white" strokeWidth={1.5} />
          </svg>
        </div>
      </div>
    );
  }

  // ── Photo avatar ────────────────────────────────────────────────────────────
  if (photoUrl && !photoFailed) {
    return (
      <div className="relative inline-flex flex-col items-center" style={{ width: s, height: s + (emoji ? 14 : 0) }}>
        {emoji && (
          <span className="absolute -top-3 select-none" style={{ fontSize: s * 0.3, zIndex: 1 }}>{emoji}</span>
        )}
        <div style={{ width: s, height: s, opacity: isCheckedIn ? 1 : 0.35, position: 'relative' }}>
          <img
            src={photoUrl}
            alt=""
            style={{ width: s, height: s, borderRadius: '50%', objectFit: 'cover', display: 'block' }}
            onError={() => setPhotoFailed(true)}
          />
          <svg
            width={s} height={s}
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
            viewBox={`0 0 ${s} ${s}`}
          >
            <circle cx={dotCx} cy={dotCy} r={dotR} fill={dotColor} stroke="white" strokeWidth={1.5} />
          </svg>
        </div>
      </div>
    );
  }

  // ── SVG avatar ──────────────────────────────────────────────────────────────
  const skin  = cfg?.skinColor  ?? '#F5CBA7';
  const hair  = cfg?.hairColor  ?? '#2C2C2C';
  const shirt = cfg?.shirtColor ?? '#3498DB';
  const style = cfg?.hairStyle  ?? 'short';
  const acc   = cfg?.accessory  ?? 'none';
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

  return (
    <div className="relative inline-flex flex-col items-center" style={{ width: s, height: s + (emoji ? 14 : 0) }}>
      {emoji && (
        <span className="absolute -top-3 select-none" style={{ fontSize: s * 0.3 }}>{emoji}</span>
      )}
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ opacity: isCheckedIn ? 1 : 0.35 }}>
        <ellipse cx={cx} cy={s * 0.88} rx={r * 1.15} ry={r * 0.7} fill={shirt} />
        <circle cx={cx} cy={cx * 0.95} r={r} fill={skin} />
        {style !== 'bald' && hairPath[style] && (
          <path d={hairPath[style]} fill={hair} stroke={hair}
            strokeWidth={style === 'mohawk' ? 3 : 0} strokeLinecap="round" />
        )}
        <circle cx={cx - r * 0.32} cy={cx * 0.9} r={r * 0.1} fill="#2C2C2C" />
        <circle cx={cx + r * 0.32} cy={cx * 0.9} r={r * 0.1} fill="#2C2C2C" />
        <path d={`M${cx - r * 0.25},${cx * 1.05} Q${cx},${cx * 1.18} ${cx + r * 0.25},${cx * 1.05}`}
          fill="none" stroke="#8B4513" strokeWidth={r * 0.12} strokeLinecap="round" />
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
        <circle cx={dotCx} cy={dotCy} r={dotR} fill={dotColor} stroke="white" strokeWidth={1.5} />
      </svg>
    </div>
  );
}
