import { ArrowDown, ArrowUp, Download, Search, X } from 'lucide-react';
import { useDeferredValue, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import {
  useCarriers,
  useDocks,
  useExportIssues,
  useIssues,
  useTaxonomy,
  type IssueFilters,
} from '../../api/hooks';
import type { Issue, IssueStatus, Severity } from '../../api/types';
import { SeverityBadge, severityLabel } from '../../components/Severity';
import {
  EmptyState,
  FieldLabel,
  IssueStatusTag,
  MutationError,
  PageHeader,
  QueryBoundary,
  SimulatedTag,
} from '../../components/ui';
import { formatDateTime, formatMoney } from '../../lib/format';
import { ISSUE_STATUS, SEVERITY_ORDER } from '../../lib/vocab';

const LIMIT = 500;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

type SortKey = 'id' | 'created' | 'severity' | 'issue' | 'dock' | 'operator' | 'customer' | 'status' | 'cost';

const COLUMNS: readonly { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'id', label: '#' },
  { key: 'created', label: 'Reported' },
  { key: 'severity', label: 'Severity' },
  { key: 'issue', label: 'Issue' },
  { key: 'dock', label: 'Dock' },
  { key: 'operator', label: 'Operator' },
  { key: 'customer', label: 'Customer' },
  { key: 'status', label: 'Status' },
  { key: 'cost', label: 'Cost', numeric: true },
];

