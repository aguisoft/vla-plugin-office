# Responsive Design — vla-plugin-office

**Fecha:** 2026-04-17
**Enfoque:** C — Tailwind breakpoints para estructura + estado React para toggle lista/mapa

---

## Breakpoints

| Rango | Layout |
|---|---|
| `< 768px` (móvil) | Header compacto · lista de zonas · bottom action bar · drawer |
| `≥ 768px` (tablet/desktop) | Layout actual sin cambios (mapa + sidebar fijo) |

---

## Componentes nuevos

### `MobileBottomBar.tsx`
Barra fija en la parte inferior, solo visible en móvil (`md:hidden`).

**Props:**
```typescript
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
```

**Acciones (izquierda → derecha):**
1. `Estado` — abre `<StatusSelector>` con dropdown hacia arriba (`bottom-full`)
2. `Entrar / Salir` — botón check-in/out principal
3. `Personas` — abre Sidebar como drawer (`setIsDrawerOpen(true)`)
4. `Yo` — abre AvatarModal

**iOS safe area:** `padding-bottom: env(safe-area-inset-bottom)` para notch.

---

### `ZoneListView.tsx`
Vista lista del mapa para móvil. Mismas props que el grid actual.

**Props:**
```typescript
interface ZoneListViewProps {
  zones: Zone[];
  zoneUsersMap: Map<string, UserSnapshot[]>;
  usePhotos: boolean;
}
```

**Comportamiento:**
- Cada zona = card con nombre + badge de ocupantes online + fila de avatares (`AvatarSVG`)
- Zonas vacías se muestran con opacidad reducida al final
- Sin hover cards (no aplica en táctil)
- Avatares con mismo ring de color de status que en `ZoneTile`

---

## Archivos modificados

### `App.tsx`

**Estado nuevo:**
```typescript
const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
const [isDrawerOpen, setIsDrawerOpen] = useState(false);
```

**Cambios:**
- `officeActions` envuelto en `<div className="hidden md:flex items-center gap-2">` — se oculta en móvil
- Toggle lista/mapa visible solo en móvil (`md:hidden`): 2 botones pill `Lista | Mapa`
- Contenido principal: `viewMode === 'list' ? <ZoneListView> : <grid>` en móvil; grid siempre en desktop
- `<Sidebar>` recibe `isOpen={isDrawerOpen}` y `onClose={() => setIsDrawerOpen(false)}`
- `<MobileBottomBar>` como último hijo dentro de PluginShell, con `md:hidden`
- Estructura hija en PluginShell: `h-full flex flex-col` con `flex-1` en área principal y `flex-shrink-0` en bottom bar

### `Sidebar.tsx`

**Props nuevas:**
```typescript
isOpen: boolean;
onClose: () => void;
```

**Comportamiento:**
- Móvil (`md:hidden` en versión estática): `fixed inset-0 z-50`
  - Overlay oscuro semi-transparente (`bg-black/40`) con `onClick={onClose}`
  - Panel deslizante desde la derecha (`translate-x-full` → `translate-x-0` con transición)
  - Botón X para cerrar
- Desktop: comportamiento actual sin cambios (clases `hidden md:flex` en el contenedor estático)

### `StatusSelector.tsx`

**Cambio:** el dropdown abre hacia arriba cuando hay poco espacio inferior.
- Agrega prop opcional `dropUp?: boolean`
- En `MobileBottomBar` se pasa `dropUp={true}` → dropdown usa `bottom-full mb-1` en lugar de `top-full mt-1`

---

## Flujo de datos

```
App.tsx
  ├── viewMode / setViewMode  ──→  ZoneListView (móvil) | grid (desktop/toggle)
  ├── isDrawerOpen / setIsDrawerOpen  ──→  Sidebar (isOpen, onClose)
  └── MobileBottomBar
        ├── onOpenDrawer  ──→  setIsDrawerOpen(true)
        ├── onStatusChange  ──→  handleStatusChange (existente)
        ├── onCheckIn/Out  ──→  handleCheckIn/Out (existente)
        └── onOpenAvatar  ──→  setShowAvatarModal(true)
```

---

## Casos borde

| Caso | Solución |
|---|---|
| Drawer abierto + tap fuera | Overlay `onClick={onClose}` |
| StatusSelector en bottom bar | `dropUp={true}` → dropdown hacia arriba |
| iOS notch | `env(safe-area-inset-bottom)` en MobileBottomBar |
| HoverCard en lista | No aplica — ZoneListView no usa ZoneTile |
| Filtros en móvil | Filter bar existente mantiene `overflow-x-auto` |
| Admin Bitrix24 en móvil | Botón ⚙️ dentro del drawer o menú del avatar (fuera de scope inicial) |

---

## Archivos tocados (resumen)

| Archivo | Acción |
|---|---|
| `src/components/MobileBottomBar.tsx` | Nuevo |
| `src/components/ZoneListView.tsx` | Nuevo |
| `src/App.tsx` | Modificado |
| `src/components/Sidebar.tsx` | Modificado |
| `src/components/StatusSelector.tsx` | Modificado (prop `dropUp`) |
