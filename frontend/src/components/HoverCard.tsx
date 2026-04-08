import { AvatarSVG } from './AvatarSVG';
import { STATUS_CFG } from '../App';
import type { UserSnapshot } from '../types';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'hace un momento';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

export function HoverCard({ user }: { user: UserSnapshot }) {
  const st = STATUS_CFG[user.status] ?? STATUS_CFG['OFFLINE'];

  return (
    <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2.5 w-52 bg-white rounded-2xl shadow-2xl border border-gray-100 p-3.5 pointer-events-none">
      {/* Avatar + name */}
      <div className="flex items-center gap-3 mb-2.5">
        <AvatarSVG
          cfg={user.avatar}
          photoUrl={user.photoUrl}
          size={44}
          status={user.status}
          isCheckedIn={user.isCheckedIn}
          name={`${user.firstName} ${user.lastName}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-gray-800 leading-tight truncate">
            {user.firstName} {user.lastName}
          </p>
          <p className="text-[10px] text-gray-400 truncate mt-0.5">{user.email}</p>
        </div>
      </div>

      {/* Status */}
      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-semibold mb-2 ${
        user.isCheckedIn ? 'bg-gray-50' : 'bg-gray-50 opacity-60'
      } ${st.color}`}>
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${st.dot}`} />
        <span>{st.label}</span>
        {user.statusMessage && (
          <span className="text-gray-400 font-normal truncate">· {user.statusMessage}</span>
        )}
      </div>

      {/* Meta info */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[9px] text-gray-400">
          <span className="font-medium text-gray-500">
            {user.isCheckedIn ? 'En oficina' : 'Fuera de oficina'}
          </span>
          <span>{timeAgo(user.lastActivityAt)}</span>
        </div>
        <div className="flex items-center justify-between text-[9px] text-gray-400">
          <span>Rol</span>
          <span className="font-medium text-gray-600 capitalize">{user.role.toLowerCase()}</span>
        </div>
      </div>

      {/* Arrow */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-white" />
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-px w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-100" style={{ marginTop: '1px' }} />
    </div>
  );
}
