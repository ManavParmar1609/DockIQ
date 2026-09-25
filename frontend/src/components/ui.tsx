/**
 * The shared kit. Square corners, visible rules, mono telemetry. Every data view renders through
 * <QueryBoundary> so a failed request shows an error with a retry — never an endless spinner.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import { AlertTriangle, RotateCw } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import { errorMessage } from '../api/client';
import type { Dock, IssueStatus } from '../api/types';
import { DOCK_STATUS, ISSUE_STATUS } from '../lib/vocab';

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
    <header className="border-b-2 border-ink pb-5">
      {kicker && <p className="label mb-3">{kicker}</p>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1
          className={`display ${size === 'lg' ? 'text-4xl sm:text-5xl lg:text-6xl' : 'text-3xl sm:text-4xl'}`}
        >
          {title}
        </h1>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {meta && <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-base text-ink-soft">{meta}</div>}
    </header>
  );
}

/** A compartment with a hard title bar. `index` staggers the load reveal. */
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
  return (
    <section
      className={`border-2 border-ink bg-light ${index === undefined ? '' : 'reveal'} ${className}`}
      style={style}
    >
      {title && (
        <div className="flex min-h-12 items-center justify-between gap-3 border-b-2 border-ink px-4 py-2">
          <h2 className="heading text-lg">{title}</h2>
          {aside}
        </div>
      )}
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

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
  return (
    <div
      className={`flex flex-col justify-between gap-3 p-4 ${alert ? 'bg-hazard text-light' : 'bg-light'} ${index === undefined ? '' : 'reveal'}`}
      style={style}
    >
      <p className={`label ${alert ? 'text-light' : ''}`}>{label}</p>
      <p className="telemetry text-4xl leading-none">{value}</p>
      {sub && <p className={`text-sm ${alert ? 'text-light' : 'text-ink-soft'}`}>{sub}</p>}
    </div>
  );
}

/** A row of stats on a 1px ink grid. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-0.5 border-2 border-ink bg-ink lg:grid-cols-4">{children}</div>;
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
    <div className="flex flex-col gap-1">
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
  tone?: 'plain' | 'ink' | 'hazard';
}) {
  const tones = {
    plain: 'border-ink bg-transparent text-ink',
    ink: 'border-ink bg-ink text-light',
    hazard: 'border-hazard bg-hazard text-light',
  };
  return (
    <span className={`label inline-flex min-h-7 items-center border-2 px-2 ${tones[tone]}`}>{children}</span>
  );
}

export function IssueStatusTag({ status }: { status: IssueStatus }) {
  const { label, open } = ISSUE_STATUS[status];
  return <Tag tone={status === 'escalated' ? 'ink' : 'plain'}>{open ? label : `✓ ${label}`}</Tag>;
}

export function DockStatusTag({ status }: { status: Dock['status'] }) {
  const tone = status === 'critical' ? 'hazard' : status === 'issue' ? 'ink' : 'plain';
  return <Tag tone={tone}>{DOCK_STATUS[status]}</Tag>;
}

/** Rules §2.4.7 — simulated data stays visibly marked as simulated. */
export function SimulatedTag() {
  return (
    <span className="label inline-flex min-h-7 items-center gap-2 border-2 border-dashed border-ink-mute px-2">
      Simulated data
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
      <div role="alert" className="flex border-2 border-hazard bg-light">
        <div className="hazard-tape w-3 shrink-0" aria-hidden="true" />
        <div className="flex flex-1 flex-wrap items-start justify-between gap-3 p-4">
          <div>
            <p className="heading flex items-center gap-2 text-lg text-hazard-deep">
              <AlertTriangle size={20} aria-hidden="true" />
              {title}
            </p>
            {children && <div className="mt-1.5 text-base text-ink">{children}</div>}
          </div>
          {action}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-2 border-ink bg-paper-sunk p-4">
      <div>
        <p className="heading text-lg">{title}</p>
        {children && <div className="mt-1.5 text-base text-ink-soft">{children}</div>}
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
    <div className="flex flex-col items-center gap-3 border-2 border-dashed border-hairline px-6 py-12 text-center">
      {icon && <div className="text-ink-mute">{icon}</div>}
      <p className="heading text-xl">{title}</p>
      {children && <div className="max-w-md text-base text-ink-soft">{children}</div>}
    </div>
  );
}

export function LoadingBlock({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      className="flex min-h-40 items-center justify-center border-2 border-dashed border-hairline"
      role="status"
    >
      <p className="label">{label}…</p>
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

/** Render a query's loading and error states; children get the data. */
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
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  return <>{children(query.data)}</>;
}

/** A mutation's failure, shown where the action was taken. */
export function MutationError({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="border-2 border-hazard bg-light px-3 py-2 text-base font-semibold text-hazard-deep"
    >
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
      <span className="heading text-base">{children}</span>
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
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  columns?: 2 | 3 | 4;
}) {
  const grid = { 2: 'grid-cols-2', 3: 'grid-cols-2 sm:grid-cols-3', 4: 'grid-cols-2 sm:grid-cols-4' }[
    columns
  ];
  return (
    <fieldset>
      <legend className="heading mb-2 text-base">{label}</legend>
      <div className={`grid gap-2 ${grid}`} role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className="choice justify-center"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
