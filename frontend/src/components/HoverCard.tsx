import { createPortal } from 'react-dom';
import { AvatarSVG } from './AvatarSVG';
import { STATUS_CFG } from '../App';
import type { UserSnapshot } from '../types';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'hace un momento';
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h ${m % 60}m`;
  return `hace ${Math.floor(h / 24)}d`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

function duration(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Administrador',
  USER: 'Usuario',
  MODERATOR: 'Moderador',
};


interface HoverCardProps {
  user: UserSnapshot;
  zoneName?: string;
  anchorRect: DOMRect;
}

export function HoverCard({ user, zoneName, anchorRect }: HoverCardProps) {
  const st = STATUS_CFG[user.status] ?? STATUS_CFG['OFFLINE'];

  const CARD_W = 240;
  const CARD_H = 200; // approximate
  const MARGIN = 8;

  // Position: above the anchor by default, centered
  let left = anchorRect.left + anchorRect.width / 2 - CARD_W / 2;
  let top  = anchorRect.top - CARD_H - 10;

  // Clamp horizontally
  if (left < MARGIN) left = MARGIN;
  if (left + CARD_W > window.innerWidth - MARGIN) left = window.innerWidth - CARD_W - MARGIN;

  // If not enough space above, flip below
  const below = anchorRect.bottom + 10;
  const flipBelow = top < MARGIN;
  if (flipBelow) top = below;

  const arrowStyle = flipBelow
    ? { borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderBottom: '6px solid white', top: -6, bottom: 'auto' }
    : { borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '6px solid white', bottom: -6, top: 'auto' };

  // Compute arrow horizontal offset (clamped to card bounds)
  const anchorCenterX = anchorRect.left + anchorRect.width / 2;
  let arrowLeft = anchorCenterX - left - 6;
  arrowLeft = Math.max(12, Math.min(CARD_W - 24, arrowLeft));

  const dotColorMap: Record<string, string> = {
    'bg-green-400':  '#4ade80',
    'bg-red-400':    '#f87171',
    'bg-purple-400': '#c084fc',
    'bg-blue-400':   '#60a5fa',
    'bg-orange-400': '#fb923c',
    'bg-yellow-400': '#facc15',
    'bg-gray-300':   '#d1d5db',
  };
  const stripColor = dotColorMap[st.dot] ?? '#d1d5db';

  const card = (
    <div
      style={{
        position: 'fixed',
        left,
        top,
        width: CARD_W,
        zIndex: 99999,
        pointerEvents: 'none',
        filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.15))',
      }}
    >
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {/* Color strip */}
        <div style={{ height: 4, backgroundColor: stripColor }} />

        <div className="p-3.5">
          {/* Avatar + name */}
          <div className="flex items-center gap-3 mb-3">
            <AvatarSVG
              cfg={user.avatar}
              photoUrl={user.photoUrl}
              useInitials
              size={46}
              status={user.status}
              isCheckedIn={user.isCheckedIn}
              name={`${user.firstName} ${user.lastName}`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-gray-900 leading-tight truncate">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-[10px] text-gray-400 truncate mt-0.5">{user.email}</p>
              <span className="inline-block mt-1 px-1.5 py-0.5 rounded-md bg-gray-100 text-[9px] font-semibold text-gray-500 uppercase tracking-wide">
                {ROLE_LABEL[user.role] ?? user.role}
              </span>
            </div>
          </div>

          {/* Status pill */}
          <div
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl mb-2.5 text-[11px] font-semibold"
            style={{ backgroundColor: '#f9fafb', opacity: user.isCheckedIn ? 1 : 0.7 }}
          >
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${st.dot} ${user.isCheckedIn && user.status === 'AVAILABLE' ? 'animate-pulse' : ''}`}
            />
            <span className={st.color}>{st.label}</span>
            {user.statusMessage && (
              <span className="text-gray-400 font-normal ml-auto truncate max-w-[80px] text-[10px]">
                {user.statusMessage}
              </span>
            )}
          </div>

          {/* Info rows */}
          <div className="space-y-1.5">
            {user.isCheckedIn ? (
              <>
                {user.checkedInAt && (
                  <InfoRow
                    icon={<EnterIcon />}
                    label="Entró a las"
                    value={
                      <>{formatTime(user.checkedInAt)} <span className="text-gray-400 font-normal">({duration(user.checkedInAt)})</span></>
                    }
                  />
                )}
                {zoneName && (
                  <InfoRow icon={<ZoneIcon />} label="Zona" value={zoneName} />
                )}
                <InfoRow icon={<ClockIcon />} label="Última actividad" value={timeAgo(user.lastActivityAt)} muted />
              </>
            ) : (
              <InfoRow icon={<ExitIcon />} label="Última vez en oficina" value={timeAgo(user.lastActivityAt)} muted />
            )}
          </div>
        </div>
      </div>

      {/* Arrow */}
      <div style={{ position: 'absolute', left: arrowLeft, width: 0, height: 0, ...arrowStyle }} />
    </div>
  );

  return createPortal(card, document.body);
}

function InfoRow({ icon, label, value, muted }: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span className="text-gray-400 flex items-center gap-1">{icon}{label}</span>
      <span className={muted ? 'font-medium text-gray-400' : 'font-semibold text-gray-700'}>{value}</span>
    </div>
  );
}

function EnterIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
    </svg>
  );
}

function ZoneIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function ExitIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );
}
