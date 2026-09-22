import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from './vla/api';
import { PluginShell } from './vla/PluginShell';
import { AvatarSVG } from './components/AvatarSVG';
import { HoverCard } from './components/HoverCard';
import { ZoneTile } from './components/ZoneTile';
import { AvatarModal } from './components/AvatarModal';
import { StatusSelector } from './components/StatusSelector';
import { Sidebar } from './components/Sidebar';
import { BitrixSettings } from './components/BitrixSettings';
import { MobileBottomBar } from './components/MobileBottomBar';
import { ZoneListView } from './components/ZoneListView';
import { JustificationModal } from './components/JustificationModal';
import { TimeRangeModal } from './components/TimeRangeModal';
import { DateRangeModal } from './components/DateRangeModal';
import { PermisoModal } from './components/PermisoModal';
import { ParticipantPicker } from './components/ParticipantPicker';
import { MeetingInviteModal } from './components/MeetingInviteModal';
import { HolidayOverrideModal } from './components/HolidayOverrideModal';
import { MyAbsencesModal } from './components/MyAbsencesModal';
import { HolidayManager } from './components/HolidayManager';
import { TimesheetScreen } from './components/TimesheetScreen';
import { Shell } from './components/modalParts';
import type { UserSnapshot, LayoutData, AvatarCfg, UnavailableParticipant, PendingInvite } from './types';
import { SELECTABLE, STATUS_CFG, cfgOf } from './statusConfig';
import type { ResolvedStatus, PayloadKind } from './statusConfig';
import { setStatus, createAbsence, listInvites, respondInvite, setHolidayOverride, ApiError } from './api';
import type { StatusPayload, StatusError } from './api';
import { fmtDate, fmtDateOnly, fmtTime, absenceLastDay } from './format';

export const TILE = 20;

type PendingPick = { status: ResolvedStatus; kind: PayloadKind } | null;

