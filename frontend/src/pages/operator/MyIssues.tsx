import { Camera } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { useIssues } from '../../api/hooks';
import type { Issue } from '../../api/types';
import { SeverityBadge } from '../../components/Severity';
import { EmptyState, IssueStatusTag, PageHeader, QueryBoundary } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { ISSUE_STATUS } from '../../lib/vocab';

const FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' },
] as const;

function IssueCard({ issue }: { issue: Issue }) {
  return (
    <li>
      <Link to={`/app/issues/${issue.id}`} className="block card hover:bg-paper-sunk">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2">
          <SeverityBadge severity={issue.severity} size="sm" />
          <IssueStatusTag status={issue.status} />
        </div>
        <div className="px-4 py-3">
          <p className="heading text-xl">{issue.issue_subtype ?? issue.issue_type}</p>
          <p className="mt-0.5 text-ink-soft">{issue.issue_type}</p>
          {issue.description && <p className="mt-2 line-clamp-2 text-base">{issue.description}</p>}
          {issue.status === 'resolution_in_progress' && issue.severity !== 'critical' && (
            <p className="mt-2 text-base font-semibold text-accent-ink">Open it to resolve it yourself</p>
          )}
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
    </li>
  );
}

export default function MyIssues() {
  const issues = useIssues({ limit: 200 });
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
          const shown = list.filter((issue) =>
            filter === 'all'
              ? true
              : filter === 'open'
                ? ISSUE_STATUS[issue.status].open
                : !ISSUE_STATUS[issue.status].open,
          );
          return shown.length === 0 ? (
            <EmptyState title={filter === 'open' ? 'Nothing open' : 'Nothing here'} />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {shown.map((issue) => (
                <IssueCard key={issue.id} issue={issue} />
              ))}
            </ul>
          );
        }}
      </QueryBoundary>
    </div>
  );
}
