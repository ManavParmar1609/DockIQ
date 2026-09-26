import { CloudOff, LogOut, Warehouse } from 'lucide-react';
import { useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router';

import { useBroadcasts, useWmsStatus } from '../api/hooks';
import type { Broadcast } from '../api/types';
import { useRealtime, type Connection } from '../api/realtime';
import { useAuth } from '../auth/AuthProvider';
import { ErrorBlock, SimulatedTag } from '../components/ui';
import { initials } from '../lib/format';
import { AlertButton, AlertInbox, AlertStack, BroadcastBanner, useAlerts, useTitleCount } from './Alerts';
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
      <span
        className="grid h-10 w-10 place-items-center rounded-full bg-accent text-on-accent shadow-card"
        aria-hidden="true"
      >
        <Warehouse size={20} strokeWidth={2.2} />
      </span>
      <span className={`display ${compact ? 'text-xl' : 'text-2xl'}`}>
        Dock<span className="wordmark-iq">IQ</span>
      </span>
    </span>
  );
}

// Words first: the dot only repeats what the label says. Never "Live" without an open socket.
const CONNECTION = {
  live: { label: 'Live', dot: 'bg-green', title: 'Updates arrive as they happen' },
  connecting: { label: 'Connecting', dot: 'bg-amber', title: 'Opening the live channel' },
  reconnecting: {
    label: 'Reconnecting',
    dot: 'bg-amber',
    title: 'The live channel dropped; screens refresh when it is back',
  },
  offline: { label: 'Offline', dot: 'bg-ink-mute', title: 'This device has no network connection' },
} as const;

function LiveIndicator({ connection }: { connection: Connection }) {
  const { label, dot, title } = CONNECTION[connection];
  return (
    <span
      className="flex items-center gap-2 text-sm font-medium text-ink-mute"
      role="status"
      aria-live="polite"
      title={title}
    >
      {connection === 'offline' ? (
        <CloudOff size={14} aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot}`} />
      )}
      {label}
    </span>
  );
}

/** The WMS boundary is down: say what still works. Only for a connected (simulated or real) WMS. */
function WmsOfflineBanner() {
  const wms = useWmsStatus();
  if (!wms.data || wms.data.online || wms.data.mode === 'none') return null;
  return (
    <div role="status" className="mb-6 flex items-start gap-3 rounded-xl bg-hazard-soft p-4">
      <CloudOff size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-hazard-deep" />
      <p className="text-base">
        <span className="heading mr-1.5 text-hazard-deep">WMS offline.</span>
        Work from the paper load sheet. Counts and sign-offs are saved here and sent when it is back.
      </p>
    </div>
  );
}

function SignOut({ onLogout }: { onLogout: () => void }) {
  return (
    <button
      type="button"
      onClick={onLogout}
      aria-label="Sign out"
      className="grid w-11 place-items-center rounded-full text-ink-mute transition-colors hover:bg-paper-sunk hover:text-ink"
    >
      <LogOut size={19} aria-hidden="true" />
    </button>
  );
}

export function AppShell() {
  const { user, checking, checkError, recheck, logout } = useAuth();
  const location = useLocation();

  if (checking) {
    return (
      <div className="grid min-h-dvh place-items-center" role="status">
        <p className="label">Signing in…</p>
      </div>
    );
  }
  if (checkError) {
    return (
      <div className="mx-auto grid min-h-dvh max-w-xl place-items-center p-4">
        <ErrorBlock error={checkError} onRetry={recheck} />
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
  const { alerts, inbox, urgent, unseen, markSeen, dismiss, broadcast, onEvent } = useAlerts(role);
  const [inboxOpen, setInboxOpen] = useState(false);
  const openInbox = () => {
    setInboxOpen(true);
    markSeen();
  };
  useTitleCount(urgent);
  const onAssistant = useLocation().pathname.startsWith('/app/chat');
  const connection = useRealtime(onEvent);
  const broadcasts = useBroadcasts();
  const [dismissedId, setDismissedId] = useDismissedBroadcast();
  const items = NAV[role];
  const shown = role === 'operator' ? currentBroadcast(broadcast, broadcasts.data) : null;

  return (
    <div className="shell-grid min-h-dvh">
      {/* Sidebar — desktop, as on iPad */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-hairline bg-paper lg:flex">
        <div className="px-5 pt-6 pb-4">
          <Wordmark />
          <p className="label mt-3">{zone ? `${ROLE_LABEL[role]} · ${zone}` : ROLE_LABEL[role]}</p>
        </div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-full px-4 py-2.5 text-base font-medium transition-colors duration-300 ${isActive ? 'bg-accent text-on-accent' : 'text-ink hover:bg-paper-sunk'}`
              }
            >
              <item.icon size={20} aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex flex-col gap-3 px-5 pt-3 pb-5">
          <div className="flex items-center justify-between gap-2">
            <LiveIndicator connection={connection} />
            <AlertButton unseen={unseen} onOpen={openInbox} />
          </div>
          <div>
            <SimulatedTag />
          </div>
          <div className="flex items-center gap-3 rounded-lg bg-surface p-2.5 shadow-card">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-paper-deep text-sm font-semibold text-ink-soft">
              {initials(name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold">{name}</p>
              <p className="telemetry text-sm text-ink-mute">{employeeId}</p>
            </div>
            <SignOut onLogout={onLogout} />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Navigation bar — tablet and phone: translucent, content scrolls under it */}
        <header className="material sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-hairline px-4 py-1.5 lg:hidden">
          <Wordmark compact />
          <div className="flex items-center gap-2">
            <LiveIndicator connection={connection} />
            <AlertButton unseen={unseen} onOpen={openInbox} />
            <SignOut onLogout={onLogout} />
          </div>
        </header>

        {shown && shown.id !== dismissedId && (
          <BroadcastBanner
            key={shown.id}
            message={shown.message}
            onDismiss={() => setDismissedId(shown.id)}
          />
        )}

        <main className="flex-1 px-4 pt-6 pb-32 sm:px-6 lg:px-10 lg:pt-10 lg:pb-16">
          <div className="mx-auto max-w-7xl">
            <WmsOfflineBanner />
            <Outlet />
          </div>
          <div className="mt-10 flex justify-center lg:hidden">
            <SimulatedTag />
          </div>
        </main>

        {/* Tab bar — tablet and phone: translucent, the selected tab in blue */}
        <nav
          aria-label="Main"
          className="material tabbar-safe fixed inset-x-0 bottom-0 z-20 grid border-t border-hairline lg:hidden"
          style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
        >
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 transition-colors ${isActive ? 'text-accent-ink' : 'text-ink-mute'}`
              }
            >
              <item.icon size={24} aria-hidden="true" />
              <span className="text-xs font-medium leading-tight">{item.short ?? item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      {/* The assistant has its own input along the bottom; the floating button would cover it. */}
      {role === 'operator' && !onAssistant && <QuickRequest />}
      <AlertStack alerts={alerts} dismiss={dismiss} onOpenInbox={openInbox} />
      <AlertInbox open={inboxOpen} onClose={() => setInboxOpen(false)} inbox={inbox} role={role} />
    </div>
  );
}
