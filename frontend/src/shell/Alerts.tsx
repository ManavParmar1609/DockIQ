/**
 * Live alerts from the realtime channel, built so they cannot be lost. Supervisors and Quality see
 * incoming issues; on load, every escalated issue nobody has taken yet comes back as an alert. Operators
 * see their supervisor's broadcasts, who is on the way, the decision on their issue and their requests.
 * A critical alert and a cold-room excursion stay until dismissed — they never time out — and every
 * alert is kept in the inbox for the session.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Footprints, Gavel, Megaphone, Thermometer, Wrench, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';

import { requestsQuery, useIssues } from '../api/hooks';
import type { RealtimeEvent } from '../api/realtime';
import type { Issue, QuickRequest, Role, Severity } from '../api/types';
import { SeverityBadge } from '../components/Severity';
import { EmptyState } from '../components/ui';
import { formatDateTime, formatTemp } from '../lib/format';

type AlertIcon = 'footprints' | 'gavel' | 'request' | 'room';

export interface Alert {
  /** Stable per subject (`issue-12`), so a repeat replaces rather than stacks. */
  key: string;
  href: string;
  kicker: string;
  title: string;
  detail: string;
  severity?: Severity;
  icon?: AlertIcon;
  /** Stays on screen until dismissed: critical issues and cold-room excursions. */
  sticky: boolean;
  /** The issue it is about, so it can be withdrawn once someone has taken it. */
  issueId?: number;
  at: number;
}

type AlertDraft = Omit<Alert, 'at'>;

const DISMISS_AFTER_MS = 12_000;
const INBOX_SIZE = 30;
const VISIBLE = 3;
const DISMISSED_KEY = 'dockiq.alerts.dismissed';
const INBOX_KEY = 'dockiq.alerts.inbox';

const ICONS: Record<AlertIcon, typeof Bell> = {
  footprints: Footprints,
  gavel: Gavel,
  request: Wrench,
  room: Thermometer,
};

function dockOf(door: number | null | undefined): string | null {
  return door == null ? null : `Dock ${String(door)}`;
}

