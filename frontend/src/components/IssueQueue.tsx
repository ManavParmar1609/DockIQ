import { Camera, Repeat2 } from 'lucide-react';
import { Link } from 'react-router';

import type { Issue } from '../api/types';
import { elapsed, formatMoney } from '../lib/format';
import { useNow } from '../lib/useNow';
import { bySeverityThenAge } from '../lib/vocab';
import { SeverityBadge } from './Severity';
import { EmptyState, SimulatedTag } from './ui';

/** Critical first, then oldest first — the triage order from Scenario 5. */
export function IssueQueue({ issues, empty }: { issues: Issue[]; empty: string }) {
  const now = useNow();
  if (issues.length === 0) return <EmptyState title={empty} />;
  return (
    <ol className="flex flex-col gap-2">
      {[...issues].sort(bySeverityThenAge).map((issue) => {
        const critical = issue.severity === 'critical';
        return (
          <li key={issue.id}>
            <Link
              to={`/app/issues/${issue.id}`}
              className={`flex border-2 bg-light hover:bg-paper-sunk ${critical ? 'border-hazard' : 'border-ink'}`}
            >
              {critical && <span className="hazard-tape w-3 shrink-0" aria-hidden="true" />}
              <span className="grid w-20 shrink-0 place-items-center border-r-2 border-ink py-3 text-center">
                <span className="label">Dock</span>
                <span className="display text-4xl">{issue.door_number ?? '—'}</span>
              </span>
              <span className="min-w-0 flex-1 p-3">
                <span className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={issue.severity} size="sm" />
                  <span className="heading text-lg">{issue.issue_subtype ?? issue.issue_type}</span>
                  {issue.simulated && <SimulatedTag compact />}
                </span>
                <span className="mt-1 block truncate text-base text-ink-soft">
                  {issue.operator_name}
                  {issue.company_name && ` · ${issue.company_name}`}
                  {issue.product_name && ` · ${issue.product_name}`}
                </span>
                <span className="telemetry mt-1.5 flex flex-wrap gap-x-4 text-sm text-ink-mute">
                  <span>#{issue.id}</span>
                  {issue.estimated_cost_impact > 0 && <span>{formatMoney(issue.estimated_cost_impact)}</span>}
                  {issue.photo_count > 0 && (
                    <span className="flex items-center gap-1">
                      <Camera size={14} aria-hidden="true" />
                      {issue.photo_count}
                    </span>
                  )}
                  {issue.recurring_patterns.length > 0 && (
                    <span className="flex items-center gap-1 text-ink">
                      <Repeat2 size={14} aria-hidden="true" /> Recurring
                    </span>
                  )}
                </span>
              </span>
              <span className="flex w-24 shrink-0 flex-col items-end justify-center border-l-2 border-ink p-3 text-right">
                <span className="label">Waiting</span>
                <span className="telemetry text-xl">
                  {elapsed(issue.escalated_at ?? issue.created_at, now)}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
