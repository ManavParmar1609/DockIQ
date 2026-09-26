import { ChevronRight, DoorOpen, FileText, Footprints, X } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type SyntheticEvent } from 'react';
import { Link } from 'react-router';

import { ApiError } from '../api/client';
import { useAcknowledge, useIssues, useOrder } from '../api/hooks';
import type { Dock, Issue, OrderDetail, Role } from '../api/types';
import { elapsed, formatNumber, percent, timeAgo } from '../lib/format';
import { useNow } from '../lib/useNow';
import { bySeverityThenAge, DOCK_STATUS, LIFECYCLE } from '../lib/vocab';
import { IssueGroupDot } from './IssueGroup';
import { SeverityBadge, SeverityMark } from './Severity';
import {
  Definition,
  EmptyState,
  IssueStatusTag,
  MutationError,
  Notice,
  QueryBoundary,
  SimulatedTag,
  Tag,
} from './ui';

const STATUS_PILL: Record<Dock['status'], string> = {
  critical: 'bg-hazard text-white',
  issue: 'bg-orange-soft text-orange',
  active: 'bg-green-soft text-green',
  idle: 'bg-paper-sunk text-ink-mute',
};

/**
 * One door in detail, as a modal sheet: from the right on wide screens, from the bottom on phones.
 * `dock` null means closed. Escape, the close button and the backdrop all ask `onClose`; the caller
 * owns the state (the URL), and focus goes back to the door's tile through `returnFocus`.
 */
export function DockSheet({
  dock,
  onClose,
  returnFocus,
  viewerZone = null,
  viewerRole = null,
}: {
  dock: Dock | null;
  onClose: () => void;
  returnFocus: (door: number) => void;
  /** The viewer's own zone: another zone's door names that zone's supervisor as its owner. */
  viewerZone?: string | null;
  /** A supervisor can take an issue from here ("On my way") and is spoken to as the one who decides. */
  viewerRole?: Role | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const lastDoor = useRef<number | null>(null);
  const closing = useRef(false);
  const door = dock?.door_number ?? null;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (door !== null) {
      closing.current = false;
      lastDoor.current = door;
      if (!element.open) {
        element.showModal();
        closeButton.current?.focus();
      }
    } else if (element.open) {
      element.close();
      if (lastDoor.current !== null) returnFocus(lastDoor.current);
    }
  }, [door, returnFocus]);

  // Escape can arrive as a keydown and as a native cancel; ask to close once.
  const requestClose = () => {
    if (closing.current) return;
    closing.current = true;
    onClose();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    requestClose();
  };
  const onCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    requestClose();
  };
  const onBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) requestClose();
  };

  return (
    <dialog
      ref={dialog}
      aria-modal="true"
      aria-labelledby="dock-sheet-title"
      className="dock-sheet bg-surface p-0 text-ink shadow-float"
      onKeyDown={onKeyDown}
      onCancel={onCancel}
      onClick={onBackdrop}
    >
      {dock && (
        <div className="flex min-h-full flex-col">
          <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-hairline bg-surface px-6 pt-6 pb-5">
            <div className="min-w-0">
              <h2 id="dock-sheet-title" className="display text-3xl">
                Dock {dock.door_number}
              </h2>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`pill ${STATUS_PILL[dock.status]}`}>
                  {dock.status === 'critical' && <SeverityMark severity="critical" size={12} />}
                  {dock.status === 'issue' && <SeverityMark severity="high" size={12} />}
                  {DOCK_STATUS[dock.status]}
                </span>
                {dock.lifecycle_phase !== 'idle' && <Tag>{LIFECYCLE[dock.lifecycle_phase]}</Tag>}
                <span className="bracket label">{dock.zone}</span>
              </div>
            </div>
            <button
              ref={closeButton}
              type="button"
              onClick={requestClose}
              aria-label="Close"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-paper-sunk text-ink-mute"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </header>
          <DockBody dock={dock} viewerZone={viewerZone} viewerRole={viewerRole} />
        </div>
      )}
    </dialog>
  );
}

