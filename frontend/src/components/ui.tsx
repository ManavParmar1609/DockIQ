/**
 * The shared kit, on the dark stage: carved titles with a bracketed note, surface cards, serif panel
 * titles, pill tags, tabular numbers. Every data view renders through <QueryBoundary> so a failed
 * request shows an error with a retry — never an endless spinner.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import { AlertTriangle, Check, RotateCw } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import { errorMessage } from '../api/client';
import type { IssueStatus } from '../api/types';
import { rovingKeyDown, rovingTabIndex } from '../lib/roving';
import { SeverityMark } from './Severity';
import { ISSUE_STATUS } from '../lib/vocab';

// ── Layout ──

export function PageHeader({
  kicker,
  title,
  meta,
  actions,
  size = 'lg',
}: {
  kicker?: string;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** `md` for record screens whose title is data (an issue subtype) rather than a place. */
  size?: 'lg' | 'md';
}) {
  return (
    <header className="pt-2">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1
          className={`display title-reveal ${size === 'lg' ? 'text-4xl sm:text-5xl' : 'text-3xl sm:text-4xl'}`}
        >
          {title}
        </h1>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {(kicker ?? meta) && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-base text-ink-mute">
          {kicker && <span className="bracket text-sm text-ink-soft">{kicker}</span>}
          {meta}
        </div>
      )}
    </header>
  );
}

/** A section on the stage under a rule, with an optional serif title row. `index` staggers the reveal. */
export function Panel({
  title,
  aside,
  children,
  index,
  className = '',
  flush = false,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  index?: number;
  className?: string;
  flush?: boolean;
}) {
  const style = index === undefined ? undefined : ({ '--i': index } as CSSProperties);
  const body = flush ? (title ? 'pt-2' : '') : title ? 'pt-3 pb-2' : 'py-4';
  return (
    <section className={`panel ${index === undefined ? '' : 'reveal'} ${className}`} style={style}>
      {title && (
        <div className="flex min-h-12 items-center justify-between gap-3 pt-5">
          <h2 className="serif-title text-xl">{title}</h2>
          {aside}
        </div>
      )}
      <div className={body}>{children}</div>
    </section>
  );
}

