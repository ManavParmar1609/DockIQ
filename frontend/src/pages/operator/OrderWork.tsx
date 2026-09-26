import { Check, Minus, Plus, RotateCw, TriangleAlert } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import {
  useActiveOrder,
  useCompleteOrder,
  useCountQueue,
  useLoadPlan,
  useLoadStepSync,
  useOrder,
  useReceivingChecks,
  useSaveReceivingChecks,
  useScan,
  useCounter,
  useInventory,
  useTaxonomy,
  useTemperatureCheck,
  useTemperatureLog,
} from '../../api/hooks';
import { ApiError, errorMessage } from '../../api/client';
import type {
  OrderCompleted,
  OrderDetail,
  OrderItem,
  ReceivingChecks,
  ScanResult,
  TemperatureCheck,
  TemperatureLog,
} from '../../api/types';
import { Barcode } from '../../components/Barcode';
import { LoadPlanView } from '../../components/LoadPlanView';
import { PalletList } from '../../components/PalletList';
import { ScanField } from '../../components/ScanField';
import { Tabs } from '../../components/Tabs';
import {
  EmptyState,
  ErrorBlock,
  FieldLabel,
  LoadingBlock,
  MutationError,
  Notice,
  PageHeader,
  Panel,
  QueryBoundary,
  Tag,
} from '../../components/ui';
import { formatDateTime, formatTemp, percent } from '../../lib/format';
import { reportLink } from './reportLink';

type Tab = 'plan' | 'temperature' | 'checks' | 'count' | 'signoff';

const PANEL_ID = 'order-step';

