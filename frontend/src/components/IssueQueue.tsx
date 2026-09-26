import {
  AlarmClock,
  Camera,
  ChevronRight,
  Footprints,
  PackageX,
  PauseCircle,
  Repeat2,
  ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router';

import { useTaxonomy } from '../api/hooks';
import type { Issue } from '../api/types';
import { elapsed, formatMoney, formatTemp } from '../lib/format';
import { awaitsDisposition, byUrgency, overdueLabel, waitingSince } from '../lib/triage';
import { useNow } from '../lib/useNow';
import { DISPOSITION } from '../lib/vocab';
import { FlipList } from './FlipList';
import { IssueGroupDot } from './IssueGroup';
import { SeverityBadge } from './Severity';
import { EmptyState, SimulatedTag, Tag } from './ui';

/** Whose eyes the queue is for: the supervisor decides the issue, Quality decides the product. */
export type QueueView = 'supervisor' | 'quality';

/** Who has it: taken ("on my way"), waiting on someone else, or nobody yet. */
function Holder({ issue, now }: { issue: Issue; now: number }) {
  if (issue.status === 'on_hold') {
    return (
      <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft">
        <PauseCircle size={15} aria-hidden="true" />
        {issue.pending_action ?? issue.resolution_type ?? 'On hold'}
      </span>
    );
  }
  if (issue.acknowledged_at) {
    return (
      <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft">
        <Footprints size={15} aria-hidden="true" />
        Taken by {issue.acknowledged_by_name ?? 'a supervisor'} · {elapsed(issue.acknowledged_at, now)}
      </span>
    );
  }
  if (issue.status === 'escalated') {
    return <span className="text-sm font-semibold text-ink-soft">Waiting — nobody has taken it</span>;
  }
  return null;
}

/** Quality's side of the same issue: the product decision, then where the supervisor is with it. */
function QualityHolder({ issue }: { issue: Issue }) {
  const held = issue.held_pallets?.length ?? 0;
  if (issue.disposition) {
    return (
      <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft">
        <ShieldCheck size={15} aria-hidden="true" />
        Disposition recorded: {DISPOSITION[issue.disposition]}
      </span>
    );
  }
  if (awaitsDisposition(issue)) {
    return (
      <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <PackageX size={15} aria-hidden="true" />
        Awaiting your disposition
        {held > 0 && ` · ${String(held)} ${held === 1 ? 'pallet' : 'pallets'} held`}
      </span>
    );
  }
  const supervisor =
    issue.status === 'on_hold'
      ? `On hold with the supervisor: ${issue.pending_action ?? 'awaiting a decision'}`
      : issue.acknowledged_at
        ? `${issue.acknowledged_by_name ?? 'A supervisor'} is on it`
        : issue.status === 'escalated'
          ? 'With the supervisor, not taken yet'
          : 'Being worked at the dock';
  return <span className="text-sm font-semibold text-ink-soft">{supervisor}</span>;
}

function stateWord(issue: Issue, view: QueueView): string {
  if (view === 'quality') {
    if (issue.disposition) return 'Disposed';
    if (awaitsDisposition(issue)) return 'Your call';
    return 'With supervisor';
  }
  return issue.status === 'on_hold' ? 'On hold' : issue.acknowledged_at ? 'Taken' : 'Waiting';
}

/**
 * Critical first; within a severity the most overdue first, then the oldest (business-rules §7.4). An
 * inset grouped list whose rows glide to their new place as the queue changes; critical rows never move
 * but by jumping.
 */
export function IssueQueue({
  issues,
  empty,
  view = 'supervisor',
}: {
  issues: Issue[];
  empty: string;
  view?: QueueView;
}) {
  const now = useNow();
  const targets = useTaxonomy().data?.decision_targets;
  if (issues.length === 0) return <EmptyState title={empty} />;
  const sorted = [...issues].sort(byUrgency(targets, now));
  return (
    <FlipList order={sorted.map((issue) => issue.id).join('.')} className="-mx-2 flex flex-col">
      {sorted.map((issue) => {
        const critical = issue.severity === 'critical';
        // The decision target is the supervisor's clock; Quality's rows speak Quality's state instead.
        const overdue = view === 'supervisor' ? overdueLabel(issue, targets, now) : null;
        const state = stateWord(issue, view);
        const held = issue.held_pallets?.length ?? 0;
        // A changed state word cross-fades in; nothing on a critical row animates.
        const fade = critical ? '' : 'state-fade';
        return (
          <li
            key={issue.id}
            data-key={issue.id}
            data-still={critical ? '' : undefined}
            className="border-b border-hairline last:border-b-0"
          >
            <Link
              to={`/app/issues/${issue.id}`}
              className={`my-1 flex items-center gap-3.5 rounded-lg p-2 transition-colors sm:gap-4 ${critical ? 'hover:bg-hazard-soft' : 'hover:bg-paper'}`}
            >
              <span
                className={`grid h-16 w-14 shrink-0 place-content-center rounded-md text-center ${critical ? 'bg-hazard text-white' : 'bg-paper-sunk'}`}
              >
                <span className={`text-xs font-medium ${critical ? 'text-white' : 'text-ink-mute'}`}>
                  Dock
                </span>
                <span className="num text-2xl leading-none">{issue.door_number ?? '—'}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={issue.severity} size="sm" />
                  <IssueGroupDot issueType={issue.issue_type} />
                  <span className="heading text-base sm:text-lg">
                    {issue.issue_subtype ?? issue.issue_type}
                  </span>
                  {overdue && (
                    <Tag>
                      <AlarmClock size={14} aria-hidden="true" /> Overdue{' '}
                      <span className="telemetry">{overdue}</span>
                    </Tag>
                  )}
                  {issue.simulated && <SimulatedTag compact />}
                </span>
                <span className="mt-0.5 block truncate text-sm text-ink-mute">
                  {issue.room ? `${issue.room} · ` : ''}
                  {issue.operator_name}
                  {issue.company_name && ` · ${issue.company_name}`}
                  {issue.product_name && ` · ${issue.product_name}`}
                </span>
                <span key={`${state}-${String(issue.acknowledged_at)}`} className={`mt-1 block ${fade}`}>
                  {view === 'quality' ? <QualityHolder issue={issue} /> : <Holder issue={issue} now={now} />}
                </span>
                <span className="telemetry mt-1 flex flex-wrap gap-x-3 text-sm font-medium text-ink-mute">
                  <span>#{issue.id}</span>
                  {issue.temp_reading != null && (
                    <span>
                      {formatTemp(issue.temp_reading)}
                      {issue.temp_limit != null && ` / ${formatTemp(issue.temp_limit)}`}
                    </span>
                  )}
                  {view === 'quality' && held > 0 && (
                    <span>
                      {held} {held === 1 ? 'pallet' : 'pallets'} held
                    </span>
                  )}
                  {issue.lot && <span>Lot {issue.lot}</span>}
                  {view === 'supervisor' && issue.disposition && (
                    <span>{DISPOSITION[issue.disposition]}</span>
                  )}
                  {issue.estimated_cost_impact > 0 && <span>{formatMoney(issue.estimated_cost_impact)}</span>}
                  {issue.photo_count > 0 && (
                    <span className="flex items-center gap-1">
                      <Camera size={14} aria-hidden="true" />
                      {issue.photo_count}
                    </span>
                  )}
                  {issue.recurring_patterns.length > 0 && (
                    <span className="flex items-center gap-1 text-ink-soft">
                      <Repeat2 size={14} aria-hidden="true" /> Recurring
                    </span>
                  )}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end text-right">
                <span key={state} className={`text-sm font-medium text-ink-mute ${fade}`}>
                  {state}
                </span>
                <span className="telemetry text-lg whitespace-nowrap">
                  {elapsed(waitingSince(issue), now)}
                </span>
              </span>
              <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-mute" />
            </Link>
          </li>
        );
      })}
    </FlipList>
  );
}
