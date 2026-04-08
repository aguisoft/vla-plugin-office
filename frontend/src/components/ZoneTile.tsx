import { useState } from 'react';
import { AvatarSVG } from './AvatarSVG';
import { HoverCard } from './HoverCard';
import { TILE } from '../App';
import type { Zone, UserSnapshot } from '../types';

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
      <div className="flex-1 flex flex-wrap gap-1.5 px-2 pb-2 content-start overflow-hidden pt-0.5">
        {users.map(u => (
          <div
            key={u.userId}
            className="relative cursor-pointer"
            onMouseEnter={() => setHoveredUser(u.userId)}
            onMouseLeave={() => setHoveredUser(null)}
          >
            {hoveredUser === u.userId && <HoverCard user={u} />}
            <AvatarSVG cfg={u.avatar} size={32} status={u.status} isCheckedIn={u.isCheckedIn} />
          </div>
        ))}
      </div>
    </div>
  );
}