export default function App() {
  const configMode = new URLSearchParams(window.location.search).get('config') === 'true';

  // Vista dentro de la SPA de Office: 'tiempos' reemplaza al mapa (no es un
  // modal, ver TimesheetScreen). Se lee del query param al montar para que
  // /dashboard/office?view=tiempos abra directo ahí -- eso reemplaza a la
  // "ruta propia en el menú" que pedía la spec original, no alcanzable
  // porque un plugin declara una sola `route`.
  const [view, setView] = useState<'oficina' | 'tiempos'>(
    new URLSearchParams(window.location.search).get('view') === 'tiempos' ? 'tiempos' : 'oficina',
  );
  const irA = (v: 'oficina' | 'tiempos') => {
    setView(v);
    const url = new URL(window.location.href);
    if (v === 'tiempos') url.searchParams.set('view', 'tiempos');
    else url.searchParams.delete('view');
    window.history.replaceState({}, '', url);
  };

  const [currentUser, setCurrentUser]     = useState<{ id: string; role: string; permissions: string[] } | null>(null);
  const [layout, setLayout]               = useState<LayoutData | null>(null);
  const [users, setUsers]                 = useState<UserSnapshot[]>([]);
  const [loading, setLoading]             = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [connected, setConnected]         = useState(false);
  const [isCheckedIn, setIsCheckedIn]     = useState(false);
  const [myStatus, setMyStatus]           = useState('OFFLINE');
  const [showAvatarModal, setShowAvatarModal]       = useState(false);
  const [showBitrixSettings, setShowBitrixSettings] = useState(false);
  const [showHolidayAdmin, setShowHolidayAdmin]     = useState(false);
  const [showAbsences, setShowAbsences]             = useState(false);
  const [usePhotos, setUsePhotos] = useState(() => localStorage.getItem('vla-use-photos') !== 'false');
  const sseRef = useRef<EventSource | null>(null);
  const [viewMode, setViewMode]         = useState<'list' | 'map'>('list');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [pending, setPending]           = useState<PendingPick>(null);
  const [notice, setNotice]             = useState<string | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const [blockedParticipants, setBlockedParticipants] = useState<UnavailableParticipant[] | null>(null);
  const [invites, setInvites]           = useState<PendingInvite[]>([]);

  // ── Bootstrap: get current user then load data ─────────────────────────────

  useEffect(() => {
    api.get<{ id: string; role: string; permissions: string[] }>('/auth/me')
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
    es.onopen  = () => { setConnected(true); loadData(); };
    es.onerror = () => setConnected(false);
    es.onmessage = (event) => {
      api.get<UserSnapshot[]>('/p/office/snapshot')
        .then(data => setUsers(data))
        .catch(() => {});

      // Eventos dirigidos de reunión. El refresh de arriba ya corrió para
      // cualquier mensaje, así que un `msg.type` no reconocido (o el mensaje
      // no siendo JSON parseable) no pierde nada más que estas dos ramas.
      try {
        const msg = JSON.parse(event.data) as { type?: string; meetingId?: string };
        if (msg.type === 'meeting:invite') {
          void listInvites().then(setInvites).catch(() => {});
        }
        if (msg.type === 'meeting:cancelled') {
          setInvites(prev => prev.filter(i => i.meetingId !== msg.meetingId));
          void loadData();
        }
      } catch { /* mensaje no parseable: nada más que hacer */ }
    };
    return () => { es.close(); setConnected(false); };
  }, [loadData]);

  // ── Invitaciones a reunión ───────────────────────────────────────────────

  // Se cargan también al montar, por si el usuario recargó la página con una
  // invitación viva: el SSE de arriba solo entrega eventos nuevos.
  useEffect(() => { void listInvites().then(setInvites).catch(() => {}); }, []);

  async function handleRespond(id: string, action: 'accept' | 'decline') {
    try {
      await respondInvite(id, action);
      // Si acepté, mi propio estado pasa a IN_MEETING_INTERNAL en el backend;
      // recargar es lo que refleja eso en `myStatus` para esta sesión.
      await loadData();
    } catch (e) {
      const detail = e instanceof ApiError ? (e.detail as { message?: string } | undefined) : undefined;
      setError(detail?.message ?? 'No se pudo responder la invitación');
    } finally {
      setInvites(prev => prev.filter(i => i.id !== id));
    }
  }

  // ── Visibility: re-sync when user returns to tab ─────────────────────────

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') loadData();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [loadData]);

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

  const applyStatus = async (payload: StatusPayload) => {
    setActionLoading(true);
    try {
      await setStatus(payload);
      await loadData();
    } catch (e) {
      // La lista de ausentes se muestra como alerta clara, no como error genérico.
      const detail = e instanceof ApiError ? (e.detail as StatusError | undefined) : undefined;
      if (detail?.unavailable?.length) {
        setBlockedParticipants(detail.unavailable);
      } else {
        setError(detail?.errors?.[0]?.message ?? detail?.message ?? 'No se pudo cambiar el estado');
      }
    } finally {
      setActionLoading(false);
      setPending(null);
    }
  };

  const handlePick = (status: ResolvedStatus) => {
    const kind = STATUS_CFG[status].payload;
    if (kind === 'none') { void applyStatus({ status }); return; }
    setPending({ status, kind });
  };

  // El contrato de POST /absences difiere por tipo (ver AbsenceInput en
  // absence-validation.ts, lado servidor): PERMISO manda `startAt`/`endAt`
  // como instantes reales (ISO datetime); VACACIONES/INCAPACIDAD mandan
  // fecha PURA "YYYY-MM-DD" -- sin hora, sin `new Date()`/`toISOString()`
  // de por medio (ver DateRangeModal.tsx). Por eso acá abajo la fecha de un
  // permiso se lee con fmtDate (instante) y la de los otros dos con
  // fmtDateOnly (fecha pura) -- son formatos de entrada distintos, no
  // intercambiables.
  const applyAbsence = async (body: { type: string; startAt: string; endAt: string; justification?: string }) => {
    setActionLoading(true);
    try {
      await createAbsence(body);
      await loadData();
      // El selector hace dos cosas: los estados del día se aplican ya, las
      // ausencias se agendan. Si empieza después de hoy el avatar no cambia
      // todavía, así que hay que decirlo o la persona se queda esperando. Un
      // permiso puede agendarse para más tarde el mismo día -- ahí fmtDate
      // solo muestra la misma fecha dos veces y no dice desde cuándo aplica,
      // así que ese caso además necesita la hora.
      const label = cfgOf(body.type).label;
      const isPermiso = body.type === 'PERMISO';
      const starts = new Date(body.startAt);
      const startsLater = starts > new Date();
      const schedule = isPermiso
        ? `el ${fmtDate(body.startAt)} de ${fmtTime(body.startAt)} a ${fmtTime(body.endAt)}`
        : `del ${fmtDateOnly(body.startAt)} al ${fmtDateOnly(body.endAt)}`;
      // Concordancia del participio con el tipo: "Permiso" es masculino
      // singular, "Vacaciones" femenino PLURAL, "Incapacidad" femenino
      // singular. El ternario isPermiso ? x : y solo distinguía dos casos y
      // le pegaba el mismo femenino singular a VACACIONES -- "Vacaciones
      // registrada" en vez de "registradas".
      const agree = (masc: string) => {
        if (isPermiso) return masc;
        const fem = `${masc.slice(0, -1)}a`;
        return body.type === 'VACACIONES' ? `${fem}s` : fem;
      };
      setNotice(startsLater
        ? `${label} ${agree('registrado')} ${schedule}`
        : `${label} ${agree('aplicado')}`);
    } catch (e) {
      const detail = e instanceof ApiError ? (e.detail as StatusError | undefined) : undefined;
      setError(detail?.errors?.[0]?.message ?? detail?.message ?? 'No se pudo registrar la ausencia');
    } finally {
      setActionLoading(false);
      setPending(null);
    }
  };

  const applyHolidayOverride = async (holidayId: string, newDate: string, justification: string) => {
    setActionLoading(true);
    try {
      await setHolidayOverride(holidayId, { newDate, justification });
      await loadData();
      // newDate es el "YYYY-MM-DD" crudo del <input type="date"> de
      // HolidayOverrideModal, sin hora ni zona -- fmtDate lo leería como
      // medianoche UTC y nombraría el día anterior en Costa Rica.
      setNotice(`Feriado movido al ${fmtDateOnly(newDate)}`);
    } catch (e) {
      // Mismo patrón que applyAbsence: el 400 de mes-distinto ya lo frena el
      // DateField (min/max), así que lo que llega acá suele ser un choque de
      // concurrencia (alguien más lo movió primero) o un error genérico.
      const detail = e instanceof ApiError ? (e.detail as StatusError | undefined) : undefined;
      setError(detail?.errors?.[0]?.message ?? detail?.message ?? 'No se pudo mover el feriado');
    } finally {
      setActionLoading(false);
      setPending(null);
    }
  };

  const renderPendingModal = () => {
    if (!pending) return null;
    switch (pending.kind) {
      case 'justification':
        return (
          <JustificationModal
            status={pending.status}
            onClose={() => setPending(null)}
            onConfirm={justification => applyStatus({ status: pending.status, justification })}
          />
        );
      case 'timeRange':
        return (
          <TimeRangeModal
            onClose={() => setPending(null)}
            onConfirm={(startsAt, endsAt) => applyStatus({ status: pending.status, startsAt, endsAt })}
          />
        );
      case 'dateRange':
        return (
          <DateRangeModal
            status={pending.status}
            onClose={() => setPending(null)}
            onConfirm={(startAt, endAt, justification) =>
              applyAbsence({ type: pending.status, startAt, endAt, justification })}
          />
        );
      case 'permiso':
        return (
          <PermisoModal
            onClose={() => setPending(null)}
            onConfirm={(startAt, endAt, justification) =>
              applyAbsence({ type: pending.status, startAt, endAt, justification })}
          />
        );
      case 'participants':
        return (
          <ParticipantPicker
            users={users}
            currentUserId={currentUser?.id ?? ''}
            onClose={() => setPending(null)}
            onConfirm={(ids, justification) =>
              applyStatus({ status: pending.status, justification, participantIds: ids })}
          />
        );
      case 'holidayOverride':
        return (
          <HolidayOverrideModal
            onClose={() => setPending(null)}
            onConfirm={applyHolidayOverride}
          />
        );
      default:
        return null;
    }
  };

  async function handleSaveAvatar(cfg: Partial<AvatarCfg>) {
    await api.patch('/p/office/me/avatar', cfg);
    setUsers(prev => prev.map(u =>
      u.userId === currentUser?.id
        ? { ...u, avatar: { skinColor:'#F5CBA7', hairStyle:'short', hairColor:'#2C2C2C', shirtColor:'#3498DB', accessory:'none', ...(u.avatar ?? {}), ...cfg } }
        : u
    ));
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const zones = layout?.zones ?? [];
  const gridW = zones.length ? Math.max(...zones.map(z => z.x + z.width))  : 40;
  const gridH = zones.length ? Math.max(...zones.map(z => z.y + z.height)) : 30;

  const filteredUsers = users.filter(u => {
    if (statusFilter === 'ALL')    return true;
    if (statusFilter === 'ONLINE') return u.isCheckedIn;
    // Un ausente no está isCheckedIn pero sí tiene un estado resuelto (VACACIONES,
    // PERMISO...): sin isAbsent acá, el filtro por ese estado nunca devuelve a nadie.
    return u.status === statusFilter && (u.isCheckedIn || u.isAbsent);
  });

  const zoneUsersMap = new Map<string, UserSnapshot[]>();
  for (const u of filteredUsers) {
    const zoneId = u.currentZoneId ?? u.defaultZoneId;
    if (!zoneId) continue;
    if (!zoneUsersMap.has(zoneId)) zoneUsersMap.set(zoneId, []);
    zoneUsersMap.get(zoneId)!.push(u);
  }

  const myUser = users.find(u => u.userId === currentUser?.id);
  const onlineCount = users.filter(u => u.isCheckedIn).length;

  if (loading && !configMode) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 rounded-full border-4 border-green-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  // Config mode — render only Bitrix settings
  if (configMode) {
    return (
      <div className="h-full flex flex-col bg-gray-50 overflow-auto">
        <div className="flex-shrink-0 px-5 py-3 bg-white border-b border-gray-100 flex items-center gap-2">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-[13px] font-bold text-gray-700">Configuración de Oficina Virtual</p>
        </div>
        <div className="flex-1 p-6">
          <BitrixSettings onClose={() => {}} embedded />
        </div>
      </div>
    );
  }

  const officeSubtitle = onlineCount > 0
    ? `${onlineCount} persona${onlineCount !== 1 ? 's' : ''} en la oficina ahora`
    : 'Nadie en la oficina';

  const officeUser = { id: currentUser?.id ?? '', firstName: myUser?.firstName ?? '', lastName: myUser?.lastName ?? '', role: currentUser?.role ?? '', email: '', permissions: [] };

  // Gating de `office.manage`, no de rol: a diferencia del botón de Bitrix24
  // (que solo mira `role === 'ADMIN'`), el calendario de feriados lo puede
  // administrar cualquier rol al que se le haya otorgado el permiso.
  const canManageHolidays = currentUser?.permissions?.includes('office.manage') ?? false;

  const officeActions = (
    <div className="hidden md:flex items-center gap-2">
      <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-gray-300'}`} />
        {connected ? 'En vivo' : 'Reconectando...'}
      </span>

      {currentUser?.role === 'ADMIN' && (
        <button onClick={() => setShowBitrixSettings(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] text-gray-500 hover:bg-gray-100 transition-colors"
          title="Configuración Bitrix24">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Bitrix24
        </button>
      )}

      {canManageHolidays && (
        <button onClick={() => setShowHolidayAdmin(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] text-gray-500 hover:bg-gray-100 transition-colors"
          title="Administrar feriados">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Feriados
        </button>
      )}

      {/* Sin gating por office.manage: es un reporte de lo propio, cualquiera
          lo puede ver (y quien tenga gente a cargo, también lo suyo). */}
      <button onClick={() => irA('tiempos')}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] text-gray-500 hover:bg-gray-100 transition-colors"
        title="Tiempos">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Tiempos
      </button>

      {myUser && (
        <button onClick={() => setShowAvatarModal(true)}
          className="flex items-center gap-2 px-2 py-1 rounded-xl hover:bg-gray-100 transition-colors group"
          title="Personalizar avatar">
          <AvatarSVG cfg={myUser.avatar} photoUrl={myUser.photoUrl} size={28} status={myStatus} name={`${myUser.firstName} ${myUser.lastName}`} />
          <svg className="w-3 h-3 text-gray-300 group-hover:text-gray-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
      )}

      {isCheckedIn && (
        <StatusSelector
          current={myStatus}
          onPick={handlePick}
          onManageAbsences={() => setShowAbsences(true)}
          disabled={actionLoading}
        />
      )}

      <button onClick={isCheckedIn ? handleCheckOut : handleCheckIn} disabled={actionLoading}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 ${
          isCheckedIn ? 'bg-red-50 text-red-500 hover:bg-red-100' : 'bg-green-500 text-white hover:bg-green-600'
        }`}>
        {actionLoading
          ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          : isCheckedIn
          ? <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>Salir</>
          : <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg>Entrar a la oficina</>
        }
      </button>
    </div>
  );

  return (
    <>
      {showAvatarModal && (
        <AvatarModal current={myUser?.avatar ?? null} onSave={handleSaveAvatar} onClose={() => setShowAvatarModal(false)} />
      )}
      {showBitrixSettings && (
        <BitrixSettings onClose={() => setShowBitrixSettings(false)} />
      )}
      {showHolidayAdmin && canManageHolidays && (
        <HolidayManager onClose={() => setShowHolidayAdmin(false)} />
      )}
      {showAbsences && (
        <MyAbsencesModal onClose={() => setShowAbsences(false)} onChanged={() => void loadData()} />
      )}
      {renderPendingModal()}

      {invites[0] && (
        <MeetingInviteModal invite={invites[0]} onRespond={handleRespond} />
      )}

      {blockedParticipants && (
        <Shell title="No se puede invitar a esas personas" onClose={() => setBlockedParticipants(null)}>
          <ul className="space-y-1.5 text-xs text-gray-700">
            {blockedParticipants.map(p => (
              <li key={p.userId} className="flex items-center gap-2">
                <span>{cfgOf(p.reason).icon}</span>
                <span className="font-medium">{p.name}</span>
                <span className={cfgOf(p.reason).text}>
                  {cfgOf(p.reason).label}{p.until && ` hasta ${absenceLastDay(p.until)}`}
                </span>
              </li>
            ))}
          </ul>
        </Shell>
      )}

      {notice && (
        <div className="fixed top-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-gray-800 px-4 py-2 text-xs font-medium text-white shadow-lg">
          {notice}
          <button onClick={() => setNotice(null)} className="text-gray-400 hover:text-white">✕</button>
        </div>
      )}
      {error && (
        <div className="fixed top-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-red-500 px-4 py-2 text-xs font-medium text-white shadow-lg">
          {error}
          <button onClick={() => setError(null)} className="text-red-100 hover:text-white">✕</button>
        </div>
      )}

      <PluginShell title="Oficina Virtual" subtitle={officeSubtitle} headerActions={officeActions} user={officeUser}>
        {/* Reemplaza al mapa, no se superpone: es una vista que se consulta,
            no un diálogo. Vive dentro del mismo PluginShell. */}
        {view === 'tiempos' ? (
          <TimesheetScreen onClose={() => irA('oficina')} />
        ) : (
        <div className="h-full flex flex-col">
          <div className="flex-1 flex overflow-hidden">
            {/* Grid */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Filter bar */}
              <div className="flex-shrink-0 flex items-center gap-1.5 px-5 py-2 bg-white border-b border-gray-100 overflow-x-auto">
                {([
                  { key: 'ALL',    label: 'Todos',         dot: 'bg-gray-300',   count: users.length },
                  { key: 'ONLINE', label: 'En oficina',    dot: 'bg-green-400',  count: users.filter(u => u.isCheckedIn).length },
                  ...SELECTABLE.map(s => ({
                    key: s,
                    label: cfgOf(s).label,
                    dot: cfgOf(s).dot,
                    // Mismo motivo que en filteredUsers: un chip de ausencia (VACACIONES...)
                    // debe contar a quien está en ese estado aunque isCheckedIn sea false.
                    count: users.filter(u => (u.isCheckedIn || u.isAbsent) && u.status === s).length,
                  })).filter(f => f.count > 0),
                ] as { key: string; label: string; dot: string; count: number }[]).map(f => (
                  <button
                    key={f.key}
                    onClick={() => setStatusFilter(f.key)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold whitespace-nowrap transition-all ${
                      statusFilter === f.key
                        ? 'bg-gray-800 text-white'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${f.dot}`} />
                    {f.label}
                    <span className={`text-[9px] font-bold ${statusFilter === f.key ? 'text-gray-300' : 'text-gray-400'}`}>
                      {f.count}
                    </span>
                  </button>
                ))}

                {/* Photo toggle */}
                <button
                  onClick={() => {
                    const next = !usePhotos;
                    setUsePhotos(next);
                    localStorage.setItem('vla-use-photos', String(next));
                  }}
                  title={usePhotos ? 'Mostrando fotos — clic para usar avatares' : 'Mostrando avatares — clic para usar fotos'}
                  className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold whitespace-nowrap transition-all ${
                    usePhotos ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                  }`}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {usePhotos ? 'Fotos' : 'Avatares'}
                </button>
              </div>

              {/* Toggle lista/mapa — solo móvil */}
              <div className="md:hidden flex-shrink-0 flex gap-1.5 px-4 py-2 bg-gray-50 border-b border-gray-100">
                <button
                  onClick={() => setViewMode('list')}
                  aria-label="Vista lista"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    viewMode === 'list' ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  ≡ Lista
                </button>
                <button
                  onClick={() => setViewMode('map')}
                  aria-label="Vista mapa"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    viewMode === 'map' ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  ⊞ Mapa
                </button>
              </div>

              <div className="flex-1 overflow-auto">
                {/* Vista lista — solo móvil, solo cuando viewMode === 'list' */}
                <div className={`md:hidden ${viewMode === 'map' ? 'hidden' : ''}`}>
                  {!layout ? (
                    <div className="flex items-center justify-center h-32 text-sm text-gray-400">
                      No hay un layout de oficina configurado.
                    </div>
                  ) : (
                    <ZoneListView zones={zones} zoneUsersMap={zoneUsersMap} usePhotos={usePhotos} active={viewMode === 'list'} />
                  )}
                </div>

                {/* Vista mapa — siempre en desktop, condicional en móvil */}
                <div className={`${viewMode === 'list' ? 'hidden md:block' : ''} p-5 h-full`}>
                  {!layout ? (
                    <div className="flex items-center justify-center h-full text-sm text-gray-400">
                      No hay un layout de oficina configurado.
                    </div>
                  ) : (
                    <div className="relative mx-auto" style={{ width: gridW * TILE, height: gridH * TILE, minWidth: gridW * TILE }}>
                      {zones.map(zone => (
                        <ZoneTile key={zone.id} zone={zone} users={zoneUsersMap.get(zone.id) ?? []} usePhotos={usePhotos} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <Sidebar
              users={users}
              myUserId={currentUser?.id}
              onAvatarClick={() => setShowAvatarModal(true)}
              isOpen={isDrawerOpen}
              onClose={() => setIsDrawerOpen(false)}
            />
          </div>

          {/* Barra inferior móvil */}
          <MobileBottomBar
            isCheckedIn={isCheckedIn}
            myStatus={myStatus}
            myUser={myUser}
            actionLoading={actionLoading}
            onCheckIn={handleCheckIn}
            onCheckOut={handleCheckOut}
            onPick={handlePick}
            onManageAbsences={() => setShowAbsences(true)}
            onOpenDrawer={() => setIsDrawerOpen(true)}
            onOpenAvatar={() => setShowAvatarModal(true)}
          />
        </div>
        )}
      </PluginShell>
    </>
  );
}

export { AvatarSVG, HoverCard };
