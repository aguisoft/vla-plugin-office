# Responsive Design — vla-plugin-office Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer el plugin office responsivo — móvil usa lista de zonas + bottom action bar + drawer; tablet/desktop mantiene layout actual sin cambios.

**Architecture:** Tailwind breakpoints (`md:`) para mostrar/ocultar elementos según viewport. Estado React (`viewMode`, `isDrawerOpen`) para interacciones de toggle. 2 componentes nuevos (ZoneListView, MobileBottomBar), 3 modificados (StatusSelector, Sidebar, App).

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vite. Build: `cd frontend && npm run build` (`tsc && vite build`).

---

## File Map

| Archivo | Acción |
|---|---|
| `frontend/src/components/StatusSelector.tsx` | Modificar — agregar prop `dropUp` |
| `frontend/src/components/ZoneListView.tsx` | Crear — vista lista móvil |
| `frontend/src/components/MobileBottomBar.tsx` | Crear — barra inferior móvil |
| `frontend/src/components/Sidebar.tsx` | Modificar — drawer en móvil |
| `frontend/src/App.tsx` | Modificar — conectar todo, agregar estados, restructurar layout |

---

## Task 1: StatusSelector — prop `dropUp`

**Files:**
- Modify: `frontend/src/components/StatusSelector.tsx`

- [ ] **Step 1: Agregar prop `dropUp` y cambiar posición del dropdown**

Reemplazar el contenido completo de `frontend/src/components/StatusSelector.tsx`:

