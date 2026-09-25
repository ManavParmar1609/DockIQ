import { Check, Minus, Plus, TriangleAlert } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import {
  useActiveOrder,
  useCompleteOrder,
  useLoadPlan,
  useOrder,
  useScan,
  useCounter,
  useInventory,
  useTemperatureCheck,
} from '../../api/hooks';
import { ApiError } from '../../api/client';
import type { OrderDetail, OrderItem, ScanResult, TemperatureCheck } from '../../api/types';
import { Barcode } from '../../components/Barcode';
import { LoadPlanView } from '../../components/LoadPlanView';
import { ScanField } from '../../components/ScanField';
import {
  EmptyState,
  FieldLabel,
  LoadingBlock,
  MutationError,
  Notice,
  PageHeader,
  Panel,
  QueryBoundary,
} from '../../components/ui';
import { formatTemp, percent } from '../../lib/format';
import { reportLink } from './reportLink';

type Tab = 'plan' | 'temperature' | 'checks' | 'count' | 'signoff';

function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: Tab; label: string }[];
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Order steps"
      className="grid grid-flow-col gap-0.5 overflow-x-auto border-2 border-ink bg-ink"
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex min-h-14 items-center justify-center gap-2 px-3 whitespace-nowrap ${active === tab.id ? 'bg-ink text-light' : 'bg-light'}`}
        >
          <span className="telemetry text-sm">{String(index + 1).padStart(2, '0')}</span>
          <span className="heading text-base">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
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
        className="mt-2 h-3 border-2 border-ink bg-light"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <div className="h-full bg-ink" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

// ── Counting ──

/** Pick locations from the WMS. When the WMS is down, say so plainly: the paper pick list still works. */
function StockLocations({ sku }: { sku: string }) {
  const stock = useInventory(sku);
  if (stock.isPending) return <p className="label">Asking the WMS…</p>;
  if (stock.isError) {
    const offline = stock.error instanceof ApiError && stock.error.status === 503;
    return (
      <p className="border-2 border-ink bg-paper-sunk p-3 text-base">
        {offline
          ? 'WMS offline. Pick from the paper pick list; your counts are kept and sent when it is back.'
          : 'Could not read locations from the WMS.'}
      </p>
    );
  }
  if (stock.data.length === 0) return <p className="text-base">No stock on hand in the WMS.</p>;
  return (
    <ul className="grid gap-0.5 border-2 border-ink bg-ink sm:grid-cols-2">
      {stock.data.map((pallet) => (
        <li key={pallet.pallet_id} className="flex items-baseline justify-between gap-3 bg-light px-3 py-2">
          <span className="telemetry text-lg">{pallet.location}</span>
          <span className="telemetry text-sm text-ink-mute">
            {pallet.cases} cs · {pallet.pallet_id.slice(-6)}
          </span>
        </li>
      ))}
    </ul>
  );
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
    <li className="border-2 border-ink bg-light">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-ink p-4">
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
        <div className="border-b-2 border-ink p-4">
          <StockLocations sku={item.sku} />
        </div>
      )}
      {showCode && item.gtin && (
        <div className="border-b-2 border-ink p-4">
          <Barcode code={item.gtin} label={`Case barcode for ${item.product_name}`} />
        </div>
      )}
      <div className="p-4">
        <ProgressBar done={item.actual_quantity} total={item.expected_quantity} />
        {!outbound && over !== 0 && item.actual_quantity > 0 && (
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
        <div className="mt-3">
          <MutationError error={counter.error} />
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
        <ProgressBar done={counted} total={expected} />
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

function TemperatureTab({ order }: { order: OrderDetail }) {
  const check = useTemperatureCheck(order.id);
  const [reading, setReading] = useState('');
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const value = Number.parseFloat(reading);
    if (!Number.isNaN(value)) check.mutate(value);
  };
  const result: TemperatureCheck | undefined = check.data;
  return (
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
          Check
        </button>
      </form>
      <div className="mt-4">
        <MutationError error={check.error} />
        {result && result.status === 'critical' && (
          <Notice
            tone="alert"
            title={`Critical — ${formatTemp(result.reading)} is ${result.delta ?? 0}°F over`}
            action={
              <Link
                to={reportLink({
                  type: 'Temperature Deviation',
                  subtype: 'Product temperature out of range',
                  temp: result.reading,
                  limit: result.limit ?? undefined,
                  description: `Probe read ${result.reading}°F against a ${result.limit ?? '?'}°F limit`,
                })}
                className="btn btn-hazard"
              >
                Report it
              </Link>
            }
          >
            {result.guidance}
          </Notice>
        )}
        {result && result.status !== 'critical' && (
          <Notice
            title={
              result.status === 'ok'
                ? `OK — within ${formatTemp(result.limit ?? 0)}`
                : result.status === 'not_applicable'
                  ? 'No temperature limit'
                  : `${result.status === 'warning' ? 'Warning' : 'Marginal'} — ${result.delta ?? 0}°F over ${formatTemp(result.limit ?? 0)}`
            }
          >
            {result.guidance}
          </Notice>
        )}
      </div>
    </Panel>
  );
}

const CHECKS = [
  {
    id: 'pallets',
    question: 'Pallets intact?',
    report: { type: 'Damaged Pallet', subtype: 'Damaged or broken pallet' },
  },
  {
    id: 'packaging',
    question: 'Packaging sealed, not punctured?',
    report: { type: 'Damaged Pallet', subtype: 'Damaged cartons or packaging' },
  },
  {
    id: 'labels',
    question: 'Labels readable and matching?',
    report: { type: 'Barcode Issue', subtype: 'Barcode damaged or unreadable' },
  },
  {
    id: 'bol',
    question: 'Product matches the BOL?',
    report: { type: 'SKU Mismatch', subtype: 'Paperwork does not match product' },
  },
  {
    id: 'lot',
    question: 'Lot and expiry verified?',
    report: { type: 'Lot/Expiry Issue', subtype: 'Wrong lot or batch number' },
  },
] as const;

function ChecksTab() {
  const [answers, setAnswers] = useState<Record<string, boolean | undefined>>({});
  return (
    <Panel title="Receiving checks">
      <ul className="flex flex-col gap-3">
        {CHECKS.map((check) => (
          <li
            key={check.id}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3"
          >
            <span className="text-lg font-semibold">{check.question}</span>
            <span className="flex gap-2">
              {([true, false] as const).map((answer) => (
                <button
                  key={String(answer)}
                  type="button"
                  className="choice min-w-20 justify-center"
                  aria-pressed={answers[check.id] === answer}
                  onClick={() => setAnswers((current) => ({ ...current, [check.id]: answer }))}
                >
                  {answer ? 'Yes' : 'No'}
                </button>
              ))}
              {answers[check.id] === false && (
                <Link to={reportLink(check.report)} className="btn btn-hazard">
                  <TriangleAlert size={18} aria-hidden="true" /> Report
                </Link>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ── Sign-off ──

function SignOffTab({ order }: { order: OrderDetail }) {
  const complete = useCompleteOrder(order.id);
  const navigate = useNavigate();
  const [seal, setSeal] = useState('');
  const outbound = order.type === 'outbound';
  const uncounted = order.items.filter((item) => item.actual_quantity === 0);
  const blockers = order.completion_blockers ?? [];

  if (complete.data) {
    const filed = complete.data.discrepancy_issue_ids;
    return (
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
    );
  }

  return (
    <Panel title="Sign-off">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b-2 border-ink">
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
          <Notice title={`${uncounted.length} line${uncounted.length > 1 ? 's' : ''} not counted yet`}>
            Count every line before signing off.
          </Notice>
        </div>
      )}
      {outbound && (
        <div className="mt-4">
          <FieldLabel htmlFor="seal">Outbound seal number</FieldLabel>
          <input
            id="seal"
            className="field telemetry text-lg uppercase"
            value={seal}
            onChange={(event) => setSeal(event.target.value)}
          />
        </div>
      )}
      {blockers.length > 0 && (
        <div className="mt-3">
          <Notice tone="alert" title="Waiting on your supervisor">
            <ul className="flex flex-col gap-1">
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </Notice>
        </div>
      )}
      <div className="mt-4 flex flex-col gap-3">
        <MutationError error={complete.error} />
        <button
          type="button"
          className="btn btn-primary text-lg"
          disabled={
            complete.isPending || uncounted.length > 0 || blockers.length > 0 || (outbound && !seal.trim())
          }
          onClick={() => complete.mutate({ seal_number: seal.trim() || null, notes: '' })}
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

function Work({ orderId }: { orderId: number }) {
  const order = useOrder(orderId);
  const outbound = order.data?.type === 'outbound';
  const plan = useLoadPlan(outbound ? orderId : undefined);
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
            kicker={`${outbound ? 'Loading' : 'Receiving'} · ${detail.company_name} · Tier ${detail.company_tier}`}
            title={`Dock ${detail.door_number ?? '—'}`}
            meta={
              <>
                <span className="telemetry">{detail.order_number}</span>
                <span className="telemetry">Trailer {detail.trailer_number}</span>
                <span className="telemetry">BOL {detail.bol_number}</span>
                <span>{detail.carrier_name}</span>
              </>
            }
            actions={
              <Link to={reportLink({})} className="btn btn-hazard">
                <TriangleAlert size={18} aria-hidden="true" /> Report issue
              </Link>
            }
          />
          <Tabs tabs={tabs} active={active} onChange={setTab} />
          <div role="tabpanel">
            {active === 'plan' && (
              <QueryBoundary query={plan} loading="Planning the load">
                {(data) => <LoadPlanView plan={data} />}
              </QueryBoundary>
            )}
            {active === 'temperature' && <TemperatureTab order={detail} />}
            {active === 'checks' && <ChecksTab />}
            {active === 'count' && <CountTab order={detail} />}
            {active === 'signoff' && <SignOffTab order={detail} />}
          </div>
        </div>
      )}
    </QueryBoundary>
  );
}

export default function OrderWork() {
  const order = useActiveOrder();
  if (order.isPending) return <LoadingBlock label="Finding your assignment" />;
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
  return <Work orderId={order.data.id} />;
}
