import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from './api';
import { AvatarSVG } from './components/AvatarSVG';
import { HoverCard } from './components/HoverCard';
import { ZoneTile } from './components/ZoneTile';
import { AvatarModal } from './components/AvatarModal';
import { StatusSelector } from './components/StatusSelector';
import { Sidebar } from './components/Sidebar';
import { BitrixSettings } from './components/BitrixSettings';
import type { UserSnapshot, LayoutData, AvatarCfg } from './types';

const STATUSES = ['AVAILABLE', 'BUSY', 'IN_MEETING', 'FOCUS', 'LUNCH', 'BRB'] as const;
export { STATUSES };

export const STATUS_CFG: Record<string, { label: string; color: string; dot: string }> = {
  AVAILABLE:  { label: 'Disponible',    color: 'text-green-600',  dot: 'bg-green-400' },
  BUSY:       { label: 'Ocupado',       color: 'text-red-500',    dot: 'bg-red-400' },
  IN_MEETING: { label: 'En reunión',    color: 'text-purple-600', dot: 'bg-purple-400' },
  FOCUS:      { label: 'Concentrado',   color: 'text-blue-600',   dot: 'bg-blue-400' },
  LUNCH:      { label: 'Almuerzo',      color: 'text-orange-500', dot: 'bg-orange-400' },
  BRB:        { label: 'Vuelvo pronto', color: 'text-yellow-600', dot: 'bg-yellow-400' },
  OFFLINE:    { label: 'Desconectado',  color: 'text-gray-400',   dot: 'bg-gray-300' },
};

export const TILE = 20;