const SORTERS: Record<SortKey, (a: Issue, b: Issue) => number> = {
  id: (a, b) => a.id - b.id,
  created: (a, b) => a.created_at.localeCompare(b.created_at),
  severity: (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  issue: (a, b) => (a.issue_subtype ?? a.issue_type).localeCompare(b.issue_subtype ?? b.issue_type),
  dock: (a, b) => (a.door_number ?? 0) - (b.door_number ?? 0),
  operator: (a, b) => (a.operator_name ?? '').localeCompare(b.operator_name ?? ''),
  customer: (a, b) => (a.company_name ?? '').localeCompare(b.company_name ?? ''),
  status: (a, b) => ISSUE_STATUS[a.status].label.localeCompare(ISSUE_STATUS[b.status].label),
  cost: (a, b) => a.estimated_cost_impact - b.estimated_cost_impact,
};

function isSeverity(value: string | null): value is Severity {
  return SEVERITY_ORDER.some((level) => level === value);
}

function isStatus(value: string | null): value is IssueStatus | 'active' {
  return value === 'active' || (value !== null && value in ISSUE_STATUS);
}

function isSortKey(value: string | null): value is SortKey {
  return COLUMNS.some((column) => column.key === value);
}

function positive(value: string | null): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

/** Every filter lives in the URL, so it survives a refresh and the back button. */
function filtersFrom(params: URLSearchParams) {
  const severity = params.get('severity');
  const status = params.get('status');
  const sort = params.get('sort');
  const from = params.get('from');
  const to = params.get('to');
  const server: IssueFilters = { limit: LIMIT };
  if (isSeverity(severity)) server.severity = severity;
  if (isStatus(status)) server.status = status;
  const dock = positive(params.get('dock'));
  if (dock !== undefined) server.dock = dock;
  const carrier = positive(params.get('carrier'));
  if (carrier !== undefined) server.carrier_id = carrier;
  if (from && DAY.test(from)) server.from = from;
  if (to && DAY.test(to)) server.to = to;
  return {
    server,
    query: params.get('q') ?? '',
    type: params.get('type') ?? '',
    sort: isSortKey(sort) ? sort : 'created',
    descending: params.get('dir') !== 'asc',
  };
}

function matches(issue: Issue, query: string): boolean {
  if (!query) return true;
  const haystack = [
    issue.issue_type,
    issue.issue_subtype,
    issue.operator_name,
    issue.company_name,
    issue.carrier_name,
    issue.order_number,
    issue.trailer_number,
    issue.lot,
    issue.description,
    `#${String(issue.id)}`,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export default function IssueLog() {
  const [params, setParams] = useSearchParams();
  const { server, query, type, sort, descending } = filtersFrom(params);
  const issues = useIssues(server);
  const taxonomy = useTaxonomy();
  const docks = useDocks();
  const carriers = useCarriers();
  const exporter = useExportIssues();
  const navigate = useNavigate();
  const deferred = useDeferredValue(query);

  const set = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };
  const sortBy = (key: SortKey) => {
    const next = new URLSearchParams(params);
    next.set('sort', key);
    next.set('dir', sort === key && descending ? 'asc' : 'desc');
    setParams(next, { replace: true });
  };
  const filtered = [...params.keys()].some((key) => key !== 'sort' && key !== 'dir');

  const shown = useMemo(() => {
    const rows = (issues.data ?? []).filter(
      (issue) => matches(issue, deferred) && (!type || issue.issue_type === type),
    );
    const compare = SORTERS[sort];
    return rows.sort((a, b) => (descending ? -1 : 1) * compare(a, b) || b.id - a.id);
  }, [issues.data, deferred, type, sort, descending]);

  const download = () =>
    exporter.mutate(server, {
      onSuccess: (blob) => saveFile(blob, `dockiq-issues-${new Date().toISOString().slice(0, 10)}.csv`),
    });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        kicker="Every issue in your scope"
        title="Issue log"
        meta={
          <span className="telemetry">
            {shown.length} of {issues.data?.length ?? 0}
            {issues.data?.length === LIMIT && ' (newest 500 — narrow the dates to see older)'}
          </span>
        }
        actions={
          <>
            {filtered && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setParams(new URLSearchParams(), { replace: true })}
              >
                <X size={18} aria-hidden="true" /> Clear filters
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={exporter.isPending}
              onClick={download}
            >
              <Download size={18} aria-hidden="true" /> {exporter.isPending ? 'Preparing…' : 'Export CSV'}
            </button>
          </>
        }
      />
      <MutationError error={exporter.error} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-4">
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
            onChange={(event) => set('q', event.target.value)}
            placeholder="Search type, person, customer, order, trailer, lot, #id"
          />
        </div>
        <select
          aria-label="Severity"
          className="field"
          value={server.severity ?? ''}
          onChange={(event) => set('severity', event.target.value)}
        >
          <option value="">All severities</option>
          {SEVERITY_ORDER.map((level) => (
            <option key={level} value={level}>
              {severityLabel(level)}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          className="field"
          value={server.status ?? ''}
          onChange={(event) => set('status', event.target.value)}
        >
          <option value="">All statuses</option>
          <option value="active">Open (any)</option>
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
          onChange={(event) => set('type', event.target.value)}
        >
          <option value="">All types</option>
          {(taxonomy.data?.issue_types ?? []).map((spec) => (
            <option key={spec.name} value={spec.name}>
              {spec.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Dock"
          className="field"
          value={server.dock ?? ''}
          onChange={(event) => set('dock', event.target.value)}
        >
          <option value="">All docks</option>
          {(docks.data ?? []).map((dock) => (
            <option key={dock.id} value={dock.door_number}>
              Dock {dock.door_number} · {dock.zone}
            </option>
          ))}
        </select>
        <select
          aria-label="Carrier"
          className="field self-end"
          value={server.carrier_id ?? ''}
          onChange={(event) => set('carrier', event.target.value)}
        >
          <option value="">All carriers</option>
          {(carriers.data ?? []).map((carrier) => (
            <option key={carrier.id} value={carrier.id}>
              {carrier.name}
            </option>
          ))}
        </select>
        <div>
          <FieldLabel htmlFor="log-from">From</FieldLabel>
          <input
            id="log-from"
            type="date"
            className="field"
            value={server.from ?? ''}
            max={server.to}
            onChange={(event) => set('from', event.target.value)}
          />
        </div>
        <div>
          <FieldLabel htmlFor="log-to">To</FieldLabel>
          <input
            id="log-to"
            type="date"
            className="field"
            value={server.to ?? ''}
            min={server.from}
            onChange={(event) => set('to', event.target.value)}
          />
        </div>
      </div>

      <QueryBoundary query={issues} loading="Loading the log">
        {() =>
          shown.length === 0 ? (
            <EmptyState title="No issues match">
              {filtered
                ? 'Clear a filter or widen the dates.'
                : 'Nothing has been reported in your scope yet.'}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto card">
              <table className="w-full min-w-max text-left">
                <thead className="border-b border-hairline bg-paper-sunk">
                  <tr>
                    {COLUMNS.map((column) => {
                      const active = sort === column.key;
                      return (
                        <th
                          key={column.key}
                          scope="col"
                          aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}
                          className={`px-1 py-1 ${column.numeric ? 'text-right' : ''}`}
                        >
                          <button
                            type="button"
                            onClick={() => sortBy(column.key)}
                            className={`label inline-flex min-h-11 items-center gap-1 rounded-full px-2 hover:bg-paper ${active ? 'text-ink' : ''}`}
                          >
                            {column.label}
                            {active &&
                              (descending ? (
                                <ArrowDown size={14} aria-hidden="true" />
                              ) : (
                                <ArrowUp size={14} aria-hidden="true" />
                              ))}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((issue) => (
                    <tr
                      key={issue.id}
                      tabIndex={0}
                      onClick={() => void navigate(`/app/issues/${String(issue.id)}`)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void navigate(`/app/issues/${String(issue.id)}`);
                      }}
                      className="cursor-pointer border-b border-hairline hover:bg-paper-sunk"
                    >
                      <td className="telemetry px-3 py-3">{issue.id}</td>
                      <td className="telemetry px-3 py-3 text-sm">{formatDateTime(issue.created_at)}</td>
                      <td className="px-3 py-3">
                        <SeverityBadge severity={issue.severity} size="sm" />
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex items-center gap-2 font-semibold">
                          {issue.issue_subtype ?? issue.issue_type}
                          {issue.simulated && <SimulatedTag compact />}
                        </span>
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
