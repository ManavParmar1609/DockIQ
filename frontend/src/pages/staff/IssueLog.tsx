import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, Search, X } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import {
  useCarriers,
  useDocks,
  useExportIssues,
  useIssues,
  useTaxonomy,
  type IssueFilters,
} from '../../api/hooks';
import type { Disposition, Issue, IssueStatus, Severity } from '../../api/types';
import { IssueTypeLabel } from '../../components/IssueGroup';
import { SeverityBadge, severityLabel } from '../../components/Severity';
import {
  EmptyState,
  IssueStatusTag,
  MutationError,
  PageHeader,
  QueryBoundary,
  SimulatedTag,
} from '../../components/ui';
import { formatDateTime, formatMoney } from '../../lib/format';
import { DISPOSITION, ISSUE_STATUS, SEVERITY_ORDER } from '../../lib/vocab';

const LIMIT = 500;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

type SortKey =
  | 'id'
  | 'created'
  | 'severity'
  | 'issue'
  | 'dock'
  | 'operator'
  | 'customer'
  | 'status'
  | 'decision'
  | 'disposition'
  | 'cost';

/** `wide`: shown from xl up; below it the dock rides in the Issue cell and the rest is in the record. */
const COLUMNS: readonly { key: SortKey; label: string; numeric?: boolean; wide?: boolean }[] = [
  { key: 'id', label: '#' },
  { key: 'severity', label: 'Severity' },
  { key: 'issue', label: 'Issue' },
  { key: 'dock', label: 'Dock', wide: true },
  { key: 'operator', label: 'Operator' },
  { key: 'customer', label: 'Customer', wide: true },
  { key: 'status', label: 'Status' },
  { key: 'decision', label: 'Outcome' },
  { key: 'cost', label: 'Cost', numeric: true, wide: true },
];

const DISPOSITIONS = Object.keys(DISPOSITION) as Disposition[];

