import { Camera, ChevronRight, Repeat2 } from 'lucide-react';
import { Link } from 'react-router';

import type { Issue } from '../api/types';
import { elapsed, formatMoney } from '../lib/format';
import { useNow } from '../lib/useNow';
import { bySeverityThenAge } from '../lib/vocab';
import { SeverityBadge } from './Severity';
import { EmptyState, SimulatedTag } from './ui';

/** Critical first, then oldest first — the triage order from Scenario 5. An inset grouped list. */
export function IssueQueue({ issues, empty }: { issues: Issue[]; empty: string }) {
  const now = useNow();
  if (issues.length === 0) return <EmptyState title={empty} />;
  return (
    <ol className="-mx-2 flex flex-col">
      {[...issues].sort(bySeverityThenAge).map((issue) => {
        const critical = issue.severity === 'critical';
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
                  {issue.simulated && <SimulatedTag compact />}
                </span>
                <span className="mt-0.5 block truncate text-sm text-ink-mute">
                  {issue.operator_name}
                  {issue.company_name && ` · ${issue.company_name}`}
                  {issue.product_name && ` · ${issue.product_name}`}
                </span>
                <span className="telemetry mt-1 flex flex-wrap gap-x-3 text-sm font-medium text-ink-mute">
                  <span>#{issue.id}</span>
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
                <span className="text-xs font-medium text-ink-mute">Waiting</span>
                <span className="telemetry text-lg whitespace-nowrap">
                  {elapsed(issue.escalated_at ?? issue.created_at, now)}
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
