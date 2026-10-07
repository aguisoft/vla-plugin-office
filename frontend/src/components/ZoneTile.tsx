import { CronometroMini } from './CronometroMini';
import { ZonaIcon } from './ZonaIcon';
import iconoEscritorio from '../assets/app-escritorio.png';
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
export function ZoneTile({ zone, users, usePhotos, compacto, regadoPor }: {
  zone: Zone;
  users: UserSnapshot[];
  usePhotos?: boolean;
  compacto?: boolean;
  /** Quien regó la planta por última vez: lleva una marca hasta el próximo riego. */
  regadoPor?: string | null;
}) {
  const [hoveredUser, setHoveredUser] = useState<string | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  // Un ausente no ocupa un puesto: el conteo de la zona sigue midiendo presencia real.
  const online = users.filter(u => u.isCheckedIn && !u.isAbsent);

  return (
    <div
      className={`${compacto ? 'relative flex-shrink-0' : 'absolute'} rounded-2xl border border-gray-200 bg-white flex flex-col overflow-hidden transition-shadow hover:shadow-md`}
      style={{
        ...(compacto ? {} : { left: zone.x * TILE, top: zone.y * TILE }),
        width: zone.width * TILE,
        // Fluyendo, la altura la manda el contenido: la del plano dejaba a una
        // persona fuera de la tarjeta en las zonas llenas (Renee, en Academia)
        // y media tarjeta vacía en las de poca gente.
        // Fluyendo: un mínimo propio (encabezado + una fila) en vez del alto del
        // plano. Con el del plano, una zona de una persona quedaba con medio
        // metro de blanco debajo solo porque en el mapa ocupa mucho.
        ...(compacto
          // Fluyendo, el ancho del plano no manda: a ACADEMY le tocaba uno tan
          // angosto que el título se desbordaba y la gente caía de a uno por
          // fila. El mínimo da para tres avatares y para el nombre completo.
          ? { minHeight: 120, minWidth: 176 }
          : { height: zone.height * TILE }),
      }}
    >
      {/* Franja del departamento: el color identifica la zona sin teñir el fondo,
          así el color saturado queda reservado para el estado de las personas. */}
      <div className="h-1 flex-shrink-0" style={{ backgroundColor: zone.color || '#E5E7EB' }} />

      {/* Header */}
      <div className="flex items-start gap-1.5 px-2.5 pt-2 pb-1 flex-shrink-0">
        <ZonaIcon icon={zone.icon} color={zone.color} size={13} />
        <span className="min-w-0 break-words text-[10px] font-bold text-gray-500 leading-tight uppercase tracking-wide">
          {zone.name}
        </span>
        {online.length > 0 && (
          <span className="ml-auto flex-shrink-0 text-[9px] bg-green-100 text-green-700 rounded-full px-1.5 py-0.5 font-semibold">
            {online.length}
          </span>
        )}
      </div>

      {/* Avatars — pt-4 leaves room for emoji badges that extend above the avatar */}
      <div className="flex-1 flex flex-wrap gap-x-2 gap-y-3 px-2 pb-3 pt-1 content-start">
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
                {u.tieneEscritorio && (
                  /* El ícono real de la app, no un emoji: a este tamaño el 🖥
                     del sistema no se distinguía de una mancha. */
                  <img
                    src={iconoEscritorio}
                    alt=""
                    title="Tiene la app de escritorio"
                    width={11}
                    height={11}
                    className="absolute -top-0.5 -left-0.5 rounded-[2px]"
                  />
                )}
                {regadoPor === u.userId && (
                  <span
                    className="absolute -bottom-0.5 -left-0.5 text-[9px] leading-none"
                    title="Regó la planta de la oficina"
                  >🌱</span>
                )}
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
              <CronometroMini
                status={u.status}
                desde={u.absenceStartsAt ?? u.statusStartsAt}
                verAlertas={!!u.canSeeTimeAlerts}
              />
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