const SORTERS: Record<SortKey, (a: Issue, b: Issue) => number> = {
  id: (a, b) => a.id - b.id,
  created: (a, b) => a.created_at.localeCompare(b.created_at),
  severity: (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  issue: (a, b) => (a.issue_subtype ?? a.issue_type).localeCompare(b.issue_subtype ?? b.issue_type),
  dock: (a, b) => (a.door_number ?? 0) - (b.door_number ?? 0),
  operator: (a, b) => (a.operator_name ?? '').localeCompare(b.operator_name ?? ''),
  customer: (a, b) => (a.company_name ?? '').localeCompare(b.company_name ?? ''),
  status: (a, b) => ISSUE_STATUS[a.status].label.localeCompare(ISSUE_STATUS[b.status].label),
  decision: (a, b) => (a.resolution_type ?? '').localeCompare(b.resolution_type ?? ''),
  disposition: (a, b) => (a.disposition ?? '').localeCompare(b.disposition ?? ''),
  cost: (a, b) => a.estimated_cost_impact - b.estimated_cost_impact,
};

function isSeverity(value: string | null): value is Severity {
  return SEVERITY_ORDER.some((level) => level === value);
}

function isStatus(value: string | null): value is IssueStatus | 'active' {
  return value === 'active' || (value !== null && value in ISSUE_STATUS);
}

function isDisposition(value: string | null): value is Disposition {
  return DISPOSITIONS.some((option) => option === value);
}

function isSortKey(value: string | null): value is SortKey {
  return value === 'created' || COLUMNS.some((column) => column.key === value);
}

function positive(value: string | null): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

/** Every filter lives in the URL, so it survives a refresh, the back button and a drill-down link. */
function filtersFrom(params: URLSearchParams) {
  const severity = params.get('severity');
  const status = params.get('status');
  const disposition = params.get('disposition');
  const type = params.get('type');
  const sort = params.get('sort');
  const from = params.get('from');
  const to = params.get('to');
  const server: IssueFilters = { limit: LIMIT };
  if (isSeverity(severity)) server.severity = severity;
  if (isStatus(status)) server.status = status;
  if (isDisposition(disposition)) server.disposition = disposition;
  if (type) server.issue_type = type;
  const dock = positive(params.get('dock'));
  if (dock !== undefined) server.dock = dock;
  const carrier = positive(params.get('carrier'));
  if (carrier !== undefined) server.carrier_id = carrier;
  if (from && DAY.test(from)) server.from = from;
  if (to && DAY.test(to)) server.to = to;
  return {
    server,
    query: params.get('q') ?? '',
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
    issue.resolution_type,
    issue.decided_by_name,
    issue.room ? `Room ${issue.room}` : null,
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

// ── The filter pills: native controls, outlined; a filter that is set reads filled cream ──

function pillTone(active: boolean): string {
  return active ? 'border-ink bg-ink text-paper' : 'border-rule-strong bg-surface text-ink';
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <span className="relative inline-flex">
      <select
        aria-label={label}
        className={`min-h-11 cursor-pointer appearance-none rounded-full border py-2 pr-10 pl-4 text-base font-semibold ${pillTone(value !== '')}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      <ChevronDown
        size={18}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2"
      />
    </span>
  );
}

function FilterDate({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  const tone = pillTone(value !== '');
  return (
    <label className={`inline-flex min-h-11 items-center gap-2 rounded-full border py-1 pr-2 pl-4 ${tone}`}>
      <span className="text-base font-semibold">{label}</span>
      <input
        type="date"
        className={`telemetry min-h-9 rounded-full px-2 text-sm ${tone}`}
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

// ── The table's scroll edge: where it cannot fit, say so at the edge ──

function useOverflow() {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ overflowing: false, atEnd: true });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const overflowing = element.scrollWidth > element.clientWidth + 1;
      const atEnd = element.scrollLeft + element.clientWidth >= element.scrollWidth - 1;
      setEdge((current) =>
        current.overflowing === overflowing && current.atEnd === atEnd ? current : { overflowing, atEnd },
      );
    };
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      element.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, []);
  return { ref, ...edge };
}

/** The decision, who made it, and Quality's disposition, in one cell. */
function Outcome({ issue }: { issue: Issue }) {
  if (!issue.resolution_type && !issue.disposition) return <span className="text-ink-mute">—</span>;
  return (
    <>
      {issue.resolution_type && <span className="block font-semibold">{issue.resolution_type}</span>}
      {issue.decided_by_name && (
        <span className="block text-sm text-ink-soft">by {issue.decided_by_name}</span>
      )}
      {issue.disposition && (
        <span className="mt-1 block text-sm">
          <span className="text-ink-mute">Disposition · </span>
          {DISPOSITION[issue.disposition]}
        </span>
      )}
    </>
  );
}

function LogTable({
  rows,
  sort,
  descending,
  onSort,
}: {
  rows: Issue[];
  sort: SortKey;
  descending: boolean;
  onSort: (key: SortKey) => void;
}) {
  const navigate = useNavigate();
  const { ref, overflowing, atEnd } = useOverflow();
  const open = (issue: Issue) => void navigate(`/app/issues/${String(issue.id)}`);
  const wide = (column: { wide?: boolean }) => (column.wide ? 'hidden xl:table-cell' : '');

  return (
    <div>
      {overflowing && (
        <p className="mb-2 flex items-center gap-1 text-sm text-ink-mute">
          Scroll sideways for every column <ChevronRight size={16} aria-hidden="true" />
        </p>
      )}
      <div className="relative">
        <div ref={ref} className="card overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-hairline bg-paper-sunk">
              <tr>
                {COLUMNS.map((column) => {
                  const active = sort === column.key;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}
                      className={`px-1 py-1 ${column.numeric ? 'text-right' : ''} ${column.key === 'issue' ? 'log-issue' : ''} ${wide(column)}`}
                    >
                      <button
                        type="button"
                        onClick={() => onSort(column.key)}
                        className={`label inline-flex min-h-11 items-center gap-1 rounded-full px-2 whitespace-nowrap hover:bg-paper ${active ? 'text-ink' : ''}`}
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
              {rows.map((issue) => {
                const title = issue.issue_subtype ?? issue.issue_type;
                return (
                  <tr
                    key={issue.id}
                    tabIndex={0}
                    onClick={() => open(issue)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') open(issue);
                    }}
                    className="cursor-pointer border-b border-hairline align-top hover:bg-paper-sunk"
                  >
                    <td className="telemetry px-2 py-3">{issue.id}</td>
                    <td className="px-2 py-3">
                      <SeverityBadge severity={issue.severity} size="sm" />
                    </td>
                    <td className="log-issue px-2 py-3">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
                        {title}
                        {issue.simulated && <SimulatedTag compact />}
                      </span>
                      {title !== issue.issue_type && (
                        <span className="block text-sm">
                          <IssueTypeLabel issueType={issue.issue_type} />
                        </span>
                      )}
                      <span className="telemetry block text-sm text-ink-mute">
                        {formatDateTime(issue.created_at)}
                        {issue.door_number != null && (
                          <span className="xl:hidden"> · Dock {issue.door_number}</span>
                        )}
                      </span>
                    </td>
                    <td className="telemetry hidden px-2 py-3 xl:table-cell">{issue.door_number ?? '—'}</td>
                    <td className="px-2 py-3">{issue.operator_name ?? '—'}</td>
                    <td className="hidden px-2 py-3 xl:table-cell">{issue.company_name ?? '—'}</td>
                    <td className="px-2 py-3">
                      <IssueStatusTag status={issue.status} />
                    </td>
                    <td className="px-2 py-3">
                      <Outcome issue={issue} />
                    </td>
                    <td className="telemetry hidden px-2 py-3 text-right xl:table-cell">
                      {formatMoney(issue.estimated_cost_impact)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {overflowing && !atEnd && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-px right-px flex w-10 items-center justify-center rounded-r-xl border-l border-rule-strong bg-surface text-ink-soft"
          >
            <ChevronRight size={20} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function IssueLog() {
  const [params, setParams] = useSearchParams();
  const { server, query, sort, descending } = filtersFrom(params);
  const issues = useIssues(server);
  const taxonomy = useTaxonomy();
  const docks = useDocks();
  const carriers = useCarriers();
  const exporter = useExportIssues();
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
    const rows = (issues.data ?? []).filter((issue) => matches(issue, deferred));
    const compare = SORTERS[sort];
    return rows.sort((a, b) => (descending ? -1 : 1) * compare(a, b) || b.id - a.id);
  }, [issues.data, deferred, sort, descending]);

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

      <div className="flex flex-col gap-3">
        <div className="relative">
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
            placeholder="Search type, person, decision, customer, order, trailer, lot, #id"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
          <FilterSelect label="Severity" value={server.severity ?? ''} onChange={(v) => set('severity', v)}>
            <option value="">All severities</option>
            {SEVERITY_ORDER.map((level) => (
              <option key={level} value={level}>
                {severityLabel(level)}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Status" value={server.status ?? ''} onChange={(v) => set('status', v)}>
            <option value="">All statuses</option>
            <option value="active">Open (any)</option>
            {(Object.keys(ISSUE_STATUS) as IssueStatus[]).map((value) => (
              <option key={value} value={value}>
                {ISSUE_STATUS[value].label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Type" value={server.issue_type ?? ''} onChange={(v) => set('type', v)}>
            <option value="">All types</option>
            {(taxonomy.data?.issue_types ?? []).map((spec) => (
              <option key={spec.name} value={spec.name}>
                {spec.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Dock"
            value={server.dock === undefined ? '' : String(server.dock)}
            onChange={(v) => set('dock', v)}
          >
            <option value="">All docks</option>
            {(docks.data ?? []).map((dock) => (
              <option key={dock.id} value={dock.door_number}>
                Dock {dock.door_number} · {dock.zone}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Carrier"
            value={server.carrier_id === undefined ? '' : String(server.carrier_id)}
            onChange={(v) => set('carrier', v)}
          >
            <option value="">All carriers</option>
            {(carriers.data ?? []).map((carrier) => (
              <option key={carrier.id} value={carrier.id}>
                {carrier.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Disposition"
            value={server.disposition ?? ''}
            onChange={(v) => set('disposition', v)}
          >
            <option value="">Any disposition</option>
            {DISPOSITIONS.map((value) => (
              <option key={value} value={value}>
                {DISPOSITION[value]}
              </option>
            ))}
          </FilterSelect>
          <FilterDate
            label="From"
            value={server.from ?? ''}
            max={server.to}
            onChange={(v) => set('from', v)}
          />
          <FilterDate label="To" value={server.to ?? ''} min={server.from} onChange={(v) => set('to', v)} />
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
            <LogTable rows={shown} sort={sort} descending={descending} onSort={sortBy} />
          )
        }
      </QueryBoundary>
    </div>
  );
}
