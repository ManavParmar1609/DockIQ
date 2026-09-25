/**
 * Live alerts from the realtime channel. Supervisors and Quality see incoming issues. Operators see
 * their supervisor's broadcasts, who is on the way to their dock, and the decision on their issue.
 * A critical alert stays until dismissed — it never times out.
 */
import { Footprints, Gavel, Megaphone, X } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import type { RealtimeEvent } from '../api/realtime';
import type { Role, Severity } from '../api/types';
import { SeverityBadge } from '../components/Severity';

interface Alert {
  key: string;
  href: string;
  kicker: string;
  title: string;
  detail: string;
  severity?: Severity;
  icon?: ReactNode;
}

const DISMISS_AFTER_MS = 12_000;

function alertFor(event: RealtimeEvent, role: Role): Omit<Alert, 'key'> | null {
  if ((event.type === 'new_issue' || event.type === 'issue_escalated') && role !== 'operator') {
    const { issue } = event;
    return {
      href: `/app/issues/${String(issue.id)}`,
      kicker:
        event.type === 'issue_escalated' || issue.status === 'escalated' ? 'Escalated to you' : 'New issue',
      title: issue.issue_type,
      detail: `Dock ${String(issue.door_number ?? '—')} · ${issue.operator_name ?? ''}`,
      severity: issue.severity,
    };
  }
  if (event.type === 'issue_acknowledged' && role === 'operator') {
    return {
      href: `/app/issues/${String(event.issue_id)}`,
      kicker: 'Help is coming',
      title: `${event.supervisor_name} is on the way`,
      detail:
        event.door_number == null
          ? `Issue #${String(event.issue_id)}`
          : `To dock ${String(event.door_number)}`,
      icon: <Footprints size={20} aria-hidden="true" />,
    };
  }
  if (event.type === 'issue_resolved' && event.method === 'supervisor_resolved' && role === 'operator') {
    return {
      href: `/app/issues/${String(event.issue_id)}`,
      kicker: 'Supervisor decided',
      title: event.resolution ?? 'Decision recorded',
      detail: `Issue #${String(event.issue_id)} · open it for the notes`,
      icon: <Gavel size={20} aria-hidden="true" />,
    };
  }
  return null;
}

export function useAlerts(role: Role) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [broadcast, setBroadcast] = useState<{ id: number; message: string } | null>(null);

  const dismiss = useCallback((key: string) => {
    setAlerts((current) => current.filter((alert) => alert.key !== key));
  }, []);

  const onEvent = useCallback(
    (event: RealtimeEvent) => {
      if (event.type === 'broadcast' && role === 'operator') {
        setBroadcast({ id: event.id, message: event.message });
        return;
      }
      const alert = alertFor(event, role);
      if (alert) {
        const key = `${event.type}-${alert.href}-${String(Date.now())}`;
        setAlerts((current) => [{ key, ...alert }, ...current.slice(0, 3)]);
      }
    },
    [role],
  );

  return { alerts, dismiss, broadcast, onEvent };
}

function AlertCard({ alert, onDismiss }: { alert: Alert; onDismiss: () => void }) {
  const critical = alert.severity === 'critical';

  useEffect(() => {
    if (critical) return undefined;
    const timer = window.setTimeout(onDismiss, DISMISS_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [critical, onDismiss]);

  return (
    <div
      role={critical ? 'alert' : 'status'}
      // Critical banners are solid: no translucency on a critical alert (rules §2.3).
      className={`flex overflow-hidden rounded-2xl shadow-float ${critical ? 'bg-surface ring-2 ring-hazard' : 'material-thick'}`}
    >
      {critical && <div className="hazard-tape w-1.5 shrink-0" aria-hidden="true" />}
      <Link to={alert.href} onClick={onDismiss} className="flex-1 px-4 py-3">
        <p className="text-sm font-semibold text-ink-mute">{alert.kicker}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {alert.severity ? <SeverityBadge severity={alert.severity} size="sm" /> : alert.icon}
          <span className="text-base font-semibold">{alert.title}</span>
        </div>
        <p className="telemetry mt-0.5 text-sm font-medium text-ink-mute">{alert.detail}</p>
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="m-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-mute hover:bg-paper-sunk"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

export function AlertStack({ alerts, dismiss }: { alerts: Alert[]; dismiss: (key: string) => void }) {
  if (alerts.length === 0) return null;
  return (
    <div
      className="fixed top-3 right-3 left-3 z-50 flex flex-col gap-2 sm:left-auto sm:w-96"
      aria-live="assertive"
    >
      {alerts.map((alert) => (
        <AlertCard key={alert.key} alert={alert} onDismiss={() => dismiss(alert.key)} />
      ))}
    </div>
  );
}

export function BroadcastBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div role="status" className="px-4 pt-4 sm:px-6 lg:px-10">
      <div className="mx-auto flex max-w-7xl items-center gap-3 rounded-xl bg-accent py-2 pr-2 pl-4 text-on-accent shadow-card">
        <Megaphone size={22} aria-hidden="true" className="shrink-0" />
        <p className="flex-1 text-base font-semibold">
          <span className="mr-2 font-normal opacity-90">Your supervisor:</span>
          {message}
        </p>
        <button
          type="button"
          aria-label="Dismiss broadcast"
          onClick={onDismiss}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-white/15"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
