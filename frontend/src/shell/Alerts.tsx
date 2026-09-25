/**
 * Live alerts from the realtime channel. Supervisors and Quality see incoming issues; operators see
 * their supervisor's broadcasts. A critical alert stays until dismissed — it never times out.
 */
import { Megaphone, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';

import type { RealtimeEvent } from '../api/realtime';
import type { Issue, Role } from '../api/types';
import { SeverityBadge } from '../components/Severity';

interface IssueAlert {
  key: string;
  issue: Issue;
  escalated: boolean;
}

const DISMISS_AFTER_MS = 12_000;

export function useAlerts(role: Role) {
  const [alerts, setAlerts] = useState<IssueAlert[]>([]);
  const [broadcast, setBroadcast] = useState<{ id: number; message: string } | null>(null);

  const dismiss = useCallback((key: string) => {
    setAlerts((current) => current.filter((alert) => alert.key !== key));
  }, []);

  const onEvent = useCallback(
    (event: RealtimeEvent) => {
      if (event.type === 'broadcast' && role === 'operator') {
        setBroadcast({ id: event.id, message: event.message });
      }
      if ((event.type === 'new_issue' || event.type === 'issue_escalated') && role !== 'operator') {
        const key = `${event.type}-${event.issue.id}-${Date.now()}`;
        setAlerts((current) => [
          { key, issue: event.issue, escalated: event.type === 'issue_escalated' },
          ...current.slice(0, 3),
        ]);
      }
    },
    [role],
  );

  return { alerts, dismiss, broadcast, onEvent };
}

function AlertCard({ alert, onDismiss }: { alert: IssueAlert; onDismiss: () => void }) {
  const critical = alert.issue.severity === 'critical';

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
      <Link to={`/app/issues/${alert.issue.id}`} onClick={onDismiss} className="flex-1 p-3">
        <p className="label mb-1.5">{alert.escalated ? 'Escalated to you' : 'New issue'}</p>
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={alert.issue.severity} size="sm" />
          <span className="font-bold">{alert.issue.issue_type}</span>
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          <span className="telemetry">Dock {alert.issue.door_number ?? '—'}</span> ·{' '}
          {alert.issue.operator_name}
        </p>
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

export function AlertStack({ alerts, dismiss }: { alerts: IssueAlert[]; dismiss: (key: string) => void }) {
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
