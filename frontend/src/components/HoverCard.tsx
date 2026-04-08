import { AvatarSVG } from './AvatarSVG';
import { STATUS_CFG } from '../App';
import type { UserSnapshot } from '../types';

export function HoverCard({ user }: { user: UserSnapshot }) {
  const st = STATUS_CFG[user.status] ?? STATUS_CFG['OFFLINE'];
  return (
    <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-white rounded-2xl shadow-xl border border-gray-100 p-3 pointer-events-none">
      <div className="flex items-center gap-3 mb-2">
        <AvatarSVG cfg={user.avatar} photoUrl={user.photoUrl} size={40} status={user.status} isCheckedIn={user.isCheckedIn} />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-800 truncate">
            {user.firstName} {user.lastName}
          </p>
          <p className="text-[10px] text-gray-400 truncate">{user.email}</p>
        </div>
      </div>
      <div className={`flex items-center gap-1.5 text-[10px] font-medium ${st.color}`}>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${st.dot}`} />
        {st.label}
        {user.statusMessage && (
          <span className="text-gray-400 font-normal">· {user.statusMessage}</span>
        )}
      </div>
      {/* Arrow */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-white" />
    </div>
  );
}
