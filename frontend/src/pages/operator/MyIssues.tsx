import { Camera, Check } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { useIssues } from '../../api/hooks';
import type { Issue } from '../../api/types';
import { SelfResolveForm } from '../../components/SelfResolve';
import { SeverityBadge } from '../../components/Severity';
import { EmptyState, IssueStatusTag, PageHeader, QueryBoundary } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import { ISSUE_STATUS } from '../../lib/vocab';

const FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' },
] as const;

/** "This shift": the last twelve hours, the same window as a supervisor's handoff draft. */
const SHIFT_MS = 12 * 60 * 60 * 1000;

/** What an open issue is waiting on, in the worker's words. */
function waitingOn(issue: Issue): string | null {
  if (issue.status === 'on_hold') return issue.pending_action ?? 'On hold: waiting on the next step';
  if (issue.status === 'escalated' && issue.acknowledged_by_name) {
    return `${issue.acknowledged_by_name} is on the way`;
  }
  if (issue.status === 'escalated') return 'Waiting for your supervisor';
  return null;
}

/** Close it here, without opening it: any open issue of theirs that is not critical or on hold (§7.5). */
function ResolveInline({ issue }: { issue: Issue }) {
  const [open, setOpen] = useState(false);
  if (issue.severity === 'critical' && ISSUE_STATUS[issue.status].open) {
    return (
      <p className="border-t border-hairline px-4 py-3 text-base font-semibold">
        Your supervisor decides — critical
      </p>
    );
  }
  if (!issue.can_self_resolve) return null;
  return (
    <div className="border-t border-hairline px-4 py-3">
      {open ? (
        <SelfResolveForm
          issueId={issue.id}
          needsNote={issue.self_resolve_needs_note === true}
          onResolved={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      ) : (
        <button
          type="button"
          className="btn btn-secondary w-full"
          aria-label={`Resolve it yourself: issue #${String(issue.id)}`}
          onClick={() => setOpen(true)}
        >
          <Check size={20} aria-hidden="true" /> Resolve it yourself
        </button>
      )}
    </div>
  );
}

function IssueCard({ issue }: { issue: Issue }) {
  const waiting = waitingOn(issue);
  return (
    <li className="card overflow-hidden">
      <Link to={`/app/issues/${issue.id}`} className="block hover:bg-paper-sunk">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2">
          <SeverityBadge severity={issue.severity} size="sm" />
          <IssueStatusTag status={issue.status} />
        </div>
        <div className="px-4 py-3">
          <p className="heading text-xl">{issue.issue_subtype ?? issue.issue_type}</p>
          <p className="mt-0.5 text-ink-soft">{issue.issue_type}</p>
          {issue.description && <p className="mt-2 line-clamp-2 text-base">{issue.description}</p>}
          {waiting && <p className="mt-2 text-base font-semibold">{waiting}</p>}
          <p className="telemetry mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-mute">
            <span>#{issue.id}</span>
            <span>Dock {issue.door_number ?? '—'}</span>
            <span>{formatDateTime(issue.created_at)}</span>
            {issue.photo_count > 0 && (
              <span className="flex items-center gap-1">
                <Camera size={14} aria-hidden="true" /> {issue.photo_count}
              </span>
            )}
          </p>
          {issue.supervisor_notes && (
            <p className="mt-3 rounded-lg bg-paper-sunk px-3 py-2 text-base">
              <span className="label block">
                {issue.supervisor_name} · {issue.resolution_type}
              </span>
              {issue.supervisor_notes}
            </p>
          )}
        </div>
      </Link>
      <ResolveInline issue={issue} />
    </li>
  );
}

function IssueGrid({ issues }: { issues: Issue[] }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {issues.map((issue) => (
        <IssueCard key={issue.id} issue={issue} />
      ))}
    </ul>
  );
}

const newestFirst = (a: Issue, b: Issue) => b.created_at.localeCompare(a.created_at);

export default function MyIssues() {
  const issues = useIssues({ limit: 200 });
  const now = useNow(60_000);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('open');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader kicker="Everything you reported" title="My issues" />
      <div
        role="tablist"
        aria-label="Filter"
        className="grid grid-cols-3 gap-1 rounded-lg bg-paper-sunk p-1 sm:max-w-md"
      >
        {FILTERS.map((option) => (
          <button
            key={option.id}
            role="tab"
            type="button"
            aria-selected={filter === option.id}
            onClick={() => setFilter(option.id)}
            className={`min-h-11 rounded-md text-base font-semibold transition-colors ${filter === option.id ? 'bg-surface text-ink shadow-card' : 'text-ink-mute'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <QueryBoundary query={issues}>
        {(list) => {
          const shown = list
            .filter((issue) =>
              filter === 'all'
                ? true
                : filter === 'open'
                  ? ISSUE_STATUS[issue.status].open
                  : !ISSUE_STATUS[issue.status].open,
            )
            .sort(newestFirst);
          if (shown.length === 0) {
            return <EmptyState title={filter === 'open' ? 'Nothing open' : 'Nothing here'} />;
          }
          if (filter !== 'open') return <IssueGrid issues={shown} />;
          // Open: this shift's first, then anything older still waiting.
          const recent = shown.filter((issue) => now - Date.parse(issue.created_at) < SHIFT_MS);
          const earlier = shown.filter((issue) => now - Date.parse(issue.created_at) >= SHIFT_MS);
          return (
            <div className="flex flex-col gap-6">
              {recent.length > 0 && (
                <section aria-labelledby="open-this-shift" className="flex flex-col gap-3">
                  <h2 id="open-this-shift" className="heading text-lg">
                    This shift <span className="telemetry text-base text-ink-mute">{recent.length}</span>
                  </h2>
                  <IssueGrid issues={recent} />
                </section>
              )}
              {earlier.length > 0 && (
                <section aria-labelledby="open-earlier" className="flex flex-col gap-3">
                  <h2 id="open-earlier" className="heading text-lg">
                    Earlier <span className="telemetry text-base text-ink-mute">{earlier.length}</span>
                  </h2>
                  <IssueGrid issues={earlier} />
                </section>
              )}
            </div>
          );
        }}
      </QueryBoundary>
    </div>
  );
}
