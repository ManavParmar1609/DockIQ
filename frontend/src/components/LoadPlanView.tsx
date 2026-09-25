/**
 * A customer's trailer load plan, drawn from GET /api/orders/{id}/load-plan. The layout itself is
 * computed server-side (backend/app/domain/load_plan.py); this only draws it.
 *
 * Products are told apart by ink pattern, never colour — red is reserved for alerts. Load order is
 * readable three ways: step numbers on the plan, the step-through control, and the sequence list.
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

/** SVG pattern defs: one per product, in ink on paper. */
function Patterns({ prefix }: { prefix: string }) {
  const ink = 'var(--color-ink)';
  return (
    <defs>
      <pattern
        id={`${prefix}-hatch`}
        width="10"
        height="10"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <rect width="10" height="10" fill="var(--color-light)" />
        <line x1="0" y1="0" x2="0" y2="10" stroke={ink} strokeWidth="3.5" />
      </pattern>
      <pattern
        id={`${prefix}-cross`}
        width="11"
        height="11"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <rect width="11" height="11" fill="var(--color-light)" />
        <path d="M0 0V11M0 0H11" stroke={ink} strokeWidth="2.2" />
      </pattern>
      <pattern id={`${prefix}-dots`} width="9" height="9" patternUnits="userSpaceOnUse">
        <rect width="9" height="9" fill="var(--color-light)" />
        <circle cx="4.5" cy="4.5" r="2" fill={ink} />
      </pattern>
      <pattern id={`${prefix}-rows`} width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill="var(--color-light)" />
        <rect width="8" height="3" fill={ink} />
      </pattern>
      <pattern id={`${prefix}-cols`} width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill="var(--color-light)" />
        <rect width="3" height="8" fill={ink} />
      </pattern>
    </defs>
  );
}

function fillFor(prefix: string, fill: Fill): string {
  return fill === 'solid' ? 'var(--color-ink-soft)' : `url(#${prefix}-${fill})`;
}

