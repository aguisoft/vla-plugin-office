import { AvatarSVG } from './AvatarSVG';
import { STATUS_CFG } from '../App';
import type { UserSnapshot } from '../types';

export function Sidebar({ users, myUserId, onAvatarClick }: {
  users: UserSnapshot[];
  myUserId?: string;
  onAvatarClick: () => void;
}) {
  const online  = users.filter(u => u.isCheckedIn);
  const offline = users.filter(u => !u.isCheckedIn);

  function UserCard({ u }: { u: UserSnapshot }) {
    const st = STATUS_CFG[u.status] ?? STATUS_CFG['OFFLINE'];
    const isMe = u.userId === myUserId;
    return (
      <div className={`flex items-center gap-2.5 px-3 py-2 rounded-xl transition-colors ${isMe ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
        <div
          className="relative flex-shrink-0"
          onClick={isMe ? onAvatarClick : undefined}
          style={{ cursor: isMe ? 'pointer' : 'default' }}
        >
          <AvatarSVG cfg={u.avatar} photoUrl={u.photoUrl} size={34} status={u.status} isCheckedIn={u.isCheckedIn} name={`${u.firstName} ${u.lastName}`} />
          {isMe && (
            <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-white rounded-full flex items-center justify-center border border-gray-200">
              <svg className="w-2.5 h-2.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-gray-700 truncate leading-tight">
            {u.firstName} {u.lastName}
            {isMe && <span className="text-green-500 ml-1 text-[9px]">tú</span>}
          </p>
          <p className={`text-[10px] ${st.color} truncate`}>
            {st.label}{u.statusMessage ? ` · ${u.statusMessage}` : ''}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-56 flex-shrink-0 flex flex-col border-l border-gray-100 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
          Oficina · <span className="text-green-500">{online.length} en línea</span>
        </p>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {online.length > 0 && (
          <>
            <p className="px-4 pt-2 pb-1 text-[9px] font-bold text-gray-400 uppercase tracking-widest">Presentes</p>
            {online.map(u => <UserCard key={u.userId} u={u} />)}
          </>
        )}
        {offline.length > 0 && (
          <>
            <p className="px-4 pt-3 pb-1 text-[9px] font-bold text-gray-400 uppercase tracking-widest">Fuera de oficina</p>
            {offline.map(u => <UserCard key={u.userId} u={u} />)}
          </>
        )}
      </div>
    </div>
  );
}