function DockBody({
  dock,
  viewerZone,
  viewerRole,
}: {
  dock: Dock;
  viewerZone: string | null;
  viewerRole: Role | null;
}) {
  const now = useNow();
  const idle = dock.status === 'idle' && dock.current_order_id === null;
  // A door with something open opens on what is open: the order can wait, the issue cannot.
  const troubled = (dock.open_issues ?? 0) > 0 || dock.status === 'issue' || dock.status === 'critical';
  const issues = (
    <OpenIssues dock={dock} now={now} viewerZone={viewerZone} viewerRole={viewerRole} hideWhenEmpty={idle} />
  );

  if (idle) {
    return (
      <div className="sheet-stagger flex flex-col gap-6 px-6 pb-8">
        <EmptyState title="This door is idle" icon={<DoorOpen size={26} aria-hidden="true" />}>
          No trailer and no order. It fills when the yard assigns the next appointment.
        </EmptyState>
        {issues}
      </div>
    );
  }

  return (
    <div className="sheet-stagger flex flex-col gap-8 px-6 pt-5 pb-8">
      {troubled && issues}
      <dl className="grid grid-cols-2 gap-4">
        <Definition term="Working it">{dock.operator_name ?? 'Unassigned'}</Definition>
        <Definition term="Trailer" mono>
          {dock.current_trailer ?? dock.trailer_number ?? '—'}
        </Definition>
        <Definition term="At the door" mono>
          {dock.trailer_arrived_at ? elapsed(dock.trailer_arrived_at, now) : '—'}
        </Definition>
        <Definition term="Last activity" mono>
          {dock.last_activity_at ? timeAgo(dock.last_activity_at, now) : '—'}
        </Definition>
      </dl>
      <CurrentOrder dock={dock} now={now} viewerRole={viewerRole} />
      {!troubled && issues}
    </div>
  );
}

function CurrentOrder({ dock, now, viewerRole }: { dock: Dock; now: number; viewerRole: Role | null }) {
  const order = useOrder(dock.current_order_id ?? undefined);
  const otherTeam = order.error instanceof ApiError && order.error.status === 404;

  return (
    <section aria-labelledby="dock-sheet-order" className="flex flex-col gap-4">
      <h3 id="dock-sheet-order" className="serif-title text-xl">
        Current order
      </h3>
      {dock.current_order_id === null ? (
        <p className="text-base text-ink-mute">No order is assigned to this door.</p>
      ) : otherTeam ? (
        <Notice title={dock.order_number ?? 'Another team’s load'}>
          {dock.company_name && `${dock.company_name}. `}This load belongs to another team, so its counts are
          with their supervisor.
        </Notice>
      ) : (
        <QueryBoundary query={order} loading="Loading the order">
          {(detail) => <OrderSummary order={detail} now={now} viewerRole={viewerRole} />}
        </QueryBoundary>
      )}
    </section>
  );
}

/** The server words blockers for the operator; a supervisor reading them is the one who decides. */
function forViewer(blocker: string, role: Role | null): string {
  if (role !== 'supervisor') return blocker;
  return blocker.replace(
    /: your supervisor decides first\.?$/,
    ': yours to decide before the load is signed off.',
  );
}

