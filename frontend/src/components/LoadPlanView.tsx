/**
 * A customer's trailer load plan, drawn from GET /api/orders/{id}/load-plan. The layout itself is
 * computed server-side (backend/app/domain/load_plan.py); this only draws it.
 *
 * Products are told apart by pattern *and* hue (Apple's accessible system colours, never the severity
 * palette), so identity never rests on colour alone. Load order is readable three ways: step numbers
 * on the plan, the step-through control, and the sequence list.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { LoadPlan, PlacedPallet } from '../api/types';
import { formatNumber, formatWeight } from '../lib/format';
import { Notice } from './ui';

const PATTERN_NAME: Record<string, string> = {
  straight: 'Straight',
  turned: 'Turned',
  pinwheel: 'Pinwheel',
};
const SEQUENCE_NAME: Record<string, string> = {
  heaviest_to_nose: 'Heaviest to nose',
  by_category: 'Coldest to nose',
  reverse_stop_order: 'Last stop first',
};
const FILLS = ['solid', 'hatch', 'cross', 'dots', 'rows', 'cols'] as const;
type Fill = (typeof FILLS)[number];

/** Each product's hue, in fill order. The pattern is the non-colour channel. */
const HUE: Record<Fill, { ink: string; tint: string }> = {
  solid: { ink: 'var(--color-accent)', tint: 'var(--color-accent-soft)' },
  hatch: { ink: 'var(--color-teal)', tint: 'var(--color-teal-soft)' },
  cross: { ink: 'var(--color-indigo)', tint: 'var(--color-indigo-soft)' },
  dots: { ink: 'var(--color-mint)', tint: 'var(--color-mint-soft)' },
  rows: { ink: 'var(--color-purple)', tint: 'var(--color-purple-soft)' },
  cols: { ink: 'var(--color-brown)', tint: 'var(--color-brown-soft)' },
};

interface Stack {
  row: number;
  side: 'left' | 'right';
  orientation: string;
  pallets: PlacedPallet[]; // bottom first
}

function stacksOf(pallets: PlacedPallet[]): Stack[] {
  const map = new Map<string, Stack>();
  for (const pallet of pallets) {
    const key = `${pallet.row}-${pallet.side}`;
    const stack = map.get(key) ?? {
      row: pallet.row,
      side: pallet.side === 'left' ? 'left' : 'right',
      orientation: pallet.orientation,
      pallets: [],
    };
    stack.pallets.push(pallet);
    map.set(key, stack);
  }
  for (const stack of map.values()) stack.pallets.sort((a, b) => a.level - b.level);
  return [...map.values()];
}

/** SVG pattern defs: one per product, drawn in the product's hue on its tint. */
function Patterns({ prefix }: { prefix: string }) {
  const { hatch, cross, dots, rows, cols } = HUE;
  return (
    <defs>
      <pattern
        id={`${prefix}-hatch`}
        width="10"
        height="10"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <rect width="10" height="10" fill={hatch.tint} />
        <line x1="0" y1="0" x2="0" y2="10" stroke={hatch.ink} strokeWidth="2.5" />
      </pattern>
      <pattern
        id={`${prefix}-cross`}
        width="11"
        height="11"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <rect width="11" height="11" fill={cross.tint} />
        <path d="M0 0V11M0 0H11" stroke={cross.ink} strokeWidth="1.6" />
      </pattern>
      <pattern id={`${prefix}-dots`} width="9" height="9" patternUnits="userSpaceOnUse">
        <rect width="9" height="9" fill={dots.tint} />
        <circle cx="4.5" cy="4.5" r="1.8" fill={dots.ink} />
      </pattern>
      <pattern id={`${prefix}-rows`} width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill={rows.tint} />
        <rect width="8" height="2.5" fill={rows.ink} />
      </pattern>
      <pattern id={`${prefix}-cols`} width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill={cols.tint} />
        <rect width="2.5" height="8" fill={cols.ink} />
      </pattern>
    </defs>
  );
}

function fillFor(prefix: string, fill: Fill): string {
  return fill === 'solid' ? HUE.solid.tint : `url(#${prefix}-${fill})`;
}