function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const value = percent(done, total);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="telemetry text-2xl">
          {done}
          <span className="text-ink-mute"> / {total}</span>
        </span>
        <span className="telemetry text-lg">{value}%</span>
      </div>
      <div
        className="mt-2 h-3 card"
        role="progressbar"
        aria-label={label}
        aria-valuetext={`${done} of ${total} cases, ${value}%`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <div className="meter-fill" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

// ── Counting ──

/**
 * Counts the server has not accepted yet. They are kept on this tablet and replayed in order; the
 * operator is told, never left guessing, and sign-off waits for them.
 */
function CountSync({ orderId }: { orderId: number }) {
  const queue = useCountQueue(orderId);
  return (
    <>
      {queue.stalled && queue.pending > 0 && (
        <Notice
          title={`${plural(queue.pending, 'count')} not sent yet`}
          action={
            <button type="button" className="btn btn-secondary" onClick={queue.retry}>
              <RotateCw size={18} aria-hidden="true" /> Send now
            </button>
          }
        >
          {errorMessage(queue.stalled)} Keep counting; sign-off waits for them.
        </Notice>
      )}
      <MutationError error={queue.refused} />
    </>
  );
}

/** Pick locations from the WMS. When the WMS is down, say so plainly: the paper pick list still works. */
function StockLocations({ sku }: { sku: string }) {
  const stock = useInventory(sku);
  if (stock.isPending) return <p className="label">Asking the WMS…</p>;
  if (stock.isError) {
    const offline = stock.error instanceof ApiError && stock.error.status === 503;
    return (
      <p className="rounded-lg bg-paper-sunk p-3 text-base">
        {offline
          ? 'WMS offline. Pick from the paper pick list; your counts are kept and sent when it is back.'
          : 'Could not read locations from the WMS.'}
      </p>
    );
  }
  if (stock.data.length === 0) return <p className="text-base">No stock on hand in the WMS.</p>;
  return <PalletList pallets={stock.data} />;
}

function LineItem({ order, item }: { order: OrderDetail; item: OrderItem }) {
  const counter = useCounter(order.id);
  const [manual, setManual] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [showStock, setShowStock] = useState(false);
  const outbound = order.type === 'outbound';
  // Loading cannot exceed the plan; receiving can, because an overage is a real discrepancy.
  const clamp = (value: number) => Math.max(0, outbound ? Math.min(value, item.expected_quantity) : value);
  const change = (delta: number) => counter.adjust(item.product_id, (current) => clamp(current + delta));
  const apply = (value: number) => counter.adjust(item.product_id, () => clamp(value));
  const done = item.actual_quantity >= item.expected_quantity;
  const over = item.actual_quantity - item.expected_quantity;

  const submitManual = (event: SyntheticEvent) => {
    event.preventDefault();
    const value = Number.parseInt(manual, 10);
    if (Number.isNaN(value) || value < 0) return;
    apply(value);
    setManual('');
  };

  return (
    <li className="card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline p-4">
        <div className="min-w-0">
          <p className="heading flex items-center gap-2 text-xl">
            {done && <Check size={22} aria-label="Complete" />}
            {item.product_name}
          </p>
          <p className="telemetry mt-1 text-sm text-ink-mute">
            {item.sku} · {item.category} · {item.cases_per_pallet}/pallet · {item.weight_per_case} lb/case
            {item.temp_max !== null && ` · max ${formatTemp(item.temp_max)}`}
            {item.is_allergen && ' · ALLERGEN'}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-4">
          {outbound && (
            <button
              type="button"
              className="label underline"
              onClick={() => setShowStock((value) => !value)}
              aria-expanded={showStock}
            >
              {showStock ? 'Hide' : 'Where is it'} stored
            </button>
          )}
          <button
            type="button"
            className="label underline"
            onClick={() => setShowCode((value) => !value)}
            aria-expanded={showCode}
          >
            {showCode ? 'Hide' : 'Show'} case barcode
          </button>
        </div>
      </div>
      {showStock && (
        <div className="border-b border-hairline p-4">
          <StockLocations sku={item.sku} />
        </div>
      )}
      {showCode && item.gtin && (
        <div className="border-b border-hairline p-4">
          <Barcode code={item.gtin} label={`Case barcode for ${item.product_name}`} />
        </div>
      )}
      <div className="p-4">
        <ProgressBar
          done={item.actual_quantity}
          total={item.expected_quantity}
          label={`${item.product_name} counted`}
        />
        {!outbound && over !== 0 && item.verified && (
          <p className="label mt-2 text-ink">{over > 0 ? `Over by ${over}` : `Short by ${-over}`}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            aria-label="Remove one case"
            onClick={() => change(-1)}
          >
            <Minus size={20} aria-hidden="true" />1
          </button>
          {[1, 5, 10, 25].map((step) => (
            <button
              key={step}
              type="button"
              className="btn btn-primary"
              disabled={outbound && done}
              onClick={() => change(step)}
            >
              <Plus size={18} aria-hidden="true" />
              {step}
            </button>
          ))}
          {item.cases_per_pallet > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={outbound && done}
              aria-label={`Add one pallet, ${item.cases_per_pallet} cases`}
              onClick={() => change(item.cases_per_pallet)}
            >
              <Plus size={18} aria-hidden="true" />1 pallet
            </button>
          )}
          <form onSubmit={submitManual} className="flex gap-2">
            <label htmlFor={`set-${item.id}`} className="sr-only">
              Set count for {item.product_name}
            </label>
            <input
              id={`set-${item.id}`}
              type="number"
              min={0}
              inputMode="numeric"
              className="field w-28"
              placeholder="Set"
              value={manual}
              onChange={(event) => setManual(event.target.value)}
            />
            <button type="submit" className="btn btn-secondary">
              Set
            </button>
          </form>
        </div>
      </div>
    </li>
  );
}

function ScanOutcome({ result, order }: { result: ScanResult; order: OrderDetail }) {
  if (result.result === 'match') {
    return (
      <Notice title={`Match — ${result.scanned_sku ?? ''} counted`}>
        {result.item && (
          <span className="telemetry">
            {result.item.actual_quantity} of {result.item.expected_quantity} cases
          </span>
        )}
      </Notice>
    );
  }
  if (result.result === 'mismatch') {
    return (
      <Notice
        tone="alert"
        title={order.type === 'outbound' ? 'SKU mismatch — do not load' : 'SKU mismatch — do not receive'}
        action={
          <Link
            to={reportLink({
              type: 'SKU Mismatch',
              subtype: 'SKU does not match pick list',
              description: `Scanned ${result.scanned_sku ?? result.code} (${result.scanned_product_name ?? 'unknown'}); expected ${result.expected_skus.join(' or ')}`,
            })}
            className="btn btn-hazard"
          >
            Report it
          </Link>
        }
      >
        <p>
          Scanned <span className="telemetry">{result.scanned_sku}</span> — {result.scanned_product_name}.
        </p>
        <p>
          This order expects <span className="telemetry">{result.expected_skus.join(', ')}</span>. Nothing was
          counted.
        </p>
      </Notice>
    );
  }
  return (
    <Notice title="Code not recognised">
      <span className="telemetry">{result.code}</span> matches nothing in the catalogue. Check the label, or
      scan the case (ITF-14) barcode rather than a retail UPC.
    </Notice>
  );
}

function CountTab({ order }: { order: OrderDetail }) {
  const scan = useScan(order.id);
  const expected = order.items.reduce((sum, item) => sum + item.expected_quantity, 0);
  const counted = order.items.reduce((sum, item) => sum + item.actual_quantity, 0);
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Scan a case">
        <ScanField onScan={(code) => scan.mutate(code)} disabled={scan.isPending} />
        <div className="mt-3 flex flex-col gap-2">
          {scan.data && <ScanOutcome result={scan.data} order={order} />}
          <MutationError error={scan.error} />
        </div>
      </Panel>
      <Panel title={order.type === 'outbound' ? 'Loaded' : 'Received'}>
        <ProgressBar
          done={counted}
          total={expected}
          label={order.type === 'outbound' ? 'Cases loaded' : 'Cases received'}
        />
      </Panel>
      <ul className="flex flex-col gap-4">
        {order.items.map((item) => (
          <LineItem key={item.id} order={order} item={item} />
        ))}
      </ul>
    </div>
  );
}

// ── Receiving ──

const PROBE_STATUS: Record<string, string> = {
  ok: 'OK',
  marginal: 'Marginal',
  warning: 'Warning',
  critical: 'Critical',
  not_applicable: 'No limit',
};

/** A probe result: the one just taken, or the last one logged (which carries no guidance text). */
type ProbeResult = Pick<TemperatureCheck, 'status' | 'reading' | 'limit' | 'delta' | 'issue_id'> & {
  guidance?: string;
};

function ProbeOutcome({ result }: { result: ProbeResult }) {
  if (result.status === 'critical') {
    return (
      <Notice
        tone="alert"
        title={`Critical — ${formatTemp(result.reading)} is ${result.delta ?? 0}°F over`}
        action={
          result.issue_id != null && (
            <Link to={`/app/issues/${result.issue_id}`} className="btn btn-hazard">
              View issue <span className="telemetry">#{result.issue_id}</span>
            </Link>
          )
        }
      >
        {result.guidance && <p>{result.guidance}</p>}
        {result.issue_id != null && (
          <p className="mt-1">
            A Temperature Deviation was filed for you and your supervisor alerted. Sign-off waits until it is
            resolved.
          </p>
        )}
      </Notice>
    );
  }
  return (
    <Notice
      title={
        result.status === 'ok'
          ? `OK — ${formatTemp(result.reading)}, within ${formatTemp(result.limit ?? 0)}`
          : result.status === 'not_applicable'
            ? 'No temperature limit'
            : `${PROBE_STATUS[result.status] ?? result.status} — ${result.delta ?? 0}°F over ${formatTemp(result.limit ?? 0)}`
      }
    >
      {result.guidance}
    </Notice>
  );
}

function ProbeLog({ log }: { log: TemperatureLog[] }) {
  if (log.length === 0) {
    return <p className="text-base text-ink-mute">No readings logged for this load yet.</p>;
  }
  return (
    <table className="w-full text-left">
      <thead>
        <tr className="border-b border-hairline">
          <th className="label py-2">Time</th>
          <th className="label py-2 text-right">Reading</th>
          <th className="label py-2 pl-4">Status</th>
        </tr>
      </thead>
      <tbody>
        {[...log].reverse().map((entry) => (
          <tr key={entry.id} className="border-b border-hairline">
            <td className="telemetry py-2 text-sm">
              {formatDateTime(entry.created_at)}
              {entry.operator_name && <span className="block text-ink-mute">{entry.operator_name}</span>}
            </td>
            <td className="telemetry py-2 text-right text-lg">{formatTemp(entry.reading)}</td>
            <td className="py-2 pl-4">
              <span className="flex flex-wrap items-center gap-2">
                <Tag tone={entry.status === 'critical' ? 'hazard' : 'plain'}>
                  {entry.status === 'critical' && <TriangleAlert size={14} aria-hidden="true" />}
                  {PROBE_STATUS[entry.status] ?? entry.status}
                </Tag>
                {entry.issue_id != null && (
                  <Link to={`/app/issues/${entry.issue_id}`} className="telemetry text-sm underline">
                    #{entry.issue_id}
                  </Link>
                )}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TemperatureTab({
  order,
  check,
}: {
  order: OrderDetail;
  check: ReturnType<typeof useTemperatureCheck>;
}) {
  const log = useTemperatureLog(order.id);
  const [reading, setReading] = useState('');
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const value = Number.parseFloat(reading);
    if (!Number.isNaN(value)) check.mutate(value, { onSuccess: () => setReading('') });
  };
  // The reading just taken, or — after a reload — the last one in the log.
  const result: ProbeResult | undefined = check.data ?? log.data?.at(-1);
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Probe temperature">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <FieldLabel htmlFor="probe" hint="Probe the centre of a case, never the edge">
              Reading (°F)
            </FieldLabel>
            <input
              id="probe"
              type="number"
              step="0.1"
              inputMode="decimal"
              className="field text-2xl"
              value={reading}
              onChange={(event) => setReading(event.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={check.isPending || reading === ''}>
            {check.isPending ? 'Logging…' : 'Check'}
          </button>
        </form>
        <div className="mt-4 flex flex-col gap-3">
          <MutationError error={check.error} />
          {result && <ProbeOutcome result={result} />}
        </div>
      </Panel>
      <Panel title="Probe log" aside={<span className="label">{order.order_number}</span>}>
        <QueryBoundary query={log} loading="Reading the probe log">
          {(entries) => <ProbeLog log={entries} />}
        </QueryBoundary>
      </Panel>
    </div>
  );
}

function ChecksTab({ order }: { order: OrderDetail }) {
  const taxonomy = useTaxonomy();
  const checks = useReceivingChecks(order.id);
  const save = useSaveReceivingChecks(order.id);
  return (
    <QueryBoundary query={checks} loading="Loading the receiving checks">
      {(saved: ReceivingChecks) => {
        const answers = new Map(saved.checks.map((check) => [check.id, check]));
        const specs = taxonomy.data?.receiving_checks?.length ? taxonomy.data.receiving_checks : saved.checks;
        const answered = saved.checks.filter((check) => check.answer !== null).length;
        return (
          <Panel
            title="Receiving checks"
            aside={
              <span className="telemetry text-base">
                {answered} / {specs.length} answered
              </span>
            }
          >
            <ul className="flex flex-col gap-3">
              {specs.map((spec) => {
                const stored = answers.get(spec.id);
                // While a tap is being saved, show it at once.
                const pendingAnswer = save.isPending ? save.variables[spec.id] : undefined;
                const answer = pendingAnswer ?? stored?.answer ?? null;
                return (
                  <li
                    key={spec.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3"
                  >
                    <span>
                      <span className="block text-lg font-semibold">{spec.question}</span>
                      {stored?.answered_at && (
                        <span className="telemetry text-sm text-ink-mute">
                          {stored.answered_by_name ?? 'Answered'} · {formatDateTime(stored.answered_at)}
                        </span>
                      )}
                    </span>
                    <span className="flex flex-wrap gap-2">
                      {([true, false] as const).map((value) => (
                        <button
                          key={String(value)}
                          type="button"
                          className="choice min-w-20 justify-center"
                          aria-pressed={answer === value}
                          disabled={save.isPending}
                          onClick={() => save.mutate({ [spec.id]: value })}
                        >
                          {value ? 'Yes' : 'No'}
                        </button>
                      ))}
                      {answer === false && (
                        <Link
                          to={reportLink({ type: spec.issue_type, subtype: spec.issue_subtype })}
                          className="btn btn-hazard"
                        >
                          <TriangleAlert size={18} aria-hidden="true" /> Report
                        </Link>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-base text-ink-soft">
              Every check needs an answer before sign-off. A &ldquo;No&rdquo; is recorded as evidence; report
              it so your supervisor can decide.
            </p>
            <div className="mt-3">
              <MutationError error={save.error} />
            </div>
          </Panel>
        );
      }}
    </QueryBoundary>
  );
}

// ── Sign-off ──

/** The completion result, held by the page: the finished order leaves the active list at once. */
function OrderDone({ order, result }: { order: OrderDetail; result: OrderCompleted }) {
  const navigate = useNavigate();
  const filed = result.discrepancy_issue_ids;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        kicker={`${order.type === 'outbound' ? 'Loading' : 'Receiving'} · ${order.company_name}`}
        title={`Dock ${order.door_number ?? '—'}`}
      />
      <Panel title="Order complete">
        <p className="text-lg">The dock is released.</p>
        {filed.length > 0 && (
          <Notice title={`${filed.length} count discrepanc${filed.length === 1 ? 'y' : 'ies'} filed`}>
            Lines outside {order.company_name}&apos;s count tolerance were reported for you:{' '}
            {filed.map((id) => (
              <Link key={id} to={`/app/issues/${id}`} className="telemetry mr-2 underline">
                #{id}
              </Link>
            ))}
          </Notice>
        )}
        <button type="button" className="btn btn-primary mt-4" onClick={() => void navigate('/app')}>
          Back to shift
        </button>
      </Panel>
    </div>
  );
}

/** What the receiving evidence still lacks, as places to go (the blocker text says why). */
function EvidenceLinks({ order, onGoTo }: { order: OrderDetail; onGoTo: (tab: Tab) => void }) {
  const checks = useReceivingChecks(order.id);
  const data = checks.data;
  if (!data) return null;
  const missingChecks = !data.all_answered;
  const missingProbe = data.needs_probe && data.probes === 0;
  if (!missingChecks && !missingProbe) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {missingProbe && (
        <button type="button" className="btn btn-secondary" onClick={() => onGoTo('temperature')}>
          Probe a case
        </button>
      )}
      {missingChecks && (
        <button type="button" className="btn btn-secondary" onClick={() => onGoTo('checks')}>
          Answer the checks
        </button>
      )}
    </div>
  );
}

function SignOffTab({
  order,
  onComplete,
  onGoTo,
}: {
  order: OrderDetail;
  onComplete: (result: OrderCompleted) => void;
  onGoTo: (tab: Tab) => void;
}) {
  const complete = useCompleteOrder(order.id);
  const queue = useCountQueue(order.id);
  const [seal, setSeal] = useState('');
  const outbound = order.type === 'outbound';
  // `verified`, not a zero count: counting a line as 0 (nothing arrived) is a count.
  const uncounted = order.items.filter((item) => !item.verified);
  const blockers = order.completion_blockers ?? [];
  const unsent = queue.pending;

  return (
    <Panel title="Sign-off">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-hairline">
            <th className="label py-2">SKU</th>
            <th className="label py-2 text-right">Expected</th>
            <th className="label py-2 text-right">{outbound ? 'Loaded' : 'Received'}</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.id} className="border-b border-hairline">
              <td className="telemetry py-2">{item.sku}</td>
              <td className="telemetry py-2 text-right">{item.expected_quantity}</td>
              <td className="telemetry py-2 text-right">{item.actual_quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!outbound && (
        <p className="mt-3 text-base text-ink-soft">
          Lines outside the customer&apos;s count tolerance ({Math.round(order.count_tolerance * 100)}%) will
          be filed as Count Discrepancy issues automatically.
        </p>
      )}
      {uncounted.length > 0 && (
        <div className="mt-3">
          <Notice title={`${plural(uncounted.length, 'line')} not counted yet`}>
            Count every line before signing off.
          </Notice>
        </div>
      )}
      {unsent > 0 && (
        <div className="mt-3">
          <Notice title={`${plural(unsent, 'count')} not sent yet`}>
            Sign-off waits until DockIQ has every count, so the record matches the trailer.
          </Notice>
        </div>
      )}
      {outbound && (
        <div className="mt-4">
          <FieldLabel htmlFor="seal">Outbound seal number</FieldLabel>
          <input
            id="seal"
            maxLength={64}
            className="field telemetry text-lg uppercase"
            value={seal}
            onChange={(event) => setSeal(event.target.value)}
          />
        </div>
      )}
      {blockers.length > 0 && (
        <div className="mt-3">
          <Notice tone="alert" title="Not ready to sign off">
            <ul className="flex flex-col gap-1">
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
            {!outbound && <EvidenceLinks order={order} onGoTo={onGoTo} />}
          </Notice>
        </div>
      )}
      <div className="mt-4 flex flex-col gap-3">
        <MutationError error={complete.error} />
        <button
          type="button"
          className="btn btn-primary text-lg"
          disabled={
            complete.isPending ||
            unsent > 0 ||
            uncounted.length > 0 ||
            blockers.length > 0 ||
            (outbound && !seal.trim())
          }
          onClick={() =>
            // The promise, not a mutate() callback: it resolves even if the refetched active order has
            // already unmounted this tab. A failure shows through `complete.error`.
            void complete
              .mutateAsync({ seal_number: seal.trim() || null, notes: '' })
              .then(onComplete, () => undefined)
          }
        >
          {complete.isPending
            ? 'Completing…'
            : outbound
              ? 'Confirm load complete'
              : 'Confirm receiving complete'}
        </button>
      </div>
    </Panel>
  );
}

// ── Page ──

function Work({
  orderId,
  onComplete,
}: {
  orderId: number;
  onComplete: (order: OrderDetail, result: OrderCompleted) => void;
}) {
  const order = useOrder(orderId);
  const outbound = order.data?.type === 'outbound';
  const plan = useLoadPlan(outbound ? orderId : undefined);
  // Held here, not in the tab, so the last probe result survives switching tabs.
  const probe = useTemperatureCheck(orderId);
  const loadStep = useLoadStepSync(orderId);
  const tabs: { id: Tab; label: string }[] = outbound
    ? [
        { id: 'plan', label: 'Load plan' },
        { id: 'count', label: 'Scan & count' },
        { id: 'signoff', label: 'Sign-off' },
      ]
    : [
        { id: 'temperature', label: 'Temperature' },
        { id: 'checks', label: 'Checks' },
        { id: 'count', label: 'Scan & count' },
        { id: 'signoff', label: 'Sign-off' },
      ];
  const [tab, setTab] = useState<Tab | null>(null);
  const active = tab ?? tabs[0]?.id ?? 'count';

  return (
    <QueryBoundary query={order} loading="Loading the order">
      {(detail) => (
        <div className="flex flex-col gap-6">
          <PageHeader
            title={`Dock ${detail.door_number ?? '—'}`}
            actions={
              <Link to={reportLink({})} className="btn btn-hazard">
                <TriangleAlert size={18} aria-hidden="true" /> Report issue
              </Link>
            }
          />
          <dl className="fact-strip">
            <div>
              <dt className="label">Job</dt>
              <dd className="mt-1 flex items-center gap-2 font-semibold">
                <span className="file-dot file-green" aria-hidden="true" />
                {outbound ? 'Loading' : 'Receiving'}
              </dd>
            </div>
            <div>
              <dt className="label">Customer</dt>
              <dd className="mt-1 font-semibold">
                {detail.company_name}{' '}
                <span className="font-normal text-ink-mute">· Tier {detail.company_tier}</span>
              </dd>
            </div>
            <div>
              <dt className="label">Order</dt>
              <dd className="telemetry mt-1">{detail.order_number}</dd>
            </div>
            <div>
              <dt className="label">Trailer</dt>
              <dd className="telemetry mt-1">{detail.trailer_number}</dd>
            </div>
            <div>
              <dt className="label">BOL</dt>
              <dd className="telemetry mt-1">{detail.bol_number}</dd>
            </div>
            <div>
              <dt className="label">Carrier</dt>
              <dd className="mt-1 font-semibold">{detail.carrier_name}</dd>
            </div>
          </dl>
          <CountSync orderId={orderId} />
          <Tabs
            tabs={tabs}
            active={active}
            onChange={setTab}
            label="Order steps"
            panelId={PANEL_ID}
            numbered
          />
          <div role="tabpanel" id={PANEL_ID} aria-labelledby={`${PANEL_ID}-tab-${active}`}>
            {active === 'plan' && (
              <QueryBoundary query={plan} loading="Planning the load">
                {(data) => (
                  <LoadPlanView plan={data} initialStep={detail.load_step ?? null} onStep={loadStep} />
                )}
              </QueryBoundary>
            )}
            {active === 'temperature' && <TemperatureTab order={detail} check={probe} />}
            {active === 'checks' && <ChecksTab order={detail} />}
            {active === 'count' && <CountTab order={detail} />}
            {active === 'signoff' && (
              <SignOffTab
                order={detail}
                onComplete={(result) => onComplete(detail, result)}
                onGoTo={setTab}
              />
            )}
          </div>
        </div>
      )}
    </QueryBoundary>
  );
}

export default function OrderWork() {
  const order = useActiveOrder();
  const [done, setDone] = useState<{ order: OrderDetail; result: OrderCompleted } | null>(null);
  if (done) return <OrderDone order={done.order} result={done.result} />;
  if (order.isPending) return <LoadingBlock label="Finding your assignment" />;
  if (order.isError && !order.data) {
    return <ErrorBlock error={order.error} onRetry={() => void order.refetch()} />;
  }
  if (!order.data) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="No order" />
        <EmptyState title="No active assignment">
          Your supervisor assigns a trailer to your dock. It will appear here.
        </EmptyState>
      </div>
    );
  }
  return <Work orderId={order.data.id} onComplete={(detail, result) => setDone({ order: detail, result })} />;
}
