import { Search } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { useIssues, useTaxonomy } from '../../api/hooks';
import type { Issue, IssueStatus, Severity } from '../../api/types';
import { SeverityBadge } from '../../components/Severity';
import { EmptyState, IssueStatusTag, PageHeader, QueryBoundary } from '../../components/ui';
import { formatDateTime, formatMoney } from '../../lib/format';
import { ISSUE_STATUS, SEVERITY_ORDER } from '../../lib/vocab';

function matches(issue: Issue, query: string): boolean {
  if (!query) return true;
  const haystack = [
    issue.issue_type,
    issue.issue_subtype,
    issue.operator_name,
    issue.company_name,
    issue.description,
    `#${issue.id}`,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export default function IssueLog() {
  const issues = useIssues({ limit: 500 });
  const taxonomy = useTaxonomy();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState<Severity | ''>('');
  const [status, setStatus] = useState<IssueStatus | ''>('');
  const [type, setType] = useState('');
  const deferred = useDeferredValue(query);

  const filtered = useMemo(
    () =>
      (issues.data ?? []).filter(
        (issue) =>
          matches(issue, deferred) &&
          (!severity || issue.severity === severity) &&
          (!status || issue.status === status) &&
          (!type || issue.issue_type === type),
      ),
    [issues.data, deferred, severity, status, type],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        kicker="Every issue in your scope"
        title="Issue log"
        meta={
          <span className="telemetry">
            {filtered.length} of {issues.data?.length ?? 0}
          </span>
        }
      />

      <div className="grid gap-2 md:grid-cols-4">
        <div className="relative md:col-span-4 lg:col-span-1">
          <Search
            size={20}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            aria-hidden="true"
          />
          <label htmlFor="log-search" className="sr-only">
            Search
          </label>
          <input
            id="log-search"
            className="field pl-10"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search type, person, customer, #id"
          />
        </div>
        <select
          aria-label="Severity"
          className="field"
          value={severity}
          onChange={(event) => setSeverity(event.target.value as Severity | '')}
        >
          <option value="">All severities</option>
          {SEVERITY_ORDER.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          className="field"
          value={status}
          onChange={(event) => setStatus(event.target.value as IssueStatus | '')}
        >
          <option value="">All statuses</option>
          {(Object.keys(ISSUE_STATUS) as IssueStatus[]).map((value) => (
            <option key={value} value={value}>
              {ISSUE_STATUS[value].label}
            </option>
          ))}
        </select>
        <select
          aria-label="Type"
          className="field"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          <option value="">All types</option>
          {(taxonomy.data?.issue_types ?? []).map((spec) => (
            <option key={spec.name} value={spec.name}>
              {spec.name}
            </option>
          ))}
        </select>
      </div>

      <QueryBoundary query={issues} loading="Loading the log">
        {() =>
          filtered.length === 0 ? (
            <EmptyState title="No issues match" />
          ) : (
            <div className="overflow-x-auto border-2 border-ink bg-light">
              <table className="w-full min-w-max text-left">
                <thead className="border-b-2 border-ink bg-paper-sunk">
                  <tr>
                    {[
                      '#',
                      'Reported',
                      'Severity',
                      'Issue',
                      'Dock',
                      'Operator',
                      'Customer',
                      'Status',
                      'Cost',
                    ].map((heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className={`label px-3 py-3 ${heading === 'Cost' ? 'text-right' : ''}`}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((issue) => (
                    <tr
                      key={issue.id}
                      tabIndex={0}
                      onClick={() => void navigate(`/app/issues/${issue.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void navigate(`/app/issues/${issue.id}`);
                      }}
                      className="cursor-pointer border-b border-hairline hover:bg-paper-sunk"
                    >
                      <td className="telemetry px-3 py-3">{issue.id}</td>
                      <td className="telemetry px-3 py-3 text-sm">{formatDateTime(issue.created_at)}</td>
                      <td className="px-3 py-3">
                        <SeverityBadge severity={issue.severity} size="sm" />
                      </td>
                      <td className="px-3 py-3">
                        <span className="block font-semibold">{issue.issue_subtype ?? issue.issue_type}</span>
                        <span className="text-sm text-ink-mute">{issue.issue_type}</span>
                      </td>
                      <td className="telemetry px-3 py-3">{issue.door_number ?? '—'}</td>
                      <td className="px-3 py-3">{issue.operator_name ?? '—'}</td>
                      <td className="px-3 py-3">{issue.company_name ?? '—'}</td>
                      <td className="px-3 py-3">
                        <IssueStatusTag status={issue.status} />
                      </td>
                      <td className="telemetry px-3 py-3 text-right">
                        {formatMoney(issue.estimated_cost_impact)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </QueryBoundary>
    </div>
  );
}