function Swatch({ fill, prefix }: { fill: Fill; prefix: string }) {
  return (
    <svg width="32" height="24" aria-hidden="true" className="shrink-0">
      <Patterns prefix={`${prefix}-sw`} />
      <rect
        x="1"
        y="1"
        width="30"
        height="22"
        rx="6"
        fill={fillFor(`${prefix}-sw`, fill)}
        stroke={HUE[fill].ink}
        strokeWidth="2"
      />
    </svg>
  );
}

// ── Top view ──

const CELL = 64; // one floor row along the trailer
const LANE = 72; // one of two pallets across
const NOSE = 92; // reefer unit block
const PAD = 34;

function TopView({
  plan,
  stacks,
  fills,
  step,
  onPick,
}: {
  plan: LoadPlan;
  stacks: Stack[];
  fills: Map<string, Fill>;
  step: number;
  onPick: (sequence: number) => void;
}) {
  const prefix = 'lp-top';
  const bodyWidth = plan.rows * CELL;
  const width = NOSE + bodyWidth + 70;
  const height = PAD * 2 + LANE * 2;
  const bySlot = new Map(stacks.map((stack) => [`${stack.row}-${stack.side}`, stack]));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Top view of the trailer: ${plan.stacks_used} stacks on ${plan.floor_positions} floor positions`}
      className="figure-wide block w-full"
    >
      <Patterns prefix={prefix} />
      {/* Reefer unit / nose */}
      <rect x="0" y={PAD} width={NOSE - 10} height={LANE * 2} rx="14" fill="var(--color-paper-deep)" />
      <text
        x={(NOSE - 10) / 2}
        y={PAD + LANE - 6}
        textAnchor="middle"
        fill="var(--color-ink)"
        fontSize="20"
        fontWeight="600"
        fontFamily="var(--font-sans)"
      >
        Nose
      </text>
      <text
        x={(NOSE - 10) / 2}
        y={PAD + LANE + 18}
        textAnchor="middle"
        fill="var(--color-ink-mute)"
        fontSize="17"
        fontFamily="var(--font-sans)"
      >
        Reefer
      </text>
      {/* Trailer body */}
      <rect
        x={NOSE}
        y={PAD}
        width={bodyWidth}
        height={LANE * 2}
        rx="14"
        fill="var(--color-paper)"
        stroke="var(--color-hairline)"
        strokeWidth="2"
      />
      <line
        x1={NOSE + 10}
        y1={PAD + LANE}
        x2={NOSE + bodyWidth - 10}
        y2={PAD + LANE}
        stroke="var(--color-hairline)"
        strokeWidth="1.5"
        strokeDasharray="5 6"
      />
      {/* Doors */}
      <path
        d={`M${NOSE + bodyWidth + 8} ${PAD + 6} v${LANE * 2 - 12}`}
        stroke="var(--color-ink-mute)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <text
        x={NOSE + bodyWidth + 38}
        y={PAD + LANE + 6}
        textAnchor="middle"
        fontSize="18"
        fontWeight="600"
        fontFamily="var(--font-sans)"
        fill="var(--color-ink-mute)"
        transform={`rotate(90 ${NOSE + bodyWidth + 38} ${PAD + LANE})`}
      >
        Doors
      </text>
      {/* Side labels, as seen from the doors looking at the nose */}
      <text x={0} y={PAD - 12} fontSize="17" fontFamily="var(--font-sans)" fill="var(--color-ink-mute)">
        Right side
      </text>
      <text x={0} y={height - 8} fontSize="17" fontFamily="var(--font-sans)" fill="var(--color-ink-mute)">
        Left side
      </text>
      {/* Row numbers */}
      {Array.from({ length: plan.rows }, (_, row) => (
        <text
          key={row}
          x={NOSE + row * CELL + CELL / 2}
          y={PAD - 12}
          textAnchor="middle"
          fontSize="17"
          fontFamily="var(--font-sans)"
          fill="var(--color-ink-mute)"
        >
          {row + 1}
        </text>
      ))}

      {Array.from({ length: plan.rows }, (_, row) =>
        (['right', 'left'] as const).map((side, lane) => {
          const x = NOSE + row * CELL;
          const y = PAD + lane * LANE;
          const stack = bySlot.get(`${row}-${side}`);
          if (!stack) {
            return (
              <rect
                key={`${row}-${side}`}
                x={x + 6}
                y={y + 8}
                width={CELL - 12}
                height={LANE - 16}
                rx="8"
                fill="none"
                stroke="var(--color-hairline)"
                strokeWidth="1.5"
                strokeDasharray="4 5"
              />
            );
          }
          // Footprint: a 48×40 pallet; its long side runs along the trailer when "lengthwise".
          const along = stack.orientation === 'lengthwise' ? CELL - 8 : (CELL - 8) * (40 / 48);
          const across = stack.orientation === 'lengthwise' ? (LANE - 12) * (40 / 48) : LANE - 12;
          const px = x + (CELL - along) / 2;
          const py = y + (LANE - across) / 2;
          const bottom = stack.pallets[0];
          if (!bottom) return null;
          const active = stack.pallets.some((pallet) => pallet.load_sequence === step);
          const fill = fills.get(bottom.sku) ?? 'solid';
          return (
            <g
              key={`${row}-${side}`}
              role="button"
              tabIndex={0}
              aria-label={`Row ${row + 1} ${side}: ${stack.pallets.length} pallet${stack.pallets.length > 1 ? 's' : ''}, first loaded at step ${bottom.load_sequence}`}
              onClick={() => onPick(bottom.load_sequence)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onPick(bottom.load_sequence);
              }}
              className="cursor-pointer"
            >
              {stack.pallets.length > 1 && (
                <rect
                  x={px + 5}
                  y={py - 5}
                  width={along}
                  height={across}
                  rx="8"
                  fill="var(--color-paper-deep)"
                  stroke="var(--color-hairline)"
                  strokeWidth="1.5"
                />
              )}
              <rect
                x={px}
                y={py}
                width={along}
                height={across}
                rx="8"
                fill={fillFor(prefix, fill)}
                stroke={active ? 'var(--color-ink)' : HUE[fill].ink}
                strokeWidth={active ? 5 : 2}
              />
              <rect
                x={px + 4}
                y={py + 4}
                width="34"
                height="24"
                rx="12"
                fill={active ? 'var(--color-accent)' : 'var(--color-surface)'}
              />
              <text
                x={px + 21}
                y={py + 21.5}
                textAnchor="middle"
                fontSize="17"
                fontWeight="700"
                fontFamily="var(--font-sans)"
                fill={active ? 'var(--color-white)' : 'var(--color-ink)'}
              >
                {bottom.load_sequence}
              </text>
              {stack.pallets.length > 1 && (
                <text
                  x={px + along - 4}
                  y={py + across - 6}
                  textAnchor="end"
                  fontSize="17"
                  fontWeight="700"
                  fontFamily="var(--font-sans)"
                  fill="var(--color-ink)"
                  stroke="var(--color-surface)"
                  strokeWidth="4"
                  paintOrder="stroke"
                >
                  ×{stack.pallets.length}
                </text>
              )}
            </g>
          );
        }),
      )}
    </svg>
  );
}

// ── Side elevation ──

const COLUMN = 88;
const LAYER = 44;

function Elevation({
  plan,
  stacks,
  fills,
  step,
  side,
}: {
  plan: LoadPlan;
  stacks: Stack[];
  fills: Map<string, Fill>;
  step: number;
  side: 'left' | 'right';
}) {
  const prefix = `lp-elev-${side}`;
  const lane = stacks.filter((stack) => stack.side === side);
  const levels = Math.max(plan.max_height, 1);
  // Stacking is the point here, not floor position: draw the rows in use plus one empty for context.
  const shownRows = Math.min(plan.rows, Math.max(4, Math.max(...stacks.map((stack) => stack.row)) + 2));
  const width = shownRows * COLUMN + 20;
  const height = levels * LAYER + 56;
  const floor = height - 28;
  const bySlot = new Map(lane.map((stack) => [stack.row, stack]));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${side} side elevation`}
      className={`block w-full ${shownRows > 8 ? 'figure-wide' : ''}`}
      style={{ maxWidth: `${width * 1.15}px` }}
    >
      <Patterns prefix={prefix} />
      <line
        x1="2"
        y1={floor}
        x2={width - 2}
        y2={floor}
        stroke="var(--color-ink-mute)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <text x="4" y={height - 6} fontSize="17" fontFamily="var(--font-sans)" fill="var(--color-ink-mute)">
        Nose → doors · {side} side
      </text>
      {Array.from({ length: shownRows }, (_, row) => {
        const stack = bySlot.get(row);
        const x = 10 + row * COLUMN;
        return (
          <g key={row}>
            {stack?.pallets.map((pallet) => {
              const y = floor - (pallet.level + 1) * LAYER;
              const active = pallet.load_sequence === step;
              return (
                <g key={pallet.load_sequence}>
                  <rect
                    x={x + 3}
                    y={y + 2}
                    width={COLUMN - 6}
                    height={LAYER - 4}
                    rx="6"
                    fill={fillFor(prefix, fills.get(pallet.sku) ?? 'solid')}
                    stroke={active ? 'var(--color-ink)' : HUE[fills.get(pallet.sku) ?? 'solid'].ink}
                    strokeWidth={active ? 4 : 1.5}
                  />
                  <text
                    x={x + COLUMN / 2}
                    y={y + LAYER / 2 + 6}
                    textAnchor="middle"
                    fontSize="17"
                    fontWeight="600"
                    fontFamily="var(--font-sans)"
                    fill="var(--color-ink)"
                    stroke="var(--color-surface)"
                    strokeWidth="4"
                    paintOrder="stroke"
                  >
                    {formatNumber(Math.round(pallet.weight_lbs))}
                  </text>
                  {plan.slip_sheets && pallet.level > 0 && (
                    <line
                      x1={x}
                      y1={y + LAYER}
                      x2={x + COLUMN}
                      y2={y + LAYER}
                      stroke="var(--color-ink-soft)"
                      strokeWidth="2.5"
                      strokeDasharray="8 5"
                    />
                  )}
                </g>
              );
            })}
            {!stack && (
              <rect
                x={x + 3}
                y={floor - LAYER + 2}
                width={COLUMN - 6}
                height={LAYER - 4}
                rx="6"
                fill="none"
                stroke="var(--color-hairline)"
                strokeDasharray="4 5"
              />
            )}
          </g>
        );
      })}
      {/* Height limit */}
      <line
        x1="0"
        y1={floor - levels * LAYER}
        x2={width}
        y2={floor - levels * LAYER}
        stroke="var(--color-ink-mute)"
        strokeWidth="1.5"
        strokeDasharray="2 6"
      />
      <text
        x={width - 6}
        y={floor - levels * LAYER - 6}
        textAnchor="end"
        fontSize="17"
        fontFamily="var(--font-sans)"
        fill="var(--color-ink-mute)"
      >
        Max {levels} high
      </text>
    </svg>
  );
}

