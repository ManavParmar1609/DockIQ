import { AlarmClock, Camera, ChevronRight, Footprints, PauseCircle, Repeat2 } from 'lucide-react';
import { Link } from 'react-router';

import { useTaxonomy } from '../api/hooks';
import type { Issue } from '../api/types';
import { elapsed, formatMoney, formatTemp } from '../lib/format';
import { isOverdue, waitingSince } from '../lib/triage';
import { useNow } from '../lib/useNow';
import { bySeverityThenAge, DISPOSITION } from '../lib/vocab';
import { SeverityBadge } from './Severity';
import { EmptyState, SimulatedTag, Tag } from './ui';

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

/** Critical first, then oldest first — the triage order from Scenario 5. An inset grouped list. */
export function IssueQueue({ issues, empty }: { issues: Issue[]; empty: string }) {
  const now = useNow();
  const targets = useTaxonomy().data?.decision_targets;
  if (issues.length === 0) return <EmptyState title={empty} />;
  return (
    <ol className="-mx-2 flex flex-col">
      {[...issues].sort(bySeverityThenAge).map((issue) => {
        const critical = issue.severity === 'critical';
        const overdue = isOverdue(issue, targets, now);
        const state = issue.status === 'on_hold' ? 'On hold' : issue.acknowledged_at ? 'Taken' : 'Waiting';
        return (
          <li key={issue.id} className="border-b border-hairline last:border-b-0">
            <Link
              to={`/app/issues/${issue.id}`}
              className={`my-1 flex items-center gap-3.5 rounded-lg p-2 transition-colors sm:gap-4 ${critical ? 'bg-hazard-soft hover:bg-hazard-soft' : 'hover:bg-paper'}`}
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
                  <span className="heading text-base sm:text-lg">
                    {issue.issue_subtype ?? issue.issue_type}
                  </span>
                  {overdue && (
                    <Tag tone="ink">
                      <AlarmClock size={14} aria-hidden="true" /> Overdue
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
                <span className="mt-1 block">
                  <Holder issue={issue} now={now} />
                </span>
                <span className="telemetry mt-1 flex flex-wrap gap-x-3 text-sm font-medium text-ink-mute">
                  <span>#{issue.id}</span>
                  {issue.temp_reading != null && (
                    <span>
                      {formatTemp(issue.temp_reading)}
                      {issue.temp_limit != null && ` / ${formatTemp(issue.temp_limit)}`}
                    </span>
                  )}
                  {issue.lot && <span>Lot {issue.lot}</span>}
                  {issue.disposition && <span>{DISPOSITION[issue.disposition]}</span>}
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
                <span className="text-sm font-medium text-ink-mute">{state}</span>
                <span className="telemetry text-lg whitespace-nowrap">
                  {elapsed(waitingSince(issue), now)}
                </span>
              </span>
              <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-mute" />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
