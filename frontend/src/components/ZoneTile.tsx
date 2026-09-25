import { useState } from 'react';
import { AvatarSVG } from './AvatarSVG';
import { HoverCard } from './HoverCard';
import { TILE } from '../App';
import { cfgOf } from '../statusConfig';
import type { Zone, UserSnapshot } from '../types';

/**
 * `compacto` cambia el posicionamiento, no el aspecto: en vez de colocarse en
 * las coordenadas del layout, la zona se deja acomodar por el contenedor.
 * Existe porque al ocultar las zonas vacías de una planta posicionada en
 * absoluto quedaban huecos en blanco donde estaban. El tamaño se conserva en
 * los dos modos.
 */
export function ZoneTile({ zone, users, usePhotos, compacto }: {
  zone: Zone;
  users: UserSnapshot[];
  usePhotos?: boolean;
  compacto?: boolean;
}) {
  const [hoveredUser, setHoveredUser] = useState<string | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  // Un ausente no ocupa un puesto: el conteo de la zona sigue midiendo presencia real.
  const online = users.filter(u => u.isCheckedIn && !u.isAbsent);

  return (
    <div
      className={`${compacto ? 'relative flex-shrink-0' : 'absolute'} rounded-2xl border flex flex-col transition-shadow hover:shadow-md`}
      style={{
        ...(compacto ? {} : { left: zone.x * TILE, top: zone.y * TILE }),
        width: zone.width * TILE,
        height: zone.height * TILE,
        backgroundColor: zone.color ? `${zone.color}44` : '#F9FAFB',
        borderColor: zone.color ? `${zone.color}99` : '#E5E7EB',
        overflow: 'visible',
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

      {/* Avatars — pt-4 leaves room for emoji badges that extend above the avatar */}
      <div className="flex-1 flex flex-wrap gap-2 px-2 pb-2 content-start pt-4" style={{ overflow: 'visible' }}>
        {users.map(u => {
          // Un ausente tiene isCheckedIn en false pero igual se pinta: si no, se vería
          // gris, idéntico a un desconectado.
          const ringColor = (u.isCheckedIn || u.isAbsent) ? cfgOf(u.status).color : undefined;
          // El pulso de AVAILABLE solo aplica a quien está presente de verdad.
          const isPulse = u.isCheckedIn && !u.isAbsent && u.status === 'AVAILABLE';

          return (
            <div
              key={u.userId}
              className="flex flex-col items-center cursor-pointer flex-shrink-0 gap-0.5"
              style={{ width: 44 }}
              onMouseEnter={(e) => {
                setHoveredUser(u.userId);
                setAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect());
              }}
              onMouseLeave={() => {
                setHoveredUser(null);
                setAnchorRect(null);
              }}
            >
              {/* Avatar with rings */}
              <div className="relative flex-shrink-0" style={{ width: 36, height: 36 }}>
                {isPulse && (
                  <span
                    className="absolute inset-0 rounded-full animate-ping pointer-events-none"
                    style={{ backgroundColor: ringColor, opacity: 0.3 }}
                  />
                )}
                {(u.isCheckedIn || u.isAbsent) && !isPulse && (
                  <span
                    className="absolute inset-0 rounded-full pointer-events-none"
                    style={{ boxShadow: `0 0 0 2px ${ringColor}`, borderRadius: '50%' }}
                  />
                )}
                <div
                  className="absolute inset-0 flex items-center justify-center transition-opacity duration-200"
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
                {u.isAbsent && cfgOf(u.status).icon && (
                  <span className="absolute -bottom-0.5 -right-0.5 text-[9px] leading-none">
                    {cfgOf(u.status).icon}
                  </span>
                )}
              </div>
              {/* Name */}
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

      {/* Portal hover card */}
      {hoveredUser && anchorRect && (() => {
        const u = users.find(x => x.userId === hoveredUser);
        return u ? <HoverCard user={u} zoneName={zone.name} anchorRect={anchorRect} /> : null;
      })()}
    </div>
  );
}