// ── Composite ──

export function LoadPlanView({ plan }: { plan: LoadPlan }) {
  const stacks = useMemo(() => stacksOf(plan.pallets), [plan.pallets]);
  const products = useMemo(() => {
    const seen = new Map<
      string,
      { sku: string; name: string; category: string; pallets: number; fill: Fill }
    >();
    for (const pallet of plan.pallets) {
      const entry = seen.get(pallet.sku);
      if (entry) entry.pallets += 1;
      else
        seen.set(pallet.sku, {
          sku: pallet.sku,
          name: pallet.product_name,
          category: pallet.category,
          pallets: 1,
          fill: FILLS[seen.size % FILLS.length] ?? 'solid',
        });
    }
    return [...seen.values()];
  }, [plan.pallets]);
  const fills = useMemo(() => new Map(products.map((product) => [product.sku, product.fill])), [products]);
  const [step, setStep] = useState(1);
  const total = plan.pallets.length;
  const current = plan.pallets.find((pallet) => pallet.load_sequence === step);

  if (total === 0) {
    return <Notice title="Nothing to load">This order has no pallets.</Notice>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header telemetry */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Pattern', PATTERN_NAME[plan.floor_pattern] ?? plan.floor_pattern],
          ['Sequence', SEQUENCE_NAME[plan.sequence] ?? plan.sequence],
          ['Pallets', `${plan.total_pallets} in ${plan.stacks_used} of ${plan.floor_positions} spots`],
          ['Weight', formatWeight(plan.total_weight_lbs)],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <p className="label">{label}</p>
            <p className="mt-0.5 text-lg font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {plan.warnings.map((warning) => (
        <Notice key={warning} tone="alert" title="Load exceeds a limit">
          {warning}
        </Notice>
      ))}

      {/* Step-through */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-paper-sunk p-2">
        <button
          type="button"
          className="btn btn-secondary bg-surface px-4"
          aria-label="Previous step"
          disabled={step <= 1}
          onClick={() => setStep((value) => Math.max(1, value - 1))}
        >
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="label">
            Load step <span className="telemetry">{step}</span> of {total}
          </p>
          {current && (
            <p className="mt-0.5 text-base font-semibold">
              Row {current.row + 1} · {current.side} ·{' '}
              {current.level === 0 ? 'on the floor' : `layer ${current.level + 1}`}.{' '}
              <span className="telemetry">{current.sku}</span> · {current.cases} cases ·{' '}
              {formatWeight(current.weight_lbs)}
              {current.partial && ' · partial'}
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn btn-secondary bg-surface px-4"
          aria-label="Next step"
          disabled={step >= total}
          onClick={() => setStep((value) => Math.min(total, value + 1))}
        >
          <ChevronRight size={22} aria-hidden="true" />
        </button>
      </div>

      {/* Top view */}
      <figure className="card overflow-hidden">
        <figcaption className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
          <span className="heading text-lg">Top view</span>
          <span className="label">Tap a stack to jump to it</span>
        </figcaption>
        <div className="overflow-x-auto px-3 pt-2 pb-4">
          <TopView plan={plan} stacks={stacks} fills={fills} step={step} onPick={setStep} />
        </div>
      </figure>

      {/* Elevations */}
      <figure className="card overflow-hidden">
        <figcaption className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
          <span className="heading text-lg">Side view</span>
          <span className="label">
            Weight per pallet (lb){plan.slip_sheets ? ' · dashed line = slip sheet' : ''}
          </span>
        </figcaption>
        <div className="grid gap-4 overflow-x-auto px-3 pt-2 pb-4 xl:grid-cols-2">
          <Elevation plan={plan} stacks={stacks} fills={fills} step={step} side="right" />
          <Elevation plan={plan} stacks={stacks} fills={fills} step={step} side="left" />
        </div>
      </figure>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Legend */}
        <div className="card overflow-hidden pb-2">
          <p className="heading px-5 pt-4 pb-1 text-lg">Products</p>
          <ul>
            {products.map((product) => (
              <li
                key={product.sku}
                className="mx-5 flex items-center gap-3 border-b border-hairline py-3 last:border-b-0"
              >
                <Swatch fill={product.fill} prefix={product.sku} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{product.name}</p>
                  <p className="telemetry text-sm text-ink-mute">
                    {product.sku} · {product.category}
                  </p>
                </div>
                <span className="telemetry">{product.pallets} plt</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Rules */}
        <div className="card overflow-hidden pb-2">
          <p className="heading px-5 pt-4 pb-1 text-lg">{plan.company_name} loading rules</p>
          <ol className="mx-5 divide-y divide-hairline">
            {plan.checklist.map((rule, index) => (
              <li key={rule} className="flex gap-3 py-3 text-base">
                <span className="telemetry grid h-6 w-6 shrink-0 place-items-center rounded-full bg-paper-sunk text-sm text-ink-soft">
                  {index + 1}
                </span>
                <span className="font-medium">{rule}</span>
              </li>
            ))}
          </ol>
          {plan.special && (
            <div className="m-3 mt-2 rounded-lg bg-paper-sunk px-4 py-3">
              <p className="label">Customer instruction</p>
              <p className="mt-1 text-base font-semibold">{plan.special}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
