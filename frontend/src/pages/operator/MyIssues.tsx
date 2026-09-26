import { Camera, Check } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { useIssues } from '../../api/hooks';
import type { Issue } from '../../api/types';
import { IssueGroupDot, IssueTypeLabel } from '../../components/IssueGroup';
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
      <p className="border-t border-hairline bg-paper-sunk px-5 py-3 text-sm font-semibold text-ink-soft">
        Critical — your supervisor decides
      </p>
    );
  }
  if (!issue.can_self_resolve) return null;
  return (
    <div className="border-t border-hairline bg-paper-sunk px-5 py-3">
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
          className="btn btn-primary w-full"
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
    <li className="card flex flex-col overflow-hidden">
      <Link to={`/app/issues/${issue.id}`} className="flex flex-1 flex-col gap-2 p-5 hover:bg-paper-sunk">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SeverityBadge severity={issue.severity} size="sm" />
          <IssueStatusTag status={issue.status} />
        </div>
        <div>
          {issue.issue_subtype && issue.issue_subtype !== issue.issue_type ? (
            <>
              <p className="heading text-lg">{issue.issue_subtype}</p>
              <p className="text-sm">
                <IssueTypeLabel issueType={issue.issue_type} />
              </p>
            </>
          ) : (
            <p className="heading flex items-center gap-2 text-lg">
              <IssueGroupDot issueType={issue.issue_type} />
              {issue.issue_type}
            </p>
          )}
        </div>
        {issue.description && <p className="line-clamp-2 text-base text-ink-soft">{issue.description}</p>}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-1">
          {waiting && <p className="text-sm font-semibold text-accent-ink">{waiting}</p>}
          <p className="telemetry flex flex-wrap gap-x-3 text-sm text-ink-mute">
            <span>#{issue.id}</span>
            <span>Dock {issue.door_number ?? '—'}</span>
            <span>{formatDateTime(issue.created_at)}</span>
            {issue.photo_count > 0 && (
              <span className="flex items-center gap-1">
                <Camera size={14} aria-hidden="true" /> {issue.photo_count}
              </span>
            )}
          </p>
        </div>
        {issue.supervisor_notes && (
          <p className="rounded-lg bg-accent-soft px-3 py-2 text-base">
            <span className="label block">
              {issue.supervisor_name} · {issue.resolution_type}
            </span>
            {issue.supervisor_notes}
          </p>
        )}
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
            className={`min-h-11 rounded-md text-base font-semibold transition-colors ${filter === option.id ? 'bg-accent text-on-accent' : 'text-ink-mute'}`}
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
