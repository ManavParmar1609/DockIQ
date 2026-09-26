/**
 * What a dock supervisor acts on, most urgent first: what is open now, how the team is doing, where
 * the risk sits, and who it involves. Chart hues are the garden hues stepped for data (app.css,
 * "Charts") in a fixed order; brick red appears only for critical severity, always beside its shape
 * and label. Every chart has a table: the heatmap is one, the others switch to one.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { BarChart3, DoorOpen, Table2, Truck } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  BarStack,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from 'recharts';

import { useSearchParams } from 'react-router';

import { useAnalytics, type DateRange } from '../../api/hooks';
import type { Analytics as Summary, Severity } from '../../api/types';
import { useUser } from '../../auth/AuthProvider';
import { SeverityMark, severityLabel } from '../../components/Severity';
import {
  ChoiceGroup,
  PageHeader,
  Panel,
  QueryBoundary,
  SimulatedTag,
  Stat,
  StatGrid,
} from '../../components/ui';
import { duration, formatMoney, formatNumber } from '../../lib/format';
import { SEVERITY_ORDER } from '../../lib/vocab';

/** Below this many, an average or a rate says "too few to say" rather than a number. */
const MIN_SAMPLE = 5;

type RangeKey = 'shift' | '7d' | '30d' | 'all';

