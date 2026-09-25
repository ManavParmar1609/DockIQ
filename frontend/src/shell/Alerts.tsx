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
      className={`flex border-2 bg-light ${critical ? 'border-hazard' : 'border-ink'}`}
    >
      {critical && <div className="hazard-tape w-2.5 shrink-0" aria-hidden="true" />}
      <Link to={alert.href} onClick={onDismiss} className="flex-1 p-3">
        <p className="label mb-1.5">{alert.kicker}</p>
        <div className="flex flex-wrap items-center gap-2">
          {alert.severity ? <SeverityBadge severity={alert.severity} size="sm" /> : alert.icon}
          <span className="font-bold">{alert.title}</span>
        </div>
        <p className="telemetry mt-1 text-sm text-ink-soft">{alert.detail}</p>
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="w-11 shrink-0 border-l-2 border-ink"
      >
        <X size={18} className="mx-auto" aria-hidden="true" />
      </button>
    </div>
  );
}

export function AlertStack({ alerts, dismiss }: { alerts: Alert[]; dismiss: (key: string) => void }) {
  if (alerts.length === 0) return null;
  return (
    <div
      className="fixed left-4 right-4 top-4 z-50 flex flex-col gap-2 sm:left-auto sm:w-96"
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
    <div role="status" className="flex items-stretch border-b-2 border-ink bg-ink text-light">
      <div className="flex flex-1 items-center gap-3 px-4 py-3">
        <Megaphone size={22} aria-hidden="true" className="shrink-0" />
        <p className="text-lg font-semibold">
          <span className="label mr-2 text-light">Supervisor</span>
          {message}
        </p>
      </div>
      <button
        type="button"
        aria-label="Dismiss broadcast"
        onClick={onDismiss}
        className="w-14 border-l-2 border-light"
      >
        <X size={20} className="mx-auto" aria-hidden="true" />
      </button>
    </div>
  );
}