/** A metric tile, as in Health: small label, big rounded number. `alert` fills it red. */
export function Stat({
  label,
  value,
  sub,
  alert = false,
  index,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  alert?: boolean;
  index?: number;
}) {
  const style = index === undefined ? undefined : ({ '--i': index } as CSSProperties);
  const surface = alert ? 'rounded-xl border border-hazard-line bg-hazard-soft p-4' : 'stat-cell pt-4 pb-2';
  return (
    <div
      className={`flex flex-col justify-between gap-2 ${surface} ${index === undefined ? '' : 'reveal'}`}
      style={style}
    >
      <p
        className={`flex items-center gap-1.5 text-sm font-semibold ${alert ? 'text-hazard-deep' : 'text-ink-mute'}`}
      >
        {alert && <SeverityMark severity="critical" size={13} />}
        {label}
      </p>
      <p className={`num text-4xl leading-none ${alert ? 'text-hazard-deep' : ''}`}>{value}</p>
      {sub && (
        <p className={`text-sm ${alert ? 'font-semibold text-hazard-deep' : 'text-ink-mute'}`}>{sub}</p>
      )}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

export function Definition({
  term,
  children,
  mono = false,
}: {
  term: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="label">{term}</dt>
      <dd className={`text-base ${mono ? 'telemetry' : 'font-semibold'}`}>{children}</dd>
    </div>
  );
}

// ── Status ──

export function Tag({
  children,
  tone = 'plain',
}: {
  children: ReactNode;
  tone?: 'plain' | 'ink' | 'hazard' | 'accent' | 'green';
}) {
  const tones = {
    plain: 'bg-paper-sunk text-ink-soft',
    ink: 'bg-ink text-paper',
    hazard: 'bg-hazard text-white',
    accent: 'bg-accent-soft text-accent-ink',
    green: 'bg-green-soft text-green',
  };
  return <span className={`pill ${tones[tone]}`}>{children}</span>;
}

export function IssueStatusTag({ status }: { status: IssueStatus }) {
  const { label, open } = ISSUE_STATUS[status];
  if (!open) {
    return (
      <Tag tone="green">
        <Check size={14} strokeWidth={3} aria-hidden="true" />
        {label}
      </Tag>
    );
  }
  return <Tag tone={status === 'escalated' ? 'ink' : 'plain'}>{label}</Tag>;
}

/** Rules §2.4.7 — simulated data stays visibly marked as simulated. `compact` marks one record. */
export function SimulatedTag({ compact = false }: { compact?: boolean }) {
  return (
    <span className="pill sim-tag" title={compact ? 'Created by the shift simulator' : undefined}>
      {compact ? 'Sim' : 'Simulated data'}
    </span>
  );
}

// ── Feedback ──

export function Notice({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'alert';
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  if (tone === 'alert') {
    return (
      <div role="alert" className="flex overflow-hidden rounded-xl border border-hazard-line bg-hazard-soft">
        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-3 p-4">
          <div className="flex min-w-0 flex-1 basis-64 gap-3">
            <AlertTriangle size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-hazard-deep" />
            <div className="min-w-0 flex-1">
              <p className="heading text-base text-hazard-deep">{title}</p>
              {children && <div className="mt-1 text-base text-ink">{children}</div>}
            </div>
          </div>
          {action}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-paper-sunk p-4">
      <div>
        <p className="heading text-base">{title}</p>
        {children && <div className="mt-1 text-base text-ink-soft">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon && (
        <div className="grid h-14 w-14 place-items-center rounded-full bg-paper-sunk text-ink-mute">
          {icon}
        </div>
      )}
      <p className="serif-title text-2xl">{title}</p>
      {children && <div className="max-w-md text-base text-ink-mute">{children}</div>}
    </div>
  );
}

/** A skeleton in the shape of a card, labelled for screen readers and for a glance. */
export function LoadingBlock({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="card flex flex-col gap-3 p-5" role="status" aria-label={`${label}…`}>
      <p className="label">{label}…</p>
      <span className="skeleton h-4 w-2/3" />
      <span className="skeleton h-4 w-1/2" />
      <span className="skeleton h-4 w-3/5" />
    </div>
  );
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Notice
      tone="alert"
      title="Could not load this"
      action={
        onRetry && (
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            <RotateCw size={18} aria-hidden="true" /> Retry
          </button>
        )
      }
    >
      {errorMessage(error)}
    </Notice>
  );
}

/**
 * Render a query's loading and error states; children get the data. A failed background refetch
 * keeps the last good data on screen, with a retry above it.
 */
export function QueryBoundary<T>({
  query,
  loading,
  children,
}: {
  query: UseQueryResult<T>;
  loading?: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <LoadingBlock label={loading} />;
  const retry = () => void query.refetch();
  if (query.data === undefined) return <ErrorBlock error={query.error} onRetry={retry} />;
  if (!query.isError) return <>{children(query.data)}</>;
  return (
    <div className="flex flex-col gap-3">
      <Notice
        title="Could not refresh — showing the last update"
        action={
          <button type="button" className="btn btn-secondary" onClick={retry}>
            <RotateCw size={18} aria-hidden="true" /> Retry
          </button>
        }
      >
        {errorMessage(query.error)}
      </Notice>
      {children(query.data)}
    </div>
  );
}

/** A mutation's failure, shown where the action was taken. */
export function MutationError({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="flex items-center gap-2 rounded-md bg-hazard-soft px-3 py-2.5 text-base font-semibold text-hazard-deep"
    >
      <AlertTriangle size={18} aria-hidden="true" className="shrink-0" />
      {errorMessage(error)}
    </p>
  );
}

// ── Forms ──

export function FieldLabel({
  htmlFor,
  children,
  hint,
}: {
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-base font-semibold">{children}</span>
      {hint && <span className="text-sm text-ink-mute">{hint}</span>}
    </label>
  );
}

/** A single-select group of large tiles. */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  columns = 2,
  pills = false,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  columns?: 2 | 3 | 4;
  /** Short, mutually exclusive ranges: a row of pills, the selected one a green highlighter. */
  pills?: boolean;
}) {
  const grid = { 2: 'grid-cols-2', 3: 'grid-cols-2 sm:grid-cols-3', 4: 'grid-cols-2 sm:grid-cols-4' }[
    columns
  ];
  const selected = options.findIndex((option) => option.value === value);
  const select = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
  };
  return (
    <fieldset>
      <legend className="mb-2 text-base font-semibold">{label}</legend>
      <div
        className={pills ? 'flex flex-wrap gap-2' : `grid gap-2 ${grid}`}
        role="radiogroup"
        aria-label={label}
        onKeyDown={rovingKeyDown('radio', selected, options.length, select)}
      >
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            tabIndex={rovingTabIndex(index, selected)}
            className={`choice justify-center text-center text-balance ${pills ? 'choice-pill' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
