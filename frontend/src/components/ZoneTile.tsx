import { useState } from 'react';
import { AvatarSVG } from './AvatarSVG';
import { HoverCard } from './HoverCard';
import { TILE } from '../App';
import type { Zone, UserSnapshot } from '../types';

const STATUS_RING: Record<string, string> = {
  AVAILABLE:  '#4ade80',
  BUSY:       '#f87171',
  IN_MEETING: '#c084fc',
  FOCUS:      '#60a5fa',
  LUNCH:      '#fb923c',
  BRB:        '#facc15',
};

export function ZoneTile({ zone, users }: { zone: Zone; users: UserSnapshot[] }) {
  const [hoveredUser, setHoveredUser] = useState<string | null>(null);
  const online = users.filter(u => u.isCheckedIn);

  return (
    <div
      className="absolute rounded-2xl border overflow-visible flex flex-col transition-shadow hover:shadow-md"
      style={{
        left: zone.x * TILE,
        top: zone.y * TILE,
        width: zone.width * TILE,
        height: zone.height * TILE,
        backgroundColor: zone.color ? `${zone.color}44` : '#F9FAFB',
        borderColor: zone.color ? `${zone.color}99` : '#E5E7EB',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 flex-shrink-0">
        <span className="text-[10px] font-bold text-gray-600 truncate leading-tight uppercase tracking-wide">
          {zone.name}
        </span>
        {online.length > 0 && (
          <span className="ml-auto flex-shrink-0 text-[9px] bg-green-100 text-green-700 rounded-full px-1.5 py-0.5 font-semibold">
            {online.length}
          </span>
        )}
      </div>

      {/* Avatars */}
      <div className="flex-1 flex flex-wrap gap-2 px-2 pb-2 content-start overflow-hidden pt-0.5">
        {users.map(u => {
          const ringColor = u.isCheckedIn ? (STATUS_RING[u.status] ?? '#4ade80') : undefined;
          const isPulse = u.isCheckedIn && u.status === 'AVAILABLE';

          return (
            <div
              key={u.userId}
              className="relative cursor-pointer flex-shrink-0"
              style={{ width: 36, height: 36 }}
              onMouseEnter={() => setHoveredUser(u.userId)}
              onMouseLeave={() => setHoveredUser(null)}
            >
              {/* Pulse ring for AVAILABLE */}
              {isPulse && (
                <span
                  className="absolute inset-0 rounded-full animate-ping pointer-events-none"
                  style={{ backgroundColor: ringColor, opacity: 0.3 }}
                />
              )}
              {/* Static ring for other online statuses */}
              {u.isCheckedIn && !isPulse && (
                <span
                  className="absolute inset-0 rounded-full pointer-events-none"
                  style={{ boxShadow: `0 0 0 2px ${ringColor}`, borderRadius: '50%' }}
                />
              )}
              {/* Avatar */}
              <div
                className="absolute inset-0 flex items-center justify-center transition-opacity duration-200"
                style={{
                  opacity: u.isCheckedIn ? 1 : 0.4,
                  filter: u.isCheckedIn ? 'none' : 'grayscale(50%)',
                }}
              >
                <AvatarSVG
                  cfg={u.avatar}
                  photoUrl={u.photoUrl}
                  size={32}
                  status={u.status}
                  isCheckedIn={true}
                  name={`${u.firstName} ${u.lastName}`}
                />
              </div>
              {/* Hover card */}
              {hoveredUser === u.userId && <HoverCard user={u} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