function OrderSummary({
  order,
  now,
  viewerRole,
}: {
  order: OrderDetail;
  now: number;
  viewerRole: Role | null;
}) {
  const outbound = order.type === 'outbound';
  const expected = order.items.reduce((sum, item) => sum + item.expected_quantity, 0);
  const counted = order.items.reduce((sum, item) => sum + item.actual_quantity, 0);
  const share = percent(counted, expected);
  const blockers = (order.completion_blockers ?? []).map((blocker) => forViewer(blocker, viewerRole));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="telemetry text-lg">{order.order_number}</p>
        <div className="flex flex-wrap gap-2">
          <Tag tone="accent">{outbound ? 'Loading' : 'Receiving'}</Tag>
          {order.simulated && <SimulatedTag compact />}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-4">
        <Definition term="Customer">{order.company_name}</Definition>
        <Definition term="Carrier">{order.carrier_name}</Definition>
        <Definition term="Trailer" mono>
          {order.trailer_number}
        </Definition>
        <Definition term="Started" mono>
          {elapsed(order.created_at, now)} ago
        </Definition>
      </dl>
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="label">{outbound ? 'Loaded' : 'Received'}</span>
          <span className="telemetry text-base">
            {formatNumber(counted)} / {formatNumber(expected)} cases · {share}%
          </span>
        </div>
        <div
          className="meter mt-2"
          role="progressbar"
          aria-label="Cases counted"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={share}
        >
          <div className="meter-fill" style={{ width: `${share}%` }} />
        </div>
      </div>
      {order.items.length > 0 && (
        <ul className="flex flex-col" aria-label="Order lines">
          {order.items.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 border-b border-hairline py-3 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold">{item.product_name}</span>
                  <span className="telemetry block text-sm text-ink-mute">{item.sku}</span>
                </span>
                <span className="telemetry shrink-0 text-base">
                  {formatNumber(item.actual_quantity)} / {formatNumber(item.expected_quantity)}
                </span>
              </div>
              <div className="meter" aria-hidden="true">
                <div
                  className="meter-fill"
                  style={{ width: `${percent(item.actual_quantity, item.expected_quantity)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {blockers.length > 0 && (
        <Notice title="Not ready to sign off">
          <ul className="flex flex-col gap-1">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Notice>
      )}
    </>
  );
}

function OpenIssues({
  dock,
  now,
  viewerZone,
  viewerRole,
  hideWhenEmpty = false,
}: {
  dock: Dock;
  now: number;
  viewerZone: string | null;
  viewerRole: Role | null;
  hideWhenEmpty?: boolean;
}) {
  // The same query the floor already holds, so it is shared and invalidated by the realtime channel.
  const issues = useIssues({ status: 'active' });
  const here = (issues.data ?? []).filter((issue) => issue.dock_door_id === dock.id);
  // The door's count crosses teams; the records stay with the team they belong to.
  const elsewhere = Math.max(0, (dock.open_issues ?? 0) - here.length);
  if (hideWhenEmpty && here.length === 0 && elsewhere === 0) return null;
  const owner = viewerZone === dock.zone ? 'another team' : `${dock.zone}’s supervisor`;
  const noun = (count: number) => (count === 1 ? 'open issue' : 'open issues');

  const critical = here.some((issue) => issue.severity === 'critical');

  return (
    // A section holding a critical issue arrives with the sheet, never faded in.
    <section
      aria-labelledby="dock-sheet-issues"
      className="flex flex-col gap-3"
      data-still={critical ? '' : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="dock-sheet-issues" className="serif-title text-xl">
          Open issues
        </h3>
        {(viewerZone === null || viewerZone === dock.zone || here.length > 0) && (
          <Link to={`/app/log?dock=${String(dock.door_number)}`} className="btn btn-secondary">
            <FileText size={18} aria-hidden="true" /> Open this dock’s issues
          </Link>
        )}
      </div>
      <QueryBoundary query={issues} loading="Loading issues">
        {() => (
          <>
            {here.length === 0 && elsewhere === 0 && (
              <p className="text-base text-ink-mute">No open issues at this door.</p>
            )}
            {here.length > 0 && (
              <ul className="-mx-2 flex flex-col">
                {[...here].sort(bySeverityThenAge).map((issue) => (
                  <IssueRow key={issue.id} issue={issue} now={now} canTake={viewerRole === 'supervisor'} />
                ))}
              </ul>
            )}
            {elsewhere > 0 && (
              <Notice title={`${String(elsewhere)} ${here.length > 0 ? 'more ' : ''}${noun(elsewhere)}`}>
                Handled by {owner}. They are not in your view.
              </Notice>
            )}
          </>
        )}
      </QueryBoundary>
    </section>
  );
}

function IssueRow({ issue, now, canTake }: { issue: Issue; now: number; canTake: boolean }) {
  const acknowledge = useAcknowledge();
  const takeable = canTake && issue.status === 'escalated' && !issue.acknowledged_at;
  return (
    <li className="border-b border-hairline last:border-b-0">
      <div className="flex items-center gap-2 pr-2">
        <Link
          to={`/app/issues/${issue.id}`}
          className="my-1 flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 transition-colors hover:bg-paper"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={issue.severity} size="sm" />
              <IssueGroupDot issueType={issue.issue_type} />
              <span className="heading text-base">{issue.issue_subtype ?? issue.issue_type}</span>
              {issue.simulated && <SimulatedTag compact />}
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-mute">
              <IssueStatusTag status={issue.status} />
              <span className="telemetry">
                #{issue.id} · {elapsed(issue.created_at, now)}
              </span>
              {issue.operator_name && <span>{issue.operator_name}</span>}
            </span>
            {issue.acknowledged_at && (
              <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft">
                <Footprints size={15} aria-hidden="true" />
                Taken by {issue.acknowledged_by_name ?? 'a supervisor'}
              </span>
            )}
          </span>
          {!takeable && <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-mute" />}
        </Link>
        {takeable && (
          <button
            type="button"
            className="btn btn-secondary shrink-0"
            disabled={acknowledge.isPending}
            onClick={() => acknowledge.mutate(issue.id)}
            aria-label={`On my way to issue ${String(issue.id)}`}
          >
            <Footprints size={18} aria-hidden="true" /> On my way
          </button>
        )}
      </div>
      {acknowledge.error && (
        <div className="pb-2">
          <MutationError error={acknowledge.error} />
        </div>
      )}
    </li>
  );
}
