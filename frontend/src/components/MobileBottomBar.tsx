import { AvatarSVG } from './AvatarSVG';
import { StatusSelector } from './StatusSelector';
import type { UserSnapshot } from '../types';

interface MobileBottomBarProps {
  isCheckedIn: boolean;
  myStatus: string;
  myUser: UserSnapshot | undefined;
  actionLoading: boolean;
  onCheckIn: () => void;
  onCheckOut: () => void;
  onStatusChange: (status: string) => void;
  onOpenDrawer: () => void;
  onOpenAvatar: () => void;
}

export function MobileBottomBar({
  isCheckedIn, myStatus, myUser, actionLoading,
  onCheckIn, onCheckOut, onStatusChange, onOpenDrawer, onOpenAvatar,
}: MobileBottomBarProps) {
  return (
    <div
      className="flex-shrink-0 md:hidden bg-white border-t border-gray-100 flex items-center justify-around px-4 py-2 z-30"
      style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}
    >
      {/* Status selector — solo cuando checkeado */}
      <div className="flex-1 flex justify-center">
        <div className={isCheckedIn ? '' : 'invisible pointer-events-none'}>
          <StatusSelector
            current={myStatus}
            onChange={onStatusChange}
            disabled={actionLoading}
            dropUp
          />
        </div>
      </div>

      {/* Check in/out */}
      <button
        onClick={isCheckedIn ? onCheckOut : onCheckIn}
        disabled={actionLoading}
        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 ${
          isCheckedIn
            ? 'bg-red-50 text-red-500 hover:bg-red-100'
            : 'bg-green-500 text-white hover:bg-green-600'
        }`}
      >
        {actionLoading
          ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          : isCheckedIn ? 'Salir' : 'Entrar'}
      </button>

      {/* Drawer de personas */}
      <button
        onClick={onOpenDrawer}
        disabled={actionLoading}
        className="flex-1 flex flex-col items-center gap-0.5 px-2 py-1 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
      >
        <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="text-[9px] text-gray-400">Personas</span>
      </button>

      {/* Avatar / Yo */}
      <button
        onClick={onOpenAvatar}
        disabled={actionLoading}
        className="flex-1 flex flex-col items-center gap-0.5 px-2 py-1 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
      >
        {myUser ? (
          <AvatarSVG
            cfg={myUser.avatar}
            photoUrl={myUser.photoUrl}
            useInitials
            size={28}
            status={myStatus}
            isCheckedIn={isCheckedIn}
            name={`${myUser.firstName} ${myUser.lastName}`}
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-gray-200" />
        )}
        <span className="text-[9px] text-gray-400">Yo</span>
      </button>
    </div>
  );
}
