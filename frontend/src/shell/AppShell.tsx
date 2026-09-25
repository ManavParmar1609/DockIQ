import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router';

import { useBroadcasts, useWmsStatus } from '../api/hooks';
import type { Broadcast } from '../api/types';
import { useRealtime, type Connection } from '../api/realtime';
import { useAuth } from '../auth/AuthProvider';
import { SimulatedTag } from '../components/ui';
import { initials } from '../lib/format';
import { AlertStack, BroadcastBanner, useAlerts } from './Alerts';
import { NAV, ROLE_LABEL } from './nav';
import { QuickRequest } from './QuickRequest';

const SHIFT_MS = 8 * 60 * 60 * 1000;
const DISMISSED_KEY = 'dockiq.broadcast.dismissed';

/** The live broadcast if one just arrived, else the newest stored one from this shift. */
function currentBroadcast(
  live: { id: number; message: string } | null,
  stored: Broadcast[] | undefined,
): { id: number; message: string } | null {
  if (live) return live;
  const newest = stored?.[0];
  if (!newest || Date.now() - new Date(newest.created_at).getTime() > SHIFT_MS) return null;
  return newest;
}

function useDismissedBroadcast(): [number | null, (id: number) => void] {
  const [dismissed, setDismissed] = useState<number | null>(() => {
    try {
      const value = sessionStorage.getItem(DISMISSED_KEY);
      return value ? Number(value) : null;
    } catch {
      return null;
    }
  });
  const dismiss = (id: number) => {
    setDismissed(id);
    try {
      sessionStorage.setItem(DISMISSED_KEY, String(id));
    } catch {
      /* dismissal lasts for this page load only */
    }
  };
  return [dismissed, dismiss];
}

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center bg-ink" aria-hidden="true">
        <span className="h-3 w-4 border-2 border-light" />
      </span>
      <span className={`display ${compact ? 'text-xl' : 'text-2xl'}`}>DockIQ</span>
    </span>
  );
}

function LiveIndicator({ connection }: { connection: Connection }) {
  const label = { live: 'Live', connecting: 'Connecting', offline: 'Offline — reconnecting' }[connection];
  return (
    <span className="label flex items-center gap-2" role="status" aria-live="polite">
      <span
        aria-hidden="true"
        className={`h-2.5 w-2.5 ${connection === 'live' ? 'bg-ink' : 'border-2 border-ink bg-transparent'}`}
      />
      {label}
    </span>
  );
}

/** The WMS boundary is down: say what still works. Only for a connected (simulated or real) WMS. */
function WmsOfflineBanner() {
  const wms = useWmsStatus();
  if (!wms.data || wms.data.online || wms.data.mode === 'none') return null;
  return (
    <div role="status" className="flex items-stretch border-b-2 border-hazard bg-light">
      <div className="hazard-tape w-3 shrink-0" aria-hidden="true" />
      <p className="px-4 py-3 text-base">
        <span className="heading mr-2 text-hazard-deep">WMS offline</span>
        Work from the paper load sheet. Counts and sign-offs are saved here and sent when it is back.
      </p>
    </div>
  );
}

export function AppShell() {
  const { user, checking, logout } = useAuth();
  const location = useLocation();

  if (checking) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <p className="label">Signing in…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <SignedInShell
      role={user.role}
      name={user.name}
      employeeId={user.employee_id}
      zone={user.zone}
      onLogout={logout}
    />
  );
}

function SignedInShell({
  role,
  name,
  employeeId,
  zone,
  onLogout,
}: {
  role: keyof typeof NAV;
  name: string;
  employeeId: string;
  zone: string | null | undefined;
  onLogout: () => void;
}) {
  const { alerts, dismiss, broadcast, onEvent } = useAlerts(role);
  const connection = useRealtime(onEvent);
  const broadcasts = useBroadcasts();
  const [dismissedId, setDismissedId] = useDismissedBroadcast();
  const items = NAV[role];
  const shown = role === 'operator' ? currentBroadcast(broadcast, broadcasts.data) : null;

  return (
    <div className="shell-grid min-h-dvh">
      {/* Rail — desktop */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r-2 border-ink bg-paper lg:flex">
        <div className="border-b-2 border-ink px-5 py-5">
          <Wordmark />
          <p className="label mt-2">{zone ? `${ROLE_LABEL[role]} · ${zone}` : ROLE_LABEL[role]}</p>
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto py-2">
          {items.map((item, index) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 border-b border-hairline px-5 py-3 ${isActive ? 'bg-ink text-light' : 'hover:bg-paper-sunk'}`
              }
            >
              <span className="telemetry w-6 text-sm opacity-80">{String(index + 1).padStart(2, '0')}</span>
              <item.icon size={20} aria-hidden="true" />
              <span className="heading text-lg">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="flex flex-col gap-3 border-t-2 border-ink px-5 py-4">
          <LiveIndicator connection={connection} />
          <SimulatedTag />
          <div className="flex items-center gap-3">
            <span className="telemetry grid h-11 w-11 place-items-center bg-ink text-light">
              {initials(name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{name}</p>
              <p className="telemetry text-sm text-ink-mute">{employeeId}</p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              aria-label="Sign out"
              className="w-11 border-2 border-ink"
            >
              <LogOut size={18} className="mx-auto" aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Top bar — tablet and phone */}
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b-2 border-ink bg-paper px-4 py-2 lg:hidden">
          <Wordmark compact />
          <div className="flex items-center gap-3">
            <LiveIndicator connection={connection} />
            <button
              type="button"
              onClick={onLogout}
              aria-label="Sign out"
              className="w-11 border-2 border-ink"
            >
              <LogOut size={18} className="mx-auto" aria-hidden="true" />
            </button>
          </div>
        </header>

        <WmsOfflineBanner />

        {shown && shown.id !== dismissedId && (
          <BroadcastBanner
            key={shown.id}
            message={shown.message}
            onDismiss={() => setDismissedId(shown.id)}
          />
        )}

        <main className="flex-1 px-4 pb-32 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-8">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
          <div className="mt-10 lg:hidden">
            <SimulatedTag />
          </div>
        </main>

        {/* Tab bar — tablet and phone */}
        <nav
          aria-label="Main"
          className="tabbar-safe fixed inset-x-0 bottom-0 z-20 grid border-t-2 border-ink bg-paper lg:hidden"
          style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
        >
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex min-h-16 flex-col items-center justify-center gap-1 px-1 ${isActive ? 'bg-ink text-light' : ''}`
              }
            >
              <item.icon size={22} aria-hidden="true" />
              <span className="text-sm font-bold leading-none">{item.short ?? item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      {role === 'operator' && <QuickRequest />}
      <AlertStack alerts={alerts} dismiss={dismiss} />
    </div>
  );
}
