/**
 * Every chart is a single series in ink; red appears only on the critical severity bar, which also
 * carries its shape and label. Bar lists double as the table view — each row states its value.
 */
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useAnalytics } from '../../api/hooks';
import type { Analytics as Summary, Severity } from '../../api/types';
import { useUser } from '../../auth/AuthProvider';
import { SeverityMark, severityLabel } from '../../components/Severity';
import { PageHeader, Panel, QueryBoundary, Stat, StatGrid } from '../../components/ui';
import { formatMoney, formatNumber } from '../../lib/format';
import { SEVERITY_ORDER } from '../../lib/vocab';

const AXIS = { fontFamily: 'var(--font-sans)', fontSize: 14, fill: 'var(--color-ink-mute)' };

/** Severity bars carry the severity colour, and always sit beside its shape and label. */
const SEVERITY_BAR: Record<Severity, string> = {
  critical: 'bg-hazard-bright',
  high: 'bg-orange-bright',
  medium: 'bg-amber-bright',
  low: 'bg-ink-mute',
};

function ChartTooltip({
  active,
  payload,
  label,
  unit,
  prefix = '',
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string | number;
  unit: string;
  prefix?: string;
}) {
  const value = payload?.[0]?.value;
  if (!active || value === undefined) return null;
  return (
    <div className="material-thick rounded-lg px-3 py-2 shadow-float">
      <p className="label">
        {prefix}
        {label}
      </p>
      <p className="telemetry text-lg">
        {formatNumber(value)} {unit}
      </p>
    </div>
  );
}

function BarList({
  rows,
  unit,
  max,
}: {
  rows: { label: string; value: number; hint?: string }[];
  unit: string;
  max?: number;
}) {
  const top = max ?? Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate font-semibold">{row.label}</span>
            <span className="telemetry shrink-0">
              {formatNumber(row.value)}
              {unit}
              {row.hint && <span className="text-sm text-ink-mute"> · {row.hint}</span>}
            </span>
          </div>
          <div className="meter mt-1.5">
            <div className="meter-fill" style={{ width: `${(row.value / top) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function SeverityBars({ rows }: { rows: Summary['by_severity'] }) {
  const counts = new Map(rows.map((row) => [row.severity, row.count]));
  const top = Math.max(1, ...rows.map((row) => row.count));
  return (
    <ul className="flex flex-col gap-3">
      {SEVERITY_ORDER.map((level: Severity) => {
        const count = counts.get(level) ?? 0;
        return (
          <li key={level} className="bar-row items-center gap-3">
            <span className="flex items-center gap-2 font-semibold">
              <SeverityMark severity={level} size={16} tinted />
              {severityLabel(level)}
            </span>
            <span className="h-6 overflow-hidden rounded-md bg-paper-sunk">
              <span
                className={`block h-full rounded-md ${SEVERITY_BAR[level]}`}
                style={{ width: `${(count / top) * 100}%` }}
              />
            </span>
            <span className="telemetry text-right text-lg">{count}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Dashboard({ data }: { data: Summary }) {
  const operators = [...data.by_operator]
    .map((row) => ({
      label: row.name,
      value: row.total ? Math.round((row.self_resolved / row.total) * 100) : 0,
      hint: `${row.total} issues`,
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="flex flex-col gap-6">
      <StatGrid>
        <Stat label="Issues" value={formatNumber(data.total_issues)} sub="In your scope" index={0} />
        <Stat
          label="Self-resolved"
          value={`${data.self_resolution_rate}%`}
          sub={`${data.self_resolved} without a supervisor`}
          index={1}
        />
        <Stat
          label="Avg resolution"
          value={`${data.avg_resolution_minutes}m`}
          sub="Report to resolved"
          index={2}
        />
        <Stat label="Cost impact" value={formatMoney(data.total_cost_impact)} sub="Estimated" index={3} />
      </StatGrid>

      <Panel title="Issues per day — last 30 days" index={4}>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.over_time} margin={{ top: 8, right: 24, bottom: 0, left: -16 }}>
              <defs>
                <linearGradient id="issues-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-hairline)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(value: string) => value.slice(5)}
                tick={AXIS}
                axisLine={{ stroke: 'var(--color-hairline)' }}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
              <Tooltip
                content={<ChartTooltip unit="issues" />}
                cursor={{ stroke: 'var(--color-ink-mute)', strokeWidth: 1 }}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="var(--color-accent)"
                strokeWidth={2.5}
                fill="url(#issues-fill)"
                dot={false}
                activeDot={{
                  r: 5,
                  fill: 'var(--color-accent)',
                  stroke: 'var(--color-surface)',
                  strokeWidth: 2,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <table className="sr-only">
          <caption>Issues per day</caption>
          <tbody>
            {data.over_time.map((point) => (
              <tr key={point.date}>
                <th scope="row">{point.date}</th>
                <td>{point.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="By severity" index={5}>
          <SeverityBars rows={data.by_severity} />
        </Panel>
        <Panel title="By issue type" index={6}>
          <BarList rows={data.by_type.map((row) => ({ label: row.issue_type, value: row.count }))} unit="" />
        </Panel>
      </div>

      <Panel title="By dock door" aside={<span className="label">Where problems cluster</span>} index={7}>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.by_dock}
              margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
              barCategoryGap={6}
            >
              <CartesianGrid stroke="var(--color-hairline)" vertical={false} />
              <XAxis
                dataKey="door_number"
                tick={AXIS}
                axisLine={{ stroke: 'var(--color-hairline)' }}
                tickLine={false}
              />
              <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
              <Tooltip
                content={<ChartTooltip unit="issues" prefix="Dock " />}
                cursor={{ fill: 'var(--color-paper-sunk)' }}
              />
              <Bar
                dataKey="count"
                fill="var(--color-accent)"
                radius={[6, 6, 0, 0]}
                maxBarSize={44}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Self-resolution by operator" index={8}>
          <BarList rows={operators} unit="%" max={100} />
        </Panel>
        <Panel title="By customer" index={9}>
          <BarList rows={data.by_company.map((row) => ({ label: row.name, value: row.count }))} unit="" />
        </Panel>
        <Panel title="By carrier" index={10}>
          <BarList rows={data.by_carrier.map((row) => ({ label: row.name, value: row.count }))} unit="" />
        </Panel>
      </div>
    </div>
  );
}

export default function Analytics() {
  const user = useUser();
  const analytics = useAnalytics();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        kicker={user.role === 'quality' ? 'Whole facility' : `${user.zone ?? 'Your'} team`}
        title="Analytics"
      />
      <QueryBoundary query={analytics} loading="Crunching the numbers">
        {(data) => <Dashboard data={data} />}
      </QueryBoundary>
    </div>
  );
}
