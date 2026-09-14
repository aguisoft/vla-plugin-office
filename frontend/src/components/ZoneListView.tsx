import { useState, useCallback, useEffect } from 'react';
import { AvatarSVG } from './AvatarSVG';
import { HoverCard } from './HoverCard';
import { cfgOf } from '../statusConfig';
import type { Zone, UserSnapshot } from '../types';

export function ZoneListView({ zones, zoneUsersMap, usePhotos, active }: {
  zones: Zone[];
  zoneUsersMap: Map<string, UserSnapshot[]>;
  usePhotos?: boolean;
  active?: boolean;
}) {
  const [selectedUser, setSelectedUser] = useState<{ userId: string; zoneName: string; rect: DOMRect } | null>(null);

  useEffect(() => {
    if (!active) setSelectedUser(null);
  }, [active]);

  const handleAvatarClick = useCallback((u: UserSnapshot, zoneName: string, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setSelectedUser(prev =>
      prev?.userId === u.userId ? null : { userId: u.userId, zoneName, rect }
    );
  }, []);

  const allUsers = Array.from(zoneUsersMap.values()).flat();
  const selectedUserData = selectedUser ? allUsers.find(u => u.userId === selectedUser.userId) : null;

  const zoneCards = zones
    .map(zone => ({
      zone,
      users: zoneUsersMap.get(zone.id) ?? [],
      online: (zoneUsersMap.get(zone.id) ?? []).filter(u => u.isCheckedIn),
    }))
    .sort((a, b) => b.online.length - a.online.length);

  return (
    <div className="flex flex-col gap-3 p-4" onClick={() => setSelectedUser(null)}>
      {zoneCards.map(({ zone, users, online }) => (
        <div
          key={zone.id}
          className="bg-white rounded-2xl border p-4 transition-opacity"
          style={{
            borderColor: zone.color ? `${zone.color}99` : '#E5E7EB',
            opacity: online.length === 0 ? 0.6 : 1,
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wide">
              {zone.name}
            </span>
            {online.length > 0 && (
              <span className="text-[9px] bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-semibold">
                {online.length}
              </span>
            )}
          </div>

          {users.length === 0 ? (
            <p className="text-[10px] text-gray-400">Vacío</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {users.map(u => {
                const ringColor = u.isCheckedIn ? cfgOf(u.status).color : undefined;
                const isSelected = selectedUser?.userId === u.userId;
                return (
                  <div
                    key={u.userId}
                    className="flex flex-col items-center gap-0.5 flex-shrink-0 cursor-pointer"
                    style={{ width: 44 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAvatarClick(u, zone.name, e.currentTarget as HTMLElement);
                    }}
                  >
                    <div
                      className="relative flex-shrink-0"
                      style={{
                        width: 36,
                        height: 36,
                        outline: isSelected ? '2px solid #6366f1' : 'none',
                        outlineOffset: 2,
                        borderRadius: '50%',
                      }}
                    >
                      {u.isCheckedIn && u.status === 'AVAILABLE' && (
                        <span
                          className="absolute inset-0 rounded-full animate-ping pointer-events-none"
                          style={{ backgroundColor: ringColor, opacity: 0.3 }}
                        />
                      )}
                      {u.isCheckedIn && u.status !== 'AVAILABLE' && ringColor && (
                        <span
                          className="absolute inset-0 rounded-full pointer-events-none"
                          style={{ boxShadow: `0 0 0 2px ${ringColor}`, borderRadius: '50%' }}
                        />
                      )}
                      <div
                        className="absolute inset-0 flex items-center justify-center"
                        style={{
                          opacity: u.isCheckedIn ? 1 : 0.4,
                          filter: u.isCheckedIn ? 'none' : 'grayscale(50%)',
                        }}
                      >
                        <AvatarSVG
                          cfg={u.avatar}
                          photoUrl={usePhotos ? u.photoUrl : undefined}
                          useInitials={usePhotos}
                          size={32}
                          status={u.status}
                          isCheckedIn={true}
                          name={`${u.firstName} ${u.lastName}`}
                        />
                      </div>
                    </div>
                    <span
                      className="text-center leading-tight select-none"
                      style={{
                        fontSize: 8,
                        color: u.isCheckedIn ? '#374151' : '#9ca3af',
                        width: 44,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {u.firstName}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {selectedUserData && selectedUser && (
        <HoverCard
          user={selectedUserData}
          zoneName={selectedUser.zoneName}
          anchorRect={selectedUser.rect}
        />
      )}
    </div>
  );
}