export default function App() {
  const [currentUser, setCurrentUser]     = useState<{ id: string; role: string } | null>(null);
  const [layout, setLayout]               = useState<LayoutData | null>(null);
  const [users, setUsers]                 = useState<UserSnapshot[]>([]);
  const [loading, setLoading]             = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [connected, setConnected]         = useState(false);
  const [isCheckedIn, setIsCheckedIn]     = useState(false);
  const [myStatus, setMyStatus]           = useState('OFFLINE');
  const [showAvatarModal, setShowAvatarModal]       = useState(false);
  const [showBitrixSettings, setShowBitrixSettings] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  // ── Bootstrap: get current user then load data ─────────────────────────────

  useEffect(() => {
    api.get<{ id: string; role: string }>('/auth/me')
      .then(u => setCurrentUser(u))
      .catch(() => {
        window.location.href = '/login';
      });
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [layoutRes, snapshotRes] = await Promise.all([
        api.get<{ layout: LayoutData | null }>('/p/office/layout'),
        api.get<UserSnapshot[]>('/p/office/snapshot'),
      ]);
      setLayout(layoutRes.layout);
      setUsers(snapshotRes);

      if (currentUser?.id) {
        const me = snapshotRes.find(u => u.userId === currentUser.id);
        if (me) {
          setIsCheckedIn(me.isCheckedIn);
          setMyStatus(me.status);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (currentUser) loadData();
  }, [currentUser, loadData]);

  // ── SSE ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const es = new EventSource('/api/v1/p/office/events', { withCredentials: true });
    sseRef.current = es;
    es.onopen  = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = () => {
      api.get<UserSnapshot[]>('/p/office/snapshot')
        .then(data => setUsers(data))
        .catch(() => {});
    };
    return () => { es.close(); setConnected(false); };
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function handleCheckIn() {
    setActionLoading(true);
    try {
      await api.post('/p/office/checkin');
      setIsCheckedIn(true);
      setMyStatus('AVAILABLE');
      await loadData();
    } finally { setActionLoading(false); }
  }

  async function handleCheckOut() {
    setActionLoading(true);
    try {
      await api.post('/p/office/checkout');
      setIsCheckedIn(false);
      setMyStatus('OFFLINE');
      await loadData();
    } finally { setActionLoading(false); }
  }

  async function handleStatusChange(status: string) {
    await api.patch('/p/office/presence/status', { status });
    setMyStatus(status);
    setUsers(prev => prev.map(u =>
      u.userId === currentUser?.id ? { ...u, status } : u
    ));
  }

  async function handleSaveAvatar(cfg: Partial<AvatarCfg>) {
    await api.patch('/p/office/me/avatar', cfg);
    setUsers(prev => prev.map(u =>
      u.userId === currentUser?.id
        ? { ...u, avatar: { skinColor:'#F5CBA7', hairStyle:'short', hairColor:'#2C2C2C', shirtColor:'#3498DB', accessory:'none', ...(u.avatar ?? {}), ...cfg } }
        : u
    ));
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const zones = layout?.zones ?? [];
  const gridW = zones.length ? Math.max(...zones.map(z => z.x + z.width))  : 40;
  const gridH = zones.length ? Math.max(...zones.map(z => z.y + z.height)) : 30;

  const zoneUsersMap = new Map<string, UserSnapshot[]>();
  for (const u of users) {
    const zoneId = u.currentZoneId ?? u.defaultZoneId;
    if (!zoneId) continue;
    if (!zoneUsersMap.has(zoneId)) zoneUsersMap.set(zoneId, []);
    zoneUsersMap.get(zoneId)!.push(u);
  }

  const myUser = users.find(u => u.userId === currentUser?.id);
  const onlineCount = users.filter(u => u.isCheckedIn).length;

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 rounded-full border-4 border-green-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">

      {showAvatarModal && (
        <AvatarModal
          current={myUser?.avatar ?? null}
          onSave={handleSaveAvatar}
          onClose={() => setShowAvatarModal(false)}
        />
      )}

      {showBitrixSettings && (
        <BitrixSettings onClose={() => setShowBitrixSettings(false)} />
      )}

      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-2.5 bg-white border-b border-gray-100">
        <div>
          <h1 className="text-sm font-bold text-gray-800">Oficina Virtual</h1>
          <p className="text-[11px] text-gray-400">
            {onlineCount > 0
              ? `${onlineCount} persona${onlineCount !== 1 ? 's' : ''} en la oficina ahora`
              : 'Nadie en la oficina'}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-gray-300'}`} />
            {connected ? 'En vivo' : 'Reconectando...'}
          </span>

          {/* Bitrix settings — admin only */}
          {currentUser?.role === 'ADMIN' && (
            <button
              onClick={() => setShowBitrixSettings(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] text-gray-500 hover:bg-gray-100 transition-colors"
              title="Configuración Bitrix24"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Bitrix24
            </button>
          )}

          {myUser && (
            <button
              onClick={() => setShowAvatarModal(true)}
              className="flex items-center gap-2 px-2 py-1 rounded-xl hover:bg-gray-100 transition-colors group"
              title="Personalizar avatar"
            >
              <AvatarSVG cfg={myUser.avatar} photoUrl={myUser.photoUrl} size={28} status={myStatus} />
              <svg className="w-3 h-3 text-gray-300 group-hover:text-gray-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          )}

          {isCheckedIn && (
            <StatusSelector current={myStatus} onChange={handleStatusChange} disabled={actionLoading} />
          )}

          <button
            onClick={isCheckedIn ? handleCheckOut : handleCheckIn}
            disabled={actionLoading}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 ${
              isCheckedIn
                ? 'bg-red-50 text-red-500 hover:bg-red-100'
                : 'bg-green-500 text-white hover:bg-green-600'
            }`}
          >
            {actionLoading
              ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : isCheckedIn
              ? <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Salir
                </>
              : <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                  Entrar a la oficina
                </>
            }
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Grid */}
        <div className="flex-1 overflow-auto p-5">
          {!layout ? (
            <div className="flex items-center justify-center h-full text-sm text-gray-400">
              No hay un layout de oficina configurado.
            </div>
          ) : (
            <div className="relative mx-auto" style={{ width: gridW * TILE, height: gridH * TILE, minWidth: gridW * TILE }}>
              {zones.map(zone => (
                <ZoneTile key={zone.id} zone={zone} users={zoneUsersMap.get(zone.id) ?? []} />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <Sidebar
          users={users}
          myUserId={currentUser?.id}
          onAvatarClick={() => setShowAvatarModal(true)}
        />
      </div>
    </div>
  );
}

export { AvatarSVG, HoverCard };