const RANGES: readonly { value: RangeKey; label: string }[] = [
  { value: 'shift', label: 'This shift' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All' },
];

/** Days back from today (UTC) for each preset; `null` is everything. The trend shows 30 days for "All". */
const RANGE_DAYS: Record<RangeKey, number | null> = { shift: 1, '7d': 7, '30d': 30, all: null };

const RANGE_WORDS: Record<RangeKey, string> = {
  shift: 'filed today',
  '7d': 'filed in the last 7 days',
  '30d': 'filed in the last 30 days',
  all: 'all time',
};

const RANGE_LABEL: Record<RangeKey, string> = {
  shift: 'Filed today',
  '7d': 'Filed in the last 7 days',
  '30d': 'Filed in the last 30 days',
  all: 'All time, in your scope',
};

function isRange(value: string | null): value is RangeKey {
  return RANGES.some((range) => range.value === value);
}

function rangeFor(key: RangeKey, today = new Date()): DateRange {
  const days = RANGE_DAYS[key];
  if (days === null) return {};
  const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return { from: new Date(base - (days - 1) * 86_400_000).toISOString().slice(0, 10) };
}
const AXIS = { fontFamily: 'var(--font-sans)', fontSize: 14, fill: 'var(--color-ink-mute)' };

/** Severity bars wear the severity colour (status), always beside its shape and label. */
const SEVERITY_BAR: Record<Severity, string> = {
  critical: 'bg-hazard-bright',
  high: 'bg-orange-bright',
  medium: 'bg-amber-bright',
  low: 'bg-ink-mute',
};

type Hue = 'clay' | 'slate' | 'moss' | 'plum';
const HUE_CLASS: Record<Hue, string> = {
  clay: 'bg-chart-clay',
  slate: 'bg-chart-slate',
  moss: 'bg-chart-moss',
  plum: 'bg-chart-plum',
};

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const stagger = (index: number): CSSProperties => ({ '--i': index }) as CSSProperties;

// ── Pieces ──

function Section({ title, sub, children }: { title: ReactNode; sub?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="heading text-2xl">{title}</h2>
        {sub && <p className="mt-1 text-base text-ink-mute">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function ViewToggle({ table, onChange }: { table: boolean; onChange: (table: boolean) => void }) {
  return (
    <button
      type="button"
      className="pill min-h-11 border border-hairline px-4 text-ink-soft transition-colors duration-300 hover:bg-paper-sunk"
      aria-pressed={table}
      onClick={() => onChange(!table)}
    >
      {table ? <BarChart3 size={16} aria-hidden="true" /> : <Table2 size={16} aria-hidden="true" />}
      {table ? 'Chart' : 'Table'}
    </button>
  );
}

function TipBox({ title, rows }: { title: string; rows: { label: string; value: string; hue?: Hue }[] }) {
  return (
    <div className="material-thick rounded-lg px-3 py-2 shadow-float">
      <p className="label">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="flex items-center gap-2 text-base">
          {row.hue && <span className={`legend-swatch ${HUE_CLASS[row.hue]}`} aria-hidden="true" />}
          <span className="text-ink-soft">{row.label}</span>
          <span className="telemetry ml-auto pl-3">{row.value}</span>
        </p>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { label: string; hue: Hue }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span className={`legend-swatch ${HUE_CLASS[item.hue]}`} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** One series of horizontal bars; each row states its value, so the list is its own table. */
function BarList({
  rows,
  hue,
  max,
  empty,
}: {
  rows: { label: string; value: number; display: string; hint?: string; simulated?: boolean }[];
  hue: Hue;
  max?: number;
  empty: string;
}) {
  if (rows.length === 0) return <p className="text-base text-ink-mute">{empty}</p>;
  const top = max ?? Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row, index) => (
        <li key={row.label}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-semibold">{row.label}</span>
              {row.simulated && <SimulatedTag compact />}
            </span>
            <span className="telemetry shrink-0">
              {row.display}
              {row.hint && <span className="text-sm text-ink-mute"> · {row.hint}</span>}
            </span>
          </div>
          <div className={`mt-1.5 ${max === undefined ? '' : 'ratio-track'}`}>
            <span
              className={`data-bar ${HUE_CLASS[hue]}`}
              style={{ ...stagger(index), width: `${(row.value / top) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Trend: issues per day, the last 30 days, gaps filled with zero ──

interface DayPoint {
  date: string;
  label: string;
  count: number;
}

function lastDays(series: Summary['over_time'], days: number, today = new Date()): DayPoint[] {
  const counts = new Map(series.map((point) => [point.date, point.count]));
  const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(base - (days - 1 - i) * 86_400_000);
    const date = day.toISOString().slice(0, 10);
    const label = day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return { date, label, count: counts.get(date) ?? 0 };
  });
}

function TrendTip({ active, payload }: { active?: boolean; payload?: { payload: DayPoint }[] }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return <TipBox title={point.label} rows={[{ label: 'Issues', value: formatNumber(point.count) }]} />;
}

function Trend({ points, reduced }: { points: DayPoint[]; reduced: boolean }) {
  const days = points.length;
  const [table, setTable] = useState(false);
  const total = points.reduce((sum, point) => sum + point.count, 0);
  const peakIndex = points.reduce(
    (best, point, index) => (point.count > (points[best]?.count ?? 0) ? index : best),
    -1,
  );
  const peak = points[peakIndex];
  // Near the right edge the peak's label sits to its left, so it is never clipped.
  const peakLabelSide = peakIndex > points.length * 0.8 ? 'left' : 'top';
  const labels = new Map(points.map((point) => [point.date, point.label]));
  const rows = (
    <table className={table ? 'w-full text-base' : 'sr-only'}>
      <caption className="sr-only">Issues per day, last {days} days</caption>
      <thead>
        <tr className="label text-left">
          <th scope="col" className="py-2 font-medium">
            Day
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Issues
          </th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => (
          <tr key={point.date} className="border-t border-hairline">
            <th scope="row" className="py-1.5 text-left font-normal">
              {point.label}
            </th>
            <td className="telemetry py-1.5 text-right">{point.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <Panel
      title="Issues per day"
      aside={
        <div className="flex items-center gap-3">
          <span className="label hidden sm:inline">
            {formatNumber(total)} in {days} days
          </span>
          <ViewToggle table={table} onChange={setTable} />
        </div>
      }
      index={8}
    >
      {table ? (
        rows
      ) : (
        <>
          <p className="label mb-3 sm:hidden">
            {formatNumber(total)} in {days} days
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 28, right: 16, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="var(--color-hairline)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value: string) => labels.get(value) ?? value}
                  tick={AXIS}
                  axisLine={{ stroke: 'var(--color-hairline)' }}
                  tickLine={false}
                  minTickGap={28}
                />
                <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                <Tooltip
                  content={<TrendTip />}
                  cursor={{ stroke: 'var(--color-ink-mute)', strokeWidth: 1 }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="var(--chart-slate)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill="var(--chart-slate)"
                  fillOpacity={0.12}
                  dot={false}
                  activeDot={{
                    r: 5,
                    fill: 'var(--chart-slate)',
                    stroke: 'var(--color-surface)',
                    strokeWidth: 2,
                  }}
                  isAnimationActive={!reduced}
                  animationDuration={900}
                />
                {peak && (
                  <ReferenceDot
                    x={peak.date}
                    y={peak.count}
                    r={5}
                    fill="var(--chart-slate)"
                    stroke="var(--color-surface)"
                    strokeWidth={2}
                    label={{
                      value: `Peak ${peak.count}`,
                      position: peakLabelSide,
                      offset: 10,
                      fill: 'var(--color-ink-soft)',
                      fontFamily: 'var(--font-sans)',
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {rows}
        </>
      )}
    </Panel>
  );
}

// ── Where the risk is: issue type × severity ──

function heatStep(count: number, max: number): number {
  if (count <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4)));
}

function RiskGrid({ data }: { data: Summary }) {
  const counts = new Map(
    data.by_type_severity.map((row) => [`${row.issue_type}|${row.severity}`, row.count]),
  );
  const max = Math.max(1, ...data.by_type_severity.map((row) => row.count));
  if (data.by_type.length === 0)
    return <p className="text-base text-ink-mute">No issues in your scope yet.</p>;
  return (
    <div className="flex flex-col gap-4">
      <table className="heat-table">
        <caption className="sr-only">Issues by type and severity</caption>
        <colgroup>
          <col />
          {SEVERITY_ORDER.map((level) => (
            <col key={level} className="heat-col" />
          ))}
          <col className="heat-total" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="label pb-1 text-left font-medium">
              Issue type
            </th>
            {SEVERITY_ORDER.map((level) => (
              <th key={level} scope="col" className="pb-1 font-medium" title={severityLabel(level)}>
                <span className="flex flex-col items-center gap-1">
                  <SeverityMark severity={level} size={16} tinted />
                  <span className="label hidden sm:block">{severityLabel(level)}</span>
                  <span className="sr-only sm:hidden">{severityLabel(level)}</span>
                </span>
              </th>
            ))}
            <th scope="col" className="label pb-1 text-right font-medium">
              All
            </th>
          </tr>
        </thead>
        <tbody>
          {data.by_type.map((type) => (
            <tr key={type.issue_type}>
              <th
                scope="row"
                className="py-1 pr-2 text-left text-sm leading-tight font-semibold hyphens-auto sm:text-base"
              >
                {type.issue_type}
              </th>
              {SEVERITY_ORDER.map((level) => {
                const count = counts.get(`${type.issue_type}|${level}`) ?? 0;
                return (
                  <td
                    key={level}
                    className={`heat-cell telemetry heat-${heatStep(count, max)}`}
                    title={`${type.issue_type} · ${severityLabel(level)}: ${count}`}
                  >
                    {count > 0 ? count : <span aria-label="0">–</span>}
                  </td>
                );
              })}
              <td className="telemetry text-right text-lg">{type.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-mute">
        <span>Shape marks the severity; colour deepens with the count.</span>
        <span className="flex items-center gap-1.5" aria-hidden="true">
          Fewer
          {[1, 2, 3, 4].map((step) => (
            <span key={step} className={`heat-key heat-${step}`} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

function SeveritySpeed({ rows }: { rows: Summary['by_severity'] }) {
  const bySeverity = new Map(rows.map((row) => [row.severity, row]));
  const top = Math.max(1, ...rows.map((row) => row.count));
  return (
    <ul className="flex flex-col gap-4">
      {SEVERITY_ORDER.map((level, index) => {
        const row = bySeverity.get(level);
        const count = row?.count ?? 0;
        const minutes = row?.avg_resolution_minutes ?? null;
        const resolved = count - (row?.open ?? 0);
        return (
          <li key={level}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex items-center gap-2 font-semibold">
                <SeverityMark severity={level} size={16} tinted />
                {severityLabel(level)}
              </span>
              <span className="telemetry text-lg">{count}</span>
            </div>
            <div className="mt-1.5">
              <span
                className={`data-bar ${SEVERITY_BAR[level]}`}
                style={{ ...stagger(index), width: `${(count / top) * 100}%` }}
              />
            </div>
            <p className="mt-1 text-sm text-ink-mute">
              {row?.open ?? 0} open ·{' '}
              {resolved === 0 || minutes === null
                ? 'none resolved yet'
                : resolved < MIN_SAMPLE
                  ? `${String(resolved)} resolved · too few to say how fast`
                  : `${duration(minutes)} to resolve on average`}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

// ── Dock doors: resolved and still open, stacked ──

interface DoorRow {
  door_number: number;
  count: number;
  open: number;
  resolved: number;
}

function DoorTip({ active, payload }: { active?: boolean; payload?: { payload: DoorRow }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <TipBox
      title={`Dock ${row.door_number} · ${row.count} issues`}
      rows={[
        { label: 'Open', value: formatNumber(row.open), hue: 'clay' },
        { label: 'Resolved', value: formatNumber(row.resolved), hue: 'slate' },
      ]}
    />
  );
}

/** The open segment sits on the resolved one with a 2px surface gap between them. */
function OpenSegment({ x, y, width, height, fill, payload }: BarShapeProps) {
  const gap = (payload as DoorRow | undefined)?.resolved ? 2 : 0;
  if (height <= gap) return null;
  return <rect x={x} y={y} width={width} height={height - gap} fill={fill} />;
}

function Doors({ rows, reduced }: { rows: Summary['by_dock']; reduced: boolean }) {
  const [table, setTable] = useState(false);
  const data: DoorRow[] = rows.map((row) => ({ ...row, resolved: row.count - row.open }));
  const busiest = data.reduce<DoorRow | undefined>(
    (best, row) => (row.count > (best?.count ?? 0) ? row : best),
    undefined,
  );
  const tableView = (
    <table className={table ? 'w-full text-base' : 'sr-only'}>
      <caption className="sr-only">Issues by dock door</caption>
      <thead>
        <tr className="label text-left">
          <th scope="col" className="py-2 font-medium">
            Door
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Open
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Resolved
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            All
          </th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.door_number} className="border-t border-hairline">
            <th scope="row" className="py-1.5 text-left font-normal">
              Dock {row.door_number}
            </th>
            <td className="telemetry py-1.5 text-right">{row.open}</td>
            <td className="telemetry py-1.5 text-right">{row.resolved}</td>
            <td className="telemetry py-1.5 text-right">{row.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <Panel title="Issues by dock door" aside={<ViewToggle table={table} onChange={setTable} />} index={11}>
      {data.length === 0 ? (
        <p className="text-base text-ink-mute">No door has an issue yet.</p>
      ) : table ? (
        tableView
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Legend
              items={[
                { label: 'Still open', hue: 'clay' },
                { label: 'Resolved', hue: 'slate' },
              ]}
            />
            {busiest && (
              <p className="text-sm text-ink-soft">
                Busiest: <span className="font-semibold text-ink">Dock {busiest.door_number}</span> ·{' '}
                {busiest.count} issues, {busiest.open} open
              </p>
            )}
          </div>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }} barCategoryGap="24%">
                <CartesianGrid stroke="var(--color-hairline)" vertical={false} />
                <XAxis
                  dataKey="door_number"
                  tickFormatter={(value: number) => `D${value}`}
                  tick={AXIS}
                  axisLine={{ stroke: 'var(--color-hairline)' }}
                  tickLine={false}
                />
                <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                <Tooltip content={<DoorTip />} cursor={{ fill: 'var(--color-paper-sunk)' }} />
                <BarStack radius={[4, 4, 0, 0]}>
                  <Bar
                    dataKey="resolved"
                    name="Resolved"
                    fill="var(--chart-slate)"
                    maxBarSize={24}
                    isAnimationActive={!reduced}
                    animationDuration={900}
                  />
                  <Bar
                    dataKey="open"
                    name="Still open"
                    fill="var(--chart-clay)"
                    maxBarSize={24}
                    shape={OpenSegment}
                    isAnimationActive={!reduced}
                    animationDuration={900}
                  />
                </BarStack>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {tableView}
        </div>
      )}
    </Panel>
  );
}

// ── Repeats: the same problem, again, in one place ──

function RepeatList({
  icon,
  heading,
  rows,
  empty,
}: {
  icon: ReactNode;
  heading: string;
  rows: { what: string; where: string; count: number }[];
  empty: string;
}) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-base font-semibold text-ink-soft">
        {icon}
        {heading}
      </h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-base text-ink-mute">{empty}</p>
      ) : (
        <ul className="mt-1">
          {rows.map((row) => (
            <li
              key={`${row.what}|${row.where}`}
              className="flex items-center justify-between gap-3 border-b border-hairline py-2.5 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold">{row.what}</p>
                <p className="text-sm text-ink-mute">{row.where}</p>
              </div>
              <span className="pill telemetry shrink-0 bg-paper-sunk text-ink">{row.count}×</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── The page ──

function Dashboard({ data, range }: { data: Summary; range: RangeKey }) {
  const [reduced] = useState(prefersReducedMotion);
  const trendDays = RANGE_DAYS[range] ?? 30;
  const points = lastDays(data.over_time, trendDays);
  const scope = data.scope === 'quality' ? 'facility' : 'team';
  const within = RANGE_WORDS[range];
  const resolved = data.total_issues - data.open_issues;
  const costRows = data.by_type
    .filter((row) => row.cost_impact > 0)
    .sort((a, b) => b.cost_impact - a.cost_impact)
    .map((row) => ({ label: row.issue_type, value: row.cost_impact, display: formatMoney(row.cost_impact) }));
  const operators = data.by_operator
    .map((row) => {
      const rate = row.total ? Math.round((row.self_resolved / row.total) * 100) : 0;
      const few = row.total < MIN_SAMPLE;
      return {
        label: row.name,
        value: few ? 0 : rate,
        display: few ? '—' : `${String(rate)}%`,
        hint: few ? `${String(row.total)} issues, too few to say` : `${String(row.total)} issues`,
        simulated: row.simulated ?? false,
      };
    })
    .sort((a, b) => b.value - a.value);

  return (
    <div className="flex flex-col gap-10">
      <Section
        title={
          <>
            Needs you <em>now</em>
          </>
        }
      >
        <StatGrid>
          <Stat
            label="Open critical"
            value={formatNumber(data.open_critical)}
            sub={data.open_critical > 0 ? `Waiting on a supervisor · ${within}` : 'Nothing critical open'}
            alert={data.open_critical > 0}
            index={0}
          />
          <Stat
            label="Open issues"
            value={formatNumber(data.open_issues)}
            sub={`Still being worked · ${within}`}
            index={1}
          />
          <Stat
            label="Cost at risk"
            value={formatMoney(data.open_cost_impact)}
            sub="Estimated, on open issues"
            index={2}
          />
          <Stat
            label="Open cold-chain breaks"
            value={formatNumber(data.cold_chain_open)}
            sub={`${formatNumber(data.cold_chain_breaches)} temperature deviations in all`}
            index={3}
          />
        </StatGrid>
      </Section>

      <Section
        title={
          <>
            How the {scope} is <em>doing</em>
          </>
        }
      >
        <StatGrid>
          <Stat label="Issues" value={formatNumber(data.total_issues)} sub={RANGE_LABEL[range]} index={4} />
          <Stat
            label="Self-resolved"
            value={data.total_issues < MIN_SAMPLE ? '—' : `${String(data.self_resolution_rate)}%`}
            sub={
              data.total_issues < MIN_SAMPLE
                ? `Too few issues to say (${String(data.total_issues)})`
                : `${formatNumber(data.self_resolved)} without a supervisor`
            }
            index={5}
          />
          <Stat
            label="Avg resolution"
            value={resolved < MIN_SAMPLE ? '—' : duration(data.avg_resolution_minutes)}
            sub={
              resolved < MIN_SAMPLE
                ? `Too few resolved to say (${String(resolved)})`
                : `Report to resolved · ${formatNumber(resolved)} resolved`
            }
            index={6}
          />
          <Stat
            label="Cost impact"
            value={formatMoney(data.total_cost_impact)}
            sub={`Estimated · ${within}`}
            index={7}
          />
        </StatGrid>
        {range === 'shift' ? (
          <p className="text-base text-ink-mute">
            The day-by-day trend needs more than one day: choose 7 days or longer.
          </p>
        ) : (
          <Trend points={points} reduced={reduced} />
        )}
      </Section>

      <Section
        title={
          <>
            Where the <em>risk</em> is
          </>
        }
        sub="Which problems turn serious, how fast each level closes, and where they happen."
      >
        <div className="grid gap-6 lg:grid-cols-5">
          <Panel title="Issue type by severity" className="lg:col-span-3" index={9}>
            <RiskGrid data={data} />
          </Panel>
          <Panel title="Severity and speed" className="lg:col-span-2" index={10}>
            <SeveritySpeed rows={data.by_severity} />
          </Panel>
        </div>
        <Doors rows={data.by_dock} reduced={reduced} />
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel
            title="Cost by issue type"
            aside={<span className="label">{formatMoney(data.total_cost_impact)} in all</span>}
            index={12}
          >
            <BarList rows={costRows} hue="clay" empty="No issue has a cost estimate yet." />
          </Panel>
          <Panel
            title="Repeat problems"
            aside={<span className="label">{range === 'all' ? 'Last 30 days' : 'In this range'}</span>}
            index={13}
          >
            <div className="flex flex-col gap-5">
              <RepeatList
                icon={<DoorOpen size={18} aria-hidden="true" />}
                heading="At the same door"
                rows={data.repeat_at_doors.map((row) => ({
                  what: row.issue_type,
                  where: `Dock ${row.door_number}`,
                  count: row.count,
                }))}
                empty="Nothing has happened twice at one door."
              />
              <RepeatList
                icon={<Truck size={18} aria-hidden="true" />}
                heading="With the same carrier"
                rows={data.repeat_with_carriers.map((row) => ({
                  what: row.issue_type,
                  where: row.name,
                  count: row.count,
                }))}
                empty="No carrier has brought the same problem twice."
              />
            </div>
          </Panel>
        </div>
      </Section>

      <Section
        title={
          <>
            People and <em>partners</em>
          </>
        }
      >
        <div className="grid gap-6 lg:grid-cols-3">
          <Panel title="Self-resolution by operator" index={14}>
            <BarList rows={operators} hue="moss" max={100} empty="No operator has reported an issue yet." />
          </Panel>
          <Panel title="By customer" index={15}>
            <BarList
              rows={data.by_company.map((row) => ({
                label: row.name,
                value: row.count,
                display: formatNumber(row.count),
              }))}
              hue="plum"
              empty="No customer is linked to an issue yet."
            />
          </Panel>
          <Panel title="By carrier" index={16}>
            <BarList
              rows={data.by_carrier.map((row) => ({
                label: row.name,
                value: row.count,
                display: formatNumber(row.count),
              }))}
              hue="slate"
              empty="No carrier is linked to an issue yet."
            />
          </Panel>
        </div>
      </Section>
    </div>
  );
}

/** What the figures cover, from the server's own `scope`, never assumed from the role. */
function scopeLine(data: Summary | undefined, zone: string | null | undefined): string {
  if (!data) return 'Loading the scope…';
  return data.scope === 'quality'
    ? 'Quality scope: temperature, product-quality and lot issues, and every critical one, across all zones.'
    : `Team scope: issues reported by ${zone ?? 'your'} team.`;
}

export default function Analytics() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const selected = params.get('range');
  const range: RangeKey = isRange(selected) ? selected : '30d';
  const analytics = useAnalytics(rangeFor(range));
  const choose = (value: RangeKey) => {
    const next = new URLSearchParams(params);
    next.set('range', value);
    setParams(next, { replace: true });
  };
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={user.role === 'quality' ? 'Whole facility' : `${user.zone ?? 'Your'} team`}
        title="Analytics"
        meta={<span>{scopeLine(analytics.data, user.zone)}</span>}
      />
      <div className="max-w-2xl">
        <ChoiceGroup label="Period" options={RANGES} value={range} onChange={choose} columns={4} />
      </div>
      <QueryBoundary query={analytics} loading="Crunching the numbers">
        {(data) => <Dashboard data={data} range={range} />}
      </QueryBoundary>
    </div>
  );
}
