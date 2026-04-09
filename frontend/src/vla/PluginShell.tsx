import type { ReactNode } from 'react';
import type { PluginUser } from './usePluginAuth';

interface PluginShellProps {
  /** Plugin title shown in the header */
  title: string;
  /** Optional subtitle/description under the title */
  subtitle?: string;
  /** Content rendered in the header between title and user info */
  headerCenter?: ReactNode;
  /** Buttons/controls rendered on the right side of the header (before user info) */
  headerActions?: ReactNode;
  /** Current authenticated user (from usePluginAuth) */
  user: PluginUser;
  /** Main content */
  children: ReactNode;
}

/**
 * Standard VLA plugin shell — provides a consistent header and layout
 * matching the core design system. All plugins should wrap their UI with this.
 *
 * @example
 * <PluginShell
 *   title="Mi Plugin"
 *   subtitle="Dashboard de métricas"
 *   headerActions={<button>Exportar</button>}
 *   user={user}
 * >
 *   <MyContent />
 * </PluginShell>
 */
export function PluginShell({ title, subtitle, headerCenter, headerActions, user, children }: PluginShellProps) {
  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
      {/* ── Standard Header ── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-2.5 bg-white border-b border-gray-100">
        {/* Left: Title */}
        <div className="min-w-0">
          <h1 className="text-sm font-bold text-gray-800 leading-tight truncate">{title}</h1>
          {subtitle && (
            <p className="text-[10px] text-gray-400 leading-tight truncate">{subtitle}</p>
          )}
        </div>

        {/* Center: Custom content (tabs, filters, etc.) */}
        {headerCenter && <div className="ml-2">{headerCenter}</div>}

        {/* Right: Actions + User */}
        <div className="ml-auto flex items-center gap-2">
          {headerActions}
          <div className="flex items-center gap-1.5 pl-2 border-l border-gray-100">
            <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-500">
              {user.firstName[0]}{user.lastName[0]}
            </div>
            <span className="text-[11px] text-gray-400 hidden sm:inline">
              {user.firstName} {user.lastName}
            </span>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

/**
 * Full-screen loading spinner — use while usePluginAuth is loading.
 */
export function PluginLoading() {
  return (
    <div className="h-full flex items-center justify-center bg-gray-50">
      <div className="w-7 h-7 rounded-full border-[3px] border-green-500 border-t-transparent animate-spin" />
    </div>
  );
}