```tsx
import { useState } from 'react';
import { STATUS_CFG, STATUSES } from '../App';

export function StatusSelector({ current, onChange, disabled, dropUp }: {
  current: string;
  onChange: (s: string) => void;
  disabled: boolean;
  dropUp?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const st = STATUS_CFG[current] ?? STATUS_CFG['OFFLINE'];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors disabled:opacity-50"
      >
        <span className={`w-2 h-2 rounded-full ${st.dot}`} />
        <span className={`text-xs font-medium ${st.color}`}>{st.label}</span>
        <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className={`absolute ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'} right-0 w-44 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-40`}>
          {STATUSES.map(s => {
            const sc = STATUS_CFG[s];
            return (
              <button
                key={s}
                onClick={() => { onChange(s); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${current === s ? 'bg-gray-50 font-semibold' : ''}`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${sc.dot}`} />
                <span className={sc.color}>{sc.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd /mnt/ssd_extra/Users/Carlos/Documents/Projects/vlaSystem/vla-plugin-office/frontend && npx tsc --noEmit 2>&1 | head -30
```

Esperado: sin errores.

- [ ] **Step 3: Commit**

```bash
cd /mnt/ssd_extra/Users/Carlos/Documents/Projects/vlaSystem/vla-plugin-office && git add frontend/src/components/StatusSelector.tsx && git commit -m "feat(responsive): add dropUp prop to StatusSelector"
```

---

## Task 2: ZoneListView — componente nuevo

**Files:**
- Create: `frontend/src/components/ZoneListView.tsx`

- [ ] **Step 1: Crear ZoneListView.tsx**

```tsx
import { AvatarSVG } from './AvatarSVG';
import type { Zone, UserSnapshot } from '../types';

const STATUS_RING: Record<string, string> = {
  AVAILABLE:  '#4ade80',
  BUSY:       '#f87171',
  IN_MEETING: '#c084fc',
  FOCUS:      '#60a5fa',
  LUNCH:      '#fb923c',
  BRB:        '#facc15',
};

export function ZoneListView({ zones, zoneUsersMap, usePhotos }: {
  zones: Zone[];
  zoneUsersMap: Map<string, UserSnapshot[]>;
  usePhotos?: boolean;
}) {
  const zoneCards = zones
    .map(zone => ({
      zone,
      users: zoneUsersMap.get(zone.id) ?? [],
      online: (zoneUsersMap.get(zone.id) ?? []).filter(u => u.isCheckedIn),
    }))
    .sort((a, b) => b.online.length - a.online.length);

  return (
    <div className="flex flex-col gap-3 p-4">
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
                const ringColor = u.isCheckedIn ? (STATUS_RING[u.status] ?? '#4ade80') : undefined;
                return (
                  <div key={u.userId} className="flex flex-col items-center gap-0.5 flex-shrink-0" style={{ width: 44 }}>
                    <div className="relative flex-shrink-0" style={{ width: 36, height: 36 }}>
                      {u.isCheckedIn && ringColor && (
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
                          isCheckedIn={u.isCheckedIn}
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
    </div>
  );
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd /mnt/ssd_extra/Users/Carlos/Documents/Projects/vlaSystem/vla-plugin-office/frontend && npx tsc --noEmit 2>&1 | head -30
```

Esperado: sin errores.

- [ ] **Step 3: Commit**

```bash
cd /mnt/ssd_extra/Users/Carlos/Documents/Projects/vlaSystem/vla-plugin-office && git add frontend/src/components/ZoneListView.tsx && git commit -m "feat(responsive): add ZoneListView component for mobile"
```

---

## Task 3: MobileBottomBar — componente nuevo

**Files:**
- Create: `frontend/src/components/MobileBottomBar.tsx`

- [ ] **Step 1: Crear MobileBottomBar.tsx**

```tsx
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
        {isCheckedIn ? (
          <StatusSelector
            current={myStatus}
            onChange={onStatusChange}
            disabled={actionLoading}
            dropUp
          />
        ) : (
          <div className="w-10" />
        )}
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
        className="flex-1 flex flex-col items-center gap-0.5 px-2 py-1 rounded-xl hover:bg-gray-50 transition-colors"
      >
        <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="text-[9px] text-gray-400">Personas</span>
      </button>

      {/* Avatar / Yo */}
      <button
        onClick={onOpenAvatar}
        className="flex-1 flex flex-col items-center gap-0.5 px-2 py-1 rounded-xl hover:bg-gray-50 transition-colors"
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
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd /mnt/ssd_extra/Users/Carlos/Documents/Projects/vlaSystem/vla-plugin-office/frontend && npx tsc --noEmit 2>&1 | head -30
```

Esperado: sin errores.

- [ ] **Step 3: Commit**

```bash
cd /mnt/ssd_extra/Users/Carlos/Documents/Projects/vlaSystem/vla-plugin-office && git add frontend/src/components/MobileBottomBar.tsx && git commit -m "feat(responsive): add MobileBottomBar component"
```

---

## Task 4: Sidebar — drawer en móvil

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`

- [ ] **Step 1: Reemplazar Sidebar.tsx con versión que soporta drawer**

Reemplazar contenido completo de `frontend/src/components/Sidebar.tsx`:

```tsx
import { AvatarSVG } from './AvatarSVG';
import { STATUS_CFG } from '../App';
import type { UserSnapshot } from '../types';

export function Sidebar({ users, myUserId, onAvatarClick, isOpen, onClose }: {
  users: UserSnapshot[];
  myUserId?: string;
  onAvatarClick: () => void;
  isOpen: boolean;
  onClose: () => void;
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
          <AvatarSVG cfg={u.avatar} photoUrl={u.photoUrl} useInitials size={34} status={u.status} isCheckedIn={u.isCheckedIn} name={`${u.firstName} ${u.lastName}`} />
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

  const listContent = (
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
  );

  return (
    <>
      {/* Móvil: drawer overlay */}
      {isOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={onClose} />
          <div className="relative w-72 max-w-full bg-white flex flex-col shadow-xl">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                Oficina · <span className="text-green-500">{online.length} en línea</span>
              </p>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {listContent}
          </div>
        </div>
      )}

      {/* Desktop: sidebar fijo */}
      <div className="hidden md:flex w-56 flex-shrink-0 flex-col border-l border-gray-100 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
            Oficina · <span className="text-green-500">{online.length} en línea</span>
          </p>
        </div>
        {listContent}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd /mnt/ssd_extra/Users/Carlos/Documents/Projects/vlaSystem/vla-plugin-office/frontend && npx tsc --noEmit 2>&1 | head -30
```

Esperado: error en App.tsx porque `<Sidebar>` no recibe `isOpen`/`onClose` aún — eso se resuelve en Task 5.

- [ ] **Step 3: Commit**

```bash
cd /mnt/ssd_extra/Users/Carlos/Documents/Projects/vlaSystem/vla-plugin-office && git add frontend/src/components/Sidebar.tsx && git commit -m "feat(responsive): Sidebar supports mobile drawer overlay"
```

---

## Task 5: App.tsx — conectar todo

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Agregar imports nuevos**

Al inicio de `frontend/src/App.tsx`, después de la línea `import { Sidebar } from './components/Sidebar';`, agregar:

```tsx
import { MobileBottomBar } from './components/MobileBottomBar';
import { ZoneListView } from './components/ZoneListView';
```

- [ ] **Step 2: Agregar estados nuevos**

Dentro de `export default function App()`, después de la línea:
```tsx
const sseRef = useRef<EventSource | null>(null);
```

Agregar:
```tsx
  const [viewMode, setViewMode]       = useState<'list' | 'map'>('list');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
```

- [ ] **Step 3: Envolver officeActions en hidden md:flex**

Localizar la definición de `officeActions` (línea ~199):
```tsx
  const officeActions = (
    <>
```

Reemplazar solo las etiquetas de apertura y cierre del fragmento:
```tsx
  const officeActions = (
    <div className="hidden md:flex items-center gap-2">
```
y cambiar el `</>` de cierre por `</div>`.

El contenido interno (los botones y spans) no cambia.

- [ ] **Step 4: Reemplazar el bloque de return principal**

Localizar el `return (` final (después de los modals). Reemplazar desde `<PluginShell` hasta el cierre `</>` con:

```tsx
  return (
    <>
      {showAvatarModal && (
        <AvatarModal current={myUser?.avatar ?? null} onSave={handleSaveAvatar} onClose={() => setShowAvatarModal(false)} />
      )}
      {showBitrixSettings && (
        <BitrixSettings onClose={() => setShowBitrixSettings(false)} />
      )}

      <PluginShell title="Oficina Virtual" subtitle={officeSubtitle} headerActions={officeActions} user={officeUser}>
        <div className="h-full flex flex-col">
          <div className="flex-1 flex overflow-hidden">
            {/* Grid */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Filter bar */}
              <div className="flex-shrink-0 flex items-center gap-1.5 px-5 py-2 bg-white border-b border-gray-100 overflow-x-auto">
                {([
                  { key: 'ALL',    label: 'Todos',         dot: 'bg-gray-300',   count: users.length },
                  { key: 'ONLINE', label: 'En oficina',    dot: 'bg-green-400',  count: users.filter(u => u.isCheckedIn).length },
                  ...STATUSES.map(s => ({
                    key: s,
                    label: STATUS_CFG[s].label,
                    dot: STATUS_CFG[s].dot,
                    count: users.filter(u => u.isCheckedIn && u.status === s).length,
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
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    viewMode === 'list' ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  ≡ Lista
                </button>
                <button
                  onClick={() => setViewMode('map')}
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
                    <ZoneListView zones={zones} zoneUsersMap={zoneUsersMap} usePhotos={usePhotos} />
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
            onStatusChange={handleStatusChange}
            onOpenDrawer={() => setIsDrawerOpen(true)}
            onOpenAvatar={() => setShowAvatarModal(true)}
          />
        </div>
      </PluginShell>
    </>
  );
```

- [ ] **Step 5: Verificar TypeScript sin errores**

```bash
cd /mnt/ssd_extra/Users/Carlos/Documents/Projects/vlaSystem/vla-plugin-office/frontend && npx tsc --noEmit 2>&1 | head -40
```

Esperado: 0 errores.

- [ ] **Step 6: Commit**

```bash
cd /mnt/ssd_extra/Users/Carlos/Documents/Projects/vlaSystem/vla-plugin-office && git add frontend/src/App.tsx && git commit -m "feat(responsive): wire mobile layout — ZoneListView, MobileBottomBar, drawer state"
```

---

## Task 6: Build final y verificación

**Files:** ninguno — solo build + pack

- [ ] **Step 1: Build completo**

```bash
cd /mnt/ssd_extra/Users/Carlos/Documents/Projects/vlaSystem/vla-plugin-office/frontend && npm run build 2>&1 | tail -20
```

Esperado: `✓ built in Xs` sin errores.

- [ ] **Step 2: Re-empaquetar el plugin**

```bash
cd /mnt/ssd_extra/Users/Carlos/Documents/Projects/vlaSystem/vla-plugin-office && node scripts/pack.js 2>&1
```

Esperado: genera `office-*.vla.zip`.

- [ ] **Step 3: Commit build + zip**

```bash
cd /mnt/ssd_extra/Users/Carlos/Documents/Projects/vlaSystem/vla-plugin-office && git add frontend/dist/ office-*.vla.zip && git commit -m "build: rebuild office plugin with responsive layout"
```