function Swatch({ fill, prefix }: { fill: Fill; prefix: string }) {
  return (
    <svg width="28" height="20" aria-hidden="true" className="shrink-0 border-2 border-ink">
      <Patterns prefix={`${prefix}-sw`} />
      <rect width="28" height="20" fill={fillFor(`${prefix}-sw`, fill)} />
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
      <rect x="0" y={PAD} width={NOSE - 8} height={LANE * 2} fill="var(--color-ink)" />
      <text
        x={(NOSE - 8) / 2}
        y={PAD + LANE - 8}
        textAnchor="middle"
        fill="var(--color-light)"
        fontSize="23"
        fontWeight="800"
        fontFamily="var(--font-sans)"
      >
        NOSE
      </text>
      <text
        x={(NOSE - 8) / 2}
        y={PAD + LANE + 18}
        textAnchor="middle"
        fill="var(--color-light)"
        fontSize="19"
        fontFamily="var(--font-mono)"
      >
        REEFER
      </text>
      {/* Trailer body */}
      <rect
        x={NOSE}
        y={PAD}
        width={bodyWidth}
        height={LANE * 2}
        fill="var(--color-paper)"
        stroke="var(--color-ink)"
        strokeWidth="4"
      />
      <line
        x1={NOSE}
        y1={PAD + LANE}
        x2={NOSE + bodyWidth}
        y2={PAD + LANE}
        stroke="var(--color-hairline)"
        strokeWidth="2"
        strokeDasharray="6 6"
      />
      {/* Doors */}
      <path d={`M${NOSE + bodyWidth + 6} ${PAD} v${LANE * 2}`} stroke="var(--color-ink)" strokeWidth="6" />
      <text
        x={NOSE + bodyWidth + 38}
        y={PAD + LANE + 7}
        textAnchor="middle"
        fontSize="21"
        fontWeight="800"
        fontFamily="var(--font-sans)"
        fill="var(--color-ink)"
        transform={`rotate(90 ${NOSE + bodyWidth + 38} ${PAD + LANE})`}
      >
        DOORS
      </text>
      {/* Side labels, as seen from the doors looking at the nose */}
      <text x={0} y={PAD - 10} fontSize="19" fontFamily="var(--font-mono)" fill="var(--color-ink-mute)">
        RIGHT
      </text>
      <text x={0} y={height - 8} fontSize="19" fontFamily="var(--font-mono)" fill="var(--color-ink-mute)">
        LEFT
      </text>
      {/* Row numbers */}
      {Array.from({ length: plan.rows }, (_, row) => (
        <text
          key={row}
          x={NOSE + row * CELL + CELL / 2}
          y={PAD - 10}
          textAnchor="middle"
          fontSize="18"
          fontFamily="var(--font-mono)"
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
                x={x + 5}
                y={y + 7}
                width={CELL - 10}
                height={LANE - 14}
                fill="none"
                stroke="var(--color-hairline)"
                strokeWidth="1.5"
                strokeDasharray="4 4"
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
                  fill="var(--color-paper-deep)"
                  stroke="var(--color-ink)"
                  strokeWidth="2"
                />
              )}
              <rect
                x={px}
                y={py}
                width={along}
                height={across}
                fill={fillFor(prefix, fill)}
                stroke="var(--color-ink)"
                strokeWidth={active ? 6 : 2.5}
              />
              <rect
                x={px + 3}
                y={py + 3}
                width="36"
                height="24"
                fill={active ? 'var(--color-ink)' : 'var(--color-light)'}
                stroke="var(--color-ink)"
                strokeWidth="1.5"
              />
              <text
                x={px + 21}
                y={py + 21}
                textAnchor="middle"
                fontSize="20"
                fontWeight="700"
                fontFamily="var(--font-mono)"
                fill={active ? 'var(--color-light)' : 'var(--color-ink)'}
              >
                {String(bottom.load_sequence).padStart(2, '0')}
              </text>
              {stack.pallets.length > 1 && (
                <text
                  x={px + along - 4}
                  y={py + across - 6}
                  textAnchor="end"
                  fontSize="19"
                  fontWeight="800"
                  fontFamily="var(--font-mono)"
                  fill="var(--color-ink)"
                  stroke="var(--color-light)"
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
      <line x1="0" y1={floor} x2={width} y2={floor} stroke="var(--color-ink)" strokeWidth="4" />
      <text x="4" y={height - 6} fontSize="18" fontFamily="var(--font-mono)" fill="var(--color-ink-mute)">
        NOSE →→ DOORS · {side.toUpperCase()} SIDE
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
                    fill={fillFor(prefix, fills.get(pallet.sku) ?? 'solid')}
                    stroke="var(--color-ink)"
                    strokeWidth={active ? 5 : 2}
                  />
                  <text
                    x={x + COLUMN / 2}
                    y={y + LAYER / 2 + 6}
                    textAnchor="middle"
                    fontSize="18"
                    fontWeight="700"
                    fontFamily="var(--font-mono)"
                    fill="var(--color-ink)"
                    stroke="var(--color-light)"
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
                      stroke="var(--color-ink)"
                      strokeWidth="3"
                      strokeDasharray="10 4"
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
                fill="none"
                stroke="var(--color-hairline)"
                strokeDasharray="4 4"
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
        fontSize="18"
        fontFamily="var(--font-mono)"
        fill="var(--color-ink-mute)"
      >
        MAX {levels} HIGH
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
      <div className="grid grid-cols-2 gap-0.5 border-2 border-ink bg-ink sm:grid-cols-4">
        {[
          ['Pattern', PATTERN_NAME[plan.floor_pattern] ?? plan.floor_pattern],
          ['Sequence', SEQUENCE_NAME[plan.sequence] ?? plan.sequence],
          ['Pallets', `${plan.total_pallets} in ${plan.stacks_used} of ${plan.floor_positions} spots`],
          ['Weight', formatWeight(plan.total_weight_lbs)],
        ].map(([label, value]) => (
          <div key={label} className="bg-light p-3">
            <p className="label">{label}</p>
            <p className="telemetry mt-1 text-lg">{value}</p>
          </div>
        ))}
      </div>

      {plan.warnings.map((warning) => (
        <Notice key={warning} tone="alert" title="Load exceeds a limit">
          {warning}
        </Notice>
      ))}

      {/* Step-through */}
      <div className="flex flex-wrap items-center gap-3 border-2 border-ink bg-ink p-2 text-light">
        <button
          type="button"
          className="btn border-light bg-transparent text-light"
          aria-label="Previous step"
          disabled={step <= 1}
          onClick={() => setStep((value) => Math.max(1, value - 1))}
        >
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="label text-light">
            Load step <span className="telemetry">{String(step).padStart(2, '0')}</span> of {total}
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
          className="btn border-light bg-transparent text-light"
          aria-label="Next step"
          disabled={step >= total}
          onClick={() => setStep((value) => Math.min(total, value + 1))}
        >
          <ChevronRight size={22} aria-hidden="true" />
        </button>
      </div>

      {/* Top view */}
      <figure className="border-2 border-ink bg-light">
        <figcaption className="label border-b-2 border-ink px-4 py-2 text-ink">
          Top view: tap a stack
        </figcaption>
        <div className="overflow-x-auto p-3">
          <TopView plan={plan} stacks={stacks} fills={fills} step={step} onPick={setStep} />
        </div>
      </figure>

      {/* Elevations */}
      <figure className="border-2 border-ink bg-light">
        <figcaption className="label border-b-2 border-ink px-4 py-2 text-ink">
          Side elevation: weight per pallet (lb){plan.slip_sheets ? ' · dashed line = slip sheet' : ''}
        </figcaption>
        <div className="grid gap-4 overflow-x-auto p-3 xl:grid-cols-2">
          <Elevation plan={plan} stacks={stacks} fills={fills} step={step} side="right" />
          <Elevation plan={plan} stacks={stacks} fills={fills} step={step} side="left" />
        </div>
      </figure>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Legend */}
        <div className="border-2 border-ink bg-light">
          <p className="heading border-b-2 border-ink px-4 py-2 text-lg">Products</p>
          <ul>
            {products.map((product) => (
              <li
                key={product.sku}
                className="flex items-center gap-3 border-b border-hairline px-4 py-2.5 last:border-b-0"
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
        <div className="border-2 border-ink bg-light">
          <p className="heading border-b-2 border-ink px-4 py-2 text-lg">{plan.company_name} loading rules</p>
          <ol className="divide-y divide-hairline">
            {plan.checklist.map((rule, index) => (
              <li key={rule} className="flex gap-3 px-4 py-2.5 text-base">
                <span className="telemetry text-ink-mute">{String(index + 1).padStart(2, '0')}</span>
                <span className="font-semibold">{rule}</span>
              </li>
            ))}
          </ol>
          {plan.special && (
            <div className="border-t-2 border-ink bg-paper-sunk px-4 py-3">
              <p className="label">Customer instruction</p>
              <p className="mt-1 text-base font-semibold">{plan.special}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