/** An incoming issue, worded for who is reading: Quality reviews, a supervisor is escalated to. */
export function issueAlert(issue: Issue, role: Role, escalatedNow = false): AlertDraft {
  const room = issue.room;
  if (room) {
    const reading = issue.temp_reading == null ? 'over its limit' : `at ${formatTemp(issue.temp_reading)}`;
    return {
      key: `issue-${String(issue.id)}`,
      href: `/app/issues/${String(issue.id)}`,
      kicker: role === 'quality' ? 'For your review · cold room' : 'Cold-room excursion',
      title: `${room} ${reading}`,
      detail: [
        issue.temp_limit == null ? null : `Limit ${formatTemp(issue.temp_limit)}`,
        issue.held_pallets?.length ? `${String(issue.held_pallets.length)} pallets on hold` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      severity: issue.severity,
      icon: 'room',
      sticky: true,
      issueId: issue.id,
    };
  }
  const escalated = escalatedNow || issue.status === 'escalated';
  return {
    key: `issue-${String(issue.id)}`,
    href: `/app/issues/${String(issue.id)}`,
    kicker: role === 'quality' ? 'For your review' : escalated ? 'Escalated to you' : 'New issue',
    title: issue.issue_subtype ?? issue.issue_type,
    detail: [dockOf(issue.door_number), issue.operator_name].filter(Boolean).join(' · '),
    severity: issue.severity,
    sticky: issue.severity === 'critical',
    issueId: issue.id,
  };
}

/** A request, for the supervisor who fulfils it or the operator who asked. */
export function requestAlert(
  event: Extract<RealtimeEvent, { type: 'new_request' }>,
  role: Role,
  request?: QuickRequest,
): AlertDraft | null {
  const status = event.status ?? 'pending';
  if (role === 'supervisor' && status === 'pending') {
    const from = [
      request?.operator_name ? `from ${request.operator_name}` : null,
      request?.door_number == null ? null : `at Dock ${String(request.door_number)}`,
    ]
      .filter(Boolean)
      .join(' ');
    return {
      key: `request-${String(event.request_id)}`,
      href: '/app',
      kicker: 'New request',
      title: `${event.request_type}${from ? ` ${from}` : ''}`,
      detail: request?.details ?? 'On your floor, under Requests',
      icon: 'request',
      sticky: false,
    };
  }
  if (role === 'operator' && status === 'fulfilled') {
    return {
      key: `request-${String(event.request_id)}`,
      href: '/app',
      kicker: 'Request fulfilled',
      title: `Your ${event.request_type} request was fulfilled`,
      detail: 'Your supervisor marked it done',
      icon: 'request',
      sticky: false,
    };
  }
  return null;
}

export function alertFor(event: RealtimeEvent, role: Role): AlertDraft | null {
  if ((event.type === 'new_issue' || event.type === 'issue_escalated') && role !== 'operator') {
    return issueAlert(event.issue, role, event.type === 'issue_escalated');
  }
  if (event.type === 'issue_acknowledged' && role === 'operator') {
    return {
      key: `ack-${String(event.issue_id)}`,
      href: `/app/issues/${String(event.issue_id)}`,
      kicker: 'Help is coming',
      title: `${event.supervisor_name} is on the way`,
      detail: dockOf(event.door_number)
        ? `To ${dockOf(event.door_number) ?? ''}`
        : `Issue #${String(event.issue_id)}`,
      icon: 'footprints',
      sticky: false,
    };
  }
  if (event.type === 'issue_resolved' && role === 'operator') {
    if (event.method === 'on_hold') {
      return {
        key: `decision-${String(event.issue_id)}`,
        href: `/app/issues/${String(event.issue_id)}`,
        kicker: 'Supervisor decided · on hold',
        title: event.resolution ?? 'On hold',
        detail: `Issue #${String(event.issue_id)} stays open while it waits`,
        icon: 'gavel',
        sticky: false,
      };
    }
    if (event.method === 'supervisor_resolved') {
      return {
        key: `decision-${String(event.issue_id)}`,
        href: `/app/issues/${String(event.issue_id)}`,
        kicker: 'Supervisor decided',
        title: event.resolution ?? 'Decision recorded',
        detail: `Issue #${String(event.issue_id)} · open it for the notes`,
        icon: 'gavel',
        sticky: false,
      };
    }
  }
  return null;
}

/**
 * What still needs this person, rebuilt from the open issues: for a supervisor, every escalated issue
 * nobody has said "on my way" to; for Quality, every issue with product on hold or a cold-room
 * excursion, without a disposition.
 */
export function pendingAlerts(issues: readonly Issue[], role: Role): Alert[] {
  // Dated by when the issue reached the queue, not by when this page happened to load.
  const dated = (issue: Issue): Alert => ({
    ...issueAlert(issue, role),
    at: Date.parse(issue.escalated_at ?? issue.created_at),
  });
  if (role === 'supervisor') {
    return issues.filter((issue) => issue.status === 'escalated' && !issue.acknowledged_at).map(dated);
  }
  if (role === 'quality') {
    // What Quality must decide: product on hold, or a cold room over its limit, without a disposition.
    return issues
      .filter((issue) => (issue.room || (issue.held_pallets?.length ?? 0) > 0) && !issue.disposition)
      .map(dated);
  }
  return [];
}

/**
 * Everything still waiting from before this page loaded is one card, not a wall of them: the stack
 * must never bury the screen. Alerts that arrive live keep their own card.
 */
export function collapsePending(alerts: Alert[], liveKeys: ReadonlySet<string>, role: Role): Alert[] {
  const waiting = alerts.filter((alert) => alert.issueId !== undefined && !liveKeys.has(alert.key));
  if (waiting.length < 2) return alerts;
  const critical = waiting.filter((alert) => alert.severity === 'critical').length;
  const summary: Alert = {
    key: `pending-${waiting.map((alert) => String(alert.issueId)).join('.')}`,
    href: '/app',
    kicker: role === 'quality' ? 'For your review' : 'Still waiting for you',
    title:
      role === 'quality'
        ? `${String(waiting.length)} issues without a disposition`
        : `${String(waiting.length)} escalated issues nobody has taken`,
    detail:
      critical > 0
        ? `${String(critical)} critical · open your alerts for the list`
        : 'Open your alerts for the list',
    severity: critical > 0 ? 'critical' : undefined,
    // The queue, the bell and the tab title carry it after this; a card that never leaves would sit
    // over every screen's own actions.
    sticky: false,
    at: Math.max(...waiting.map((alert) => alert.at)),
  };
  const rest = alerts.filter((alert) => !waiting.includes(alert));
  return [summary, ...rest].sort((a, b) => Number(b.sticky) - Number(a.sticky) || b.at - a.at);
}

function readKeys(key: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(key);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

function isAlert(value: unknown): value is Alert {
  if (typeof value !== 'object' || value === null) return false;
  const alert = value as Record<string, unknown>;
  return (
    typeof alert.key === 'string' &&
    typeof alert.href === 'string' &&
    typeof alert.title === 'string' &&
    typeof alert.at === 'number'
  );
}

function readInbox(): Alert[] {
  try {
    const raw = sessionStorage.getItem(INBOX_KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter(isAlert).slice(0, INBOX_SIZE) : [];
  } catch {
    return [];
  }
}

function store(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* kept for this page load only */
  }
}

function notify(alert: Alert) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  try {
    const note = new Notification(`${alert.kicker}: ${alert.title}`, { body: alert.detail, tag: alert.key });
    note.onclick = () => window.focus();
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

export function useAlerts(role: Role) {
  const client = useQueryClient();
  const staff = role !== 'operator';
  const open = useIssues({ status: 'active' }, staff);
  const [live, setLive] = useState<Alert[]>([]);
  const [inbox, setInbox] = useState<Alert[]>(readInbox);
  const [dismissed, setDismissed] = useState<Set<string>>(() => readKeys(DISMISSED_KEY));
  const [unseen, setUnseen] = useState(0);
  const [seenKeys, setSeenKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [broadcast, setBroadcast] = useState<{ id: number; message: string } | null>(null);

  const record = useCallback((draft: AlertDraft, fresh: boolean) => {
    const alert: Alert = { ...draft, at: Date.now() };
    setLive((current) => [alert, ...current.filter((item) => item.key !== alert.key)]);
    setInbox((current) => {
      const next = [alert, ...current.filter((item) => item.key !== alert.key)].slice(0, INBOX_SIZE);
      store(INBOX_KEY, next);
      return next;
    });
    setDismissed((current) => {
      if (!current.has(alert.key)) return current;
      const next = new Set(current);
      next.delete(alert.key);
      store(DISMISSED_KEY, [...next]);
      return next;
    });
    setUnseen((count) => count + 1);
    if (fresh && alert.sticky) notify(alert);
  }, []);

  const dismiss = useCallback((key: string) => {
    setDismissed((current) => {
      const next = new Set(current).add(key);
      store(DISMISSED_KEY, [...next]);
      return next;
    });
  }, []);

  const onEvent = useCallback(
    (event: RealtimeEvent) => {
      if (event.type === 'broadcast' && role === 'operator') {
        setBroadcast({ id: event.id, message: event.message });
        return;
      }
      if (event.type === 'new_request') {
        if (role === 'supervisor' && (event.status ?? 'pending') === 'pending') {
          // The event names the request; who asked and where comes from the list it just refreshed.
          void client
            .query({ ...requestsQuery('pending'), staleTime: 0 })
            .then((list) => list.find((request) => request.id === event.request_id))
            .catch(() => undefined)
            .then((request) => {
              const alert = requestAlert(event, role, request);
              if (alert) record(alert, true);
            });
          return;
        }
        const alert = requestAlert(event, role);
        if (alert) record(alert, true);
        return;
      }
      const alert = alertFor(event, role);
      if (alert) record(alert, true);
    },
    [client, record, role],
  );

  // On load (and after any refetch), whatever still needs this person comes back as an alert.
  const rebuilt = useMemo<Alert[]>(
    () => (staff && open.data ? pendingAlerts(open.data, role) : []),
    [open.data, role, staff],
  );

  // An issue someone has taken, decided or disposed of stops alerting; its inbox line stays.
  const stillPending = useMemo(() => {
    if (!staff || !open.data) return null;
    return new Set(rebuilt.map((alert) => alert.issueId));
  }, [open.data, rebuilt, staff]);

  const pending = useMemo(() => {
    const byKey = new Map<string, Alert>();
    for (const alert of rebuilt) byKey.set(alert.key, alert);
    for (const alert of live) byKey.set(alert.key, alert);
    return [...byKey.values()]
      .filter((alert) => !dismissed.has(alert.key))
      .filter(
        (alert) =>
          alert.issueId === undefined ||
          stillPending === null ||
          stillPending.has(alert.issueId) ||
          // A new, non-escalated issue is news for a moment even though nobody needs to take it.
          (!alert.sticky && live.some((item) => item.key === alert.key)),
      )
      .sort((a, b) => Number(b.sticky) - Number(a.sticky) || b.at - a.at);
  }, [dismissed, live, rebuilt, stillPending]);
  const alerts = useMemo(
    () =>
      collapsePending(
        pending.filter((alert) => !dismissed.has(alert.key)),
        new Set(live.map((alert) => alert.key)),
        role,
      ).filter((alert) => !dismissed.has(alert.key)),
    [dismissed, live, pending, role],
  );

  // The inbox: what arrived live this session, plus whatever is still pending from before it.
  const shownInbox = useMemo(() => {
    const known = new Set(inbox.map((alert) => alert.key));
    return [...rebuilt.filter((alert) => !known.has(alert.key)), ...inbox]
      .sort((a, b) => b.at - a.at)
      .slice(0, INBOX_SIZE);
  }, [inbox, rebuilt]);
  const waiting = rebuilt.filter((alert) => !seenKeys.has(alert.key) && !dismissed.has(alert.key)).length;

  // Every critical still waiting counts in the tab title, even when the stack shows them as one card.
  const urgent = pending.filter((alert) => alert.sticky).length;

  return {
    alerts,
    inbox: shownInbox,
    urgent,
    unseen: unseen + waiting,
    markSeen: () => {
      setUnseen(0);
      setSeenKeys(new Set(rebuilt.map((alert) => alert.key)));
    },
    dismiss,
    broadcast,
    onEvent,
  };
}

/** "(2) DockIQ …" while critical alerts wait, so a background tab still says so. */
export function useTitleCount(count: number) {
  const base = useRef<string | null>(null);
  useEffect(() => {
    base.current ??= document.title.replace(/^\(\d+\) /, '');
    document.title = count > 0 ? `(${String(count)}) ${base.current}` : base.current;
  }, [count]);
  useEffect(
    () => () => {
      if (base.current) document.title = base.current;
    },
    [],
  );
}

function AlertGlyph({ alert, size = 20 }: { alert: Pick<Alert, 'icon' | 'severity'>; size?: number }) {
  if (alert.severity) return <SeverityBadge severity={alert.severity} size="sm" />;
  if (!alert.icon) return null;
  const Icon = ICONS[alert.icon];
  return <Icon size={size} aria-hidden="true" />;
}

function AlertCard({ alert, onDismiss }: { alert: Alert; onDismiss: () => void }) {
  const critical = alert.severity === 'critical' || alert.sticky;
  const { sticky } = alert;

  useEffect(() => {
    if (sticky) return undefined;
    const timer = window.setTimeout(onDismiss, DISMISS_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [sticky, onDismiss]);

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
          <AlertGlyph alert={alert} />
          {alert.severity && alert.icon === 'room' && <Thermometer size={18} aria-hidden="true" />}
          <span className="text-base font-semibold">{alert.title}</span>
        </div>
        {alert.detail && <p className="telemetry mt-0.5 text-sm font-medium text-ink-mute">{alert.detail}</p>}
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

export function AlertStack({
  alerts,
  dismiss,
  onOpenInbox,
}: {
  alerts: Alert[];
  dismiss: (key: string) => void;
  onOpenInbox: () => void;
}) {
  if (alerts.length === 0) return null;
  const hidden = alerts.length - VISIBLE;
  return (
    <div
      className="fixed top-3 right-3 left-3 z-50 flex flex-col gap-2 sm:left-auto sm:w-96"
      aria-live="assertive"
    >
      {alerts.slice(0, VISIBLE).map((alert) => (
        <AlertCard key={alert.key} alert={alert} onDismiss={() => dismiss(alert.key)} />
      ))}
      {hidden > 0 && (
        <button type="button" className="btn btn-secondary shadow-float" onClick={onOpenInbox}>
          <Bell size={18} aria-hidden="true" /> {hidden} more in your alerts
        </button>
      )}
    </div>
  );
}

/** The bell: opens the inbox; the count is what arrived since it was last opened. */
export function AlertButton({ unseen, onOpen }: { unseen: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={unseen > 0 ? `Alerts, ${String(unseen)} new` : 'Alerts'}
      className="flex h-11 min-w-11 items-center justify-center gap-1 rounded-full px-2 text-ink-mute transition-colors hover:bg-paper-sunk hover:text-ink"
    >
      <Bell size={19} aria-hidden="true" />
      {unseen > 0 && <span className="telemetry text-sm font-semibold text-ink">{unseen}</span>}
    </button>
  );
}

function NotificationToggle() {
  const supported = typeof Notification !== 'undefined';
  const [permission, setPermission] = useState(supported ? Notification.permission : 'denied');
  if (!supported) return null;
  if (permission === 'granted') {
    return <p className="text-sm text-ink-mute">Desktop alerts are on for critical issues.</p>;
  }
  if (permission === 'denied') {
    return <p className="text-sm text-ink-mute">Desktop alerts are blocked in this browser’s settings.</p>;
  }
  return (
    <button
      type="button"
      className="btn btn-secondary w-full"
      onClick={() => void Notification.requestPermission().then(setPermission)}
    >
      <Bell size={18} aria-hidden="true" /> Alert me when this tab is in the background
    </button>
  );
}

/** Every alert this session, newest first, in the side sheet. */
export function AlertInbox({
  open,
  onClose,
  inbox,
  role,
}: {
  open: boolean;
  onClose: () => void;
  inbox: Alert[];
  role: Role;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-labelledby="alert-inbox-title"
      className="dock-sheet bg-surface p-0 text-ink shadow-float"
    >
      <div className="flex min-h-full flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-hairline bg-surface px-6 pt-6 pb-4">
          <h2 id="alert-inbox-title" className="display text-3xl">
            Alerts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-paper-sunk text-ink-mute"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="flex flex-col gap-4 px-6 pt-4 pb-8">
          {role !== 'operator' && <NotificationToggle />}
          {inbox.length === 0 ? (
            <EmptyState title="Nothing yet" icon={<Megaphone size={26} aria-hidden="true" />}>
              Alerts land here as they arrive, and stay for this session.
            </EmptyState>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {inbox.map((alert) => (
                <li
                  key={`${alert.key}-${String(alert.at)}`}
                  className="border-b border-hairline last:border-b-0"
                >
                  <Link
                    to={alert.href}
                    onClick={onClose}
                    className="my-1 flex flex-col gap-1 rounded-lg p-2 transition-colors hover:bg-paper"
                  >
                    <span className="flex items-baseline justify-between gap-3 text-sm text-ink-mute">
                      <span className="font-semibold">{alert.kicker}</span>
                      <span className="telemetry shrink-0">
                        {formatDateTime(new Date(alert.at).toISOString())}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <AlertGlyph alert={alert} size={18} />
                      <span className="text-base font-semibold">{alert.title}</span>
                    </span>
                    {alert.detail && <span className="telemetry text-sm text-ink-mute">{alert.detail}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </dialog>
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
