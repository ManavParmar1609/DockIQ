import { ChevronRight, DoorOpen, X } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type SyntheticEvent } from 'react';
import { Link } from 'react-router';

import { ApiError } from '../api/client';
import { useIssues, useOrder } from '../api/hooks';
import type { Dock, Issue, OrderDetail } from '../api/types';
import { elapsed, formatNumber, percent, timeAgo } from '../lib/format';
import { useNow } from '../lib/useNow';
import { bySeverityThenAge, DOCK_STATUS, LIFECYCLE } from '../lib/vocab';
import { SeverityBadge } from './Severity';
import { Definition, EmptyState, IssueStatusTag, Notice, QueryBoundary, SimulatedTag, Tag } from './ui';

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
}: {
  dock: Dock | null;
  onClose: () => void;
  returnFocus: (door: number) => void;
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
              <p className="label">{dock.zone}</p>
              <h2 id="dock-sheet-title" className="display text-3xl">
                Dock {dock.door_number}
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className={`pill ${STATUS_PILL[dock.status]}`}>{DOCK_STATUS[dock.status]}</span>
                {dock.lifecycle_phase !== 'idle' && <Tag>{LIFECYCLE[dock.lifecycle_phase]}</Tag>}
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
          <DockBody dock={dock} />
        </div>
      )}
    </dialog>
  );
}

function DockBody({ dock }: { dock: Dock }) {
  const now = useNow();
  const idle = dock.status === 'idle' && dock.current_order_id === null;

  if (idle) {
    return (
      <div className="flex flex-col gap-6 px-6 pb-8">
        <EmptyState title="This door is idle" icon={<DoorOpen size={26} aria-hidden="true" />}>
          No trailer and no order. It fills when the yard assigns the next appointment.
        </EmptyState>
        <OpenIssues dock={dock} now={now} hideWhenEmpty />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 px-6 pt-5 pb-8">
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
      <CurrentOrder dock={dock} now={now} />
      <OpenIssues dock={dock} now={now} />
    </div>
  );
}

function CurrentOrder({ dock, now }: { dock: Dock; now: number }) {
  const order = useOrder(dock.current_order_id ?? undefined);
  const otherTeam = order.error instanceof ApiError && order.error.status === 404;

  return (
    <section aria-labelledby="dock-sheet-order" className="flex flex-col gap-4">
      <h3 id="dock-sheet-order" className="heading text-xl">
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
          {(detail) => <OrderSummary order={detail} now={now} />}
        </QueryBoundary>
      )}
    </section>
  );
}

function OrderSummary({ order, now }: { order: OrderDetail; now: number }) {
  const outbound = order.type === 'outbound';
  const expected = order.items.reduce((sum, item) => sum + item.expected_quantity, 0);
  const counted = order.items.reduce((sum, item) => sum + item.actual_quantity, 0);
  const share = percent(counted, expected);
  const blockers = order.completion_blockers ?? [];

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
  hideWhenEmpty = false,
}: {
  dock: Dock;
  now: number;
  hideWhenEmpty?: boolean;
}) {
  // The same query the floor already holds, so it is shared and invalidated by the realtime channel.
  const issues = useIssues({ status: 'active' });
  const here = (issues.data ?? []).filter((issue) => issue.dock_door_id === dock.id);
  if (hideWhenEmpty && here.length === 0) return null;

  return (
    <section aria-labelledby="dock-sheet-issues" className="flex flex-col gap-3">
      <h3 id="dock-sheet-issues" className="heading text-xl">
        Open issues
      </h3>
      <QueryBoundary query={issues} loading="Loading issues">
        {() =>
          here.length === 0 ? (
            <p className="text-base text-ink-mute">No open issues at this door.</p>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {[...here].sort(bySeverityThenAge).map((issue) => (
                <IssueRow key={issue.id} issue={issue} now={now} />
              ))}
            </ul>
          )
        }
      </QueryBoundary>
    </section>
  );
}

function IssueRow({ issue, now }: { issue: Issue; now: number }) {
  return (
    <li className="border-b border-hairline last:border-b-0">
      <Link
        to={`/app/issues/${issue.id}`}
        className="my-1 flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-paper"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={issue.severity} size="sm" />
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
        </span>
        <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-mute" />
      </Link>
    </li>
  );
}
