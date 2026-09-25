/**
 * The loading guide for a customer's trailer, from GET /api/orders/{id}/load-plan. The layout itself
 * is computed server-side (backend/app/domain/load_plan.py); this only guides the operator through it.
 *
 * The picture does the explaining. It is drawn from where the operator stands: looking into the
 * trailer from the dock door, nose at the far end, their left on the left. Loaded pallets stand in
 * place; the next one is a glowing outline in its exact spot with an arrow to it, and the view walks
 * in as the load fills toward the nose. Products are told apart by pattern *and* hue (never the
 * severity palette). Progress is remembered per order, so leaving the screen does not lose the place.
 */
import { Check, ChevronLeft, ChevronRight, Layers, PackageCheck, Weight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { LoadPlan, PlacedPallet } from '../api/types';
import { formatWeight } from '../lib/format';
import { Notice } from './ui';

const SEQUENCE_NAME: Record<string, string> = {
  heaviest_to_nose: 'Heaviest to the nose',
  by_category: 'Coldest to the nose',
  reverse_stop_order: 'Last stop first',
};
const FILLS = ['solid', 'hatch', 'cross', 'dots', 'rows', 'cols'] as const;
type Fill = (typeof FILLS)[number];

/** Each product's hue, in fill order. The pattern is the non-colour channel. */
const HUE: Record<Fill, { ink: string; tint: string }> = {
  solid: { ink: 'var(--color-sage-ink)', tint: 'var(--color-accent-soft)' },
  hatch: { ink: 'var(--color-teal)', tint: 'var(--color-teal-soft)' },
  cross: { ink: 'var(--color-indigo)', tint: 'var(--color-indigo-soft)' },
  dots: { ink: 'var(--color-mint)', tint: 'var(--color-mint-soft)' },
  rows: { ink: 'var(--color-purple)', tint: 'var(--color-purple-soft)' },
  cols: { ink: 'var(--color-brown)', tint: 'var(--color-brown-soft)' },
};

interface Stack {
  row: number;
  side: 'left' | 'right';
  pallets: PlacedPallet[]; // bottom first
}

interface Product {
  sku: string;
  name: string;
  category: string;
  pallets: number;
  fill: Fill;
}

function stacksOf(pallets: PlacedPallet[]): Stack[] {
  const map = new Map<string, Stack>();
  for (const pallet of pallets) {
    const key = `${pallet.row}-${pallet.side}`;
    const stack = map.get(key) ?? {
      row: pallet.row,
      side: pallet.side === 'left' ? 'left' : 'right',
      pallets: [],
    };
    stack.pallets.push(pallet);
    map.set(key, stack);
  }
  for (const stack of map.values()) stack.pallets.sort((a, b) => a.level - b.level);
  return [...map.values()];
}

/** The step the operator is on, remembered for this order for the rest of the session. */
function useLoadStep(orderId: number, total: number, persist: boolean): [number, (step: number) => void] {
  const key = `dockiq.load-step.${String(orderId)}`;
  const [step, setStep] = useState(() => {
    if (!persist) return 1;
    try {
      const saved = Number(sessionStorage.getItem(key));
      return saved >= 1 && saved <= total + 1 ? saved : 1;
    } catch {
      return 1;
    }
  });
  useEffect(() => {
    if (!persist) return;
    try {
      sessionStorage.setItem(key, String(step));
    } catch {
      /* private mode: the step lasts for this page load only */
    }
  }, [key, step, persist]);
  return [step, (next: number) => setStep(Math.min(total + 1, Math.max(1, next)))];
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Eases a number toward its target over ~half a second; jumps when motion is reduced. */
function useGlide(target: number): number {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const origin = current.current;
    const duration = prefersReducedMotion() ? 0 : 560;
    let start: number | null = null;
    let frame = 0;
    const tick = (now: number) => {
      start ??= now;
      const t = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
      const next = origin + (target - origin) * (1 - (1 - t) ** 3);
      current.current = next;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

// ── Patterns and swatches ──

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

function Swatch({ fill, prefix, size = 32 }: { fill: Fill; prefix: string; size?: number }) {
  return (
    <svg
      width={size}
      height={Math.round(size * 0.75)}
      viewBox="0 0 32 24"
      aria-hidden="true"
      className="shrink-0"
    >
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

// ── The view into the trailer, from the dock door ──
// World units are one pallet width (~40"): x across (0 = centre line), y up from the trailer floor,
// z into the trailer from the door (z = 0). Row 0 is against the nose, the far end.

const VIEW_W = 640;
const VIEW_H = 420;
const CX = VIEW_W / 2;
const HORIZON = 188;
const FOCAL = 290;
const EYE = 1.5; // eye height standing on the dock
const HALF_WIDTH = 1.25; // inside wall to centre line
const HEIGHT = 2.7; // floor to ceiling
const ROW_DEPTH = 1.2; // one pallet's 48" length
const LEVEL = 1.12; // one loaded pallet, deck included
const DECK = 0.15; // the wooden pallet under the load
const LANE: Record<'left' | 'right', readonly [number, number]> = {
  left: [-1.18, -0.06],
  right: [0.06, 1.18],
};
const DOCK_CAMERA = -2.0; // on the dock, two pallet-lengths back from the door
const NEAR = 0.3;

type Point = readonly [number, number, number];

function project(camera: number, [x, y, z]: Point): [number, number] {
  const distance = Math.max(z - camera, NEAR);
  return [CX + (FOCAL * x) / distance, HORIZON - (FOCAL * (y - EYE)) / distance];
}

function polygon(camera: number, points: readonly Point[]): string {
  return points
    .map((point) => project(camera, point))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
}

interface Placed {
  pallet: PlacedPallet;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  zNear: number;
  zFar: number;
}

function place(pallet: PlacedPallet, length: number): Placed {
  const [x0, x1] = LANE[pallet.side === 'left' ? 'left' : 'right'];
  const zFar = length - pallet.row * ROW_DEPTH - 0.04;
  return {
    pallet,
    x0,
    x1,
    y0: pallet.level * LEVEL,
    y1: pallet.level * LEVEL + LEVEL - 0.05,
    zNear: zFar - ROW_DEPTH + 0.1,
    zFar,
  };
}

/** One pallet as a box: top and inner side (whichever face the eye can see), then the front. */
function PalletBox({
  camera,
  box,
  fill,
  prefix,
  ghost = false,
  faded = false,
  fresh = false,
}: {
  camera: number;
  box: Placed;
  fill: Fill;
  prefix: string;
  ghost?: boolean;
  faded?: boolean;
  fresh?: boolean;
}) {
  const { x0, x1, y0, y1, zNear, zFar } = box;
  const front: Point[] = [
    [x0, y0, zNear],
    [x1, y0, zNear],
    [x1, y1, zNear],
    [x0, y1, zNear],
  ];
  const deckFront: Point[] = [
    [x0, y0, zNear],
    [x1, y0, zNear],
    [x1, y0 + DECK, zNear],
    [x0, y0 + DECK, zNear],
  ];
  const top: Point[] | null =
    y1 < EYE
      ? [
          [x0, y1, zNear],
          [x1, y1, zNear],
          [x1, y1, zFar],
          [x0, y1, zFar],
        ]
      : null;
  const sideX = x1 < 0 ? x1 : x0 > 0 ? x0 : null;
  const side: Point[] | null =
    sideX === null
      ? null
      : [
          [sideX, y0, zNear],
          [sideX, y0, zFar],
          [sideX, y1, zFar],
          [sideX, y1, zNear],
        ];
  const pocketWidth = (x1 - x0) * 0.22;
  const pockets = [0.2, 0.58].map((at): Point[] => {
    const left = x0 + (x1 - x0) * at;
    return [
      [left, y0 + 0.03, zNear],
      [left + pocketWidth, y0 + 0.03, zNear],
      [left + pocketWidth, y0 + DECK - 0.04, zNear],
      [left, y0 + DECK - 0.04, zNear],
    ];
  });
  const ink = HUE[fill].ink;
  const surface = fillFor(prefix, fill);

  if (ghost) {
    return (
      <g className="lp-ghost">
        {side && (
          <polygon
            points={polygon(camera, side)}
            fill={surface}
            fillOpacity="0.45"
            stroke="var(--color-ink)"
            strokeWidth="2"
            strokeDasharray="7 5"
          />
        )}
        {top && (
          <polygon
            points={polygon(camera, top)}
            fill={surface}
            fillOpacity="0.45"
            stroke="var(--color-ink)"
            strokeWidth="2"
            strokeDasharray="7 5"
          />
        )}
        <polygon
          points={polygon(camera, front)}
          fill={surface}
          fillOpacity="0.6"
          stroke="var(--color-ink)"
          strokeWidth="3.5"
          strokeDasharray="10 6"
          strokeLinejoin="round"
        />
      </g>
    );
  }

  return (
    <g className={fresh ? 'lp-drop' : undefined} opacity={faded ? 0.3 : 1}>
      {side && (
        <>
          <polygon points={polygon(camera, side)} fill={surface} stroke={ink} strokeWidth="1.25" />
          <polygon points={polygon(camera, side)} fill="var(--color-black)" fillOpacity="0.16" />
        </>
      )}
      {top && (
        <>
          <polygon points={polygon(camera, top)} fill={surface} stroke={ink} strokeWidth="1.25" />
          <polygon points={polygon(camera, top)} fill="var(--color-white)" fillOpacity="0.3" />
        </>
      )}
      <polygon points={polygon(camera, front)} fill={surface} stroke={ink} strokeWidth="1.75" />
      <polygon
        points={polygon(camera, deckFront)}
        fill="var(--color-paper-deep)"
        stroke={ink}
        strokeWidth="1"
      />
      {pockets.map((pocket, index) => (
        <polygon key={index} points={polygon(camera, pocket)} fill="var(--color-ink-soft)" />
      ))}
    </g>
  );
}

function TrailerView({
  plan,
  step,
  fills,
  current,
}: {
  plan: LoadPlan;
  step: number;
  fills: Map<string, Fill>;
  current: PlacedPallet | undefined;
}) {
  const prefix = 'lp-view';
  const length = plan.rows * ROW_DEPTH + 0.1;
  const boxes = useMemo(
    () =>
      plan.pallets
        .map((pallet) => place(pallet, length))
        .sort((a, b) => b.zNear - a.zNear || a.pallet.level - b.pallet.level),
    [plan.pallets, length],
  );
  const target = current
    ? boxes.find((box) => box.pallet.load_sequence === current.load_sequence)
    : undefined;
  // Walk in so the spot being loaded stays large: stop two pallet-lengths short of it.
  const camera = useGlide(target ? Math.max(DOCK_CAMERA, target.zNear - 2.4) : DOCK_CAMERA);
  const start = Math.max(0, camera + NEAR);
  const onDock = camera < -0.2;

  const corner = (x: number, y: number, z: number): Point => [x, y, z];
  const shell = {
    floor: [
      corner(-HALF_WIDTH, 0, start),
      corner(HALF_WIDTH, 0, start),
      corner(HALF_WIDTH, 0, length),
      corner(-HALF_WIDTH, 0, length),
    ],
    ceiling: [
      corner(-HALF_WIDTH, HEIGHT, start),
      corner(HALF_WIDTH, HEIGHT, start),
      corner(HALF_WIDTH, HEIGHT, length),
      corner(-HALF_WIDTH, HEIGHT, length),
    ],
    left: [
      corner(-HALF_WIDTH, 0, start),
      corner(-HALF_WIDTH, HEIGHT, start),
      corner(-HALF_WIDTH, HEIGHT, length),
      corner(-HALF_WIDTH, 0, length),
    ],
    right: [
      corner(HALF_WIDTH, 0, start),
      corner(HALF_WIDTH, HEIGHT, start),
      corner(HALF_WIDTH, HEIGHT, length),
      corner(HALF_WIDTH, 0, length),
    ],
    nose: [
      corner(-HALF_WIDTH, 0, length),
      corner(HALF_WIDTH, 0, length),
      corner(HALF_WIDTH, HEIGHT, length),
      corner(-HALF_WIDTH, HEIGHT, length),
    ],
  };
  const [noseLabelX, noseLabelY] = project(camera, [0, HEIGHT - 0.95, length]);
  const [reeferLeft, reeferTop] = project(camera, [-0.75, HEIGHT - 0.2, length]);
  const [reeferRight, reeferBottom] = project(camera, [0.75, HEIGHT - 0.75, length]);

  const pin = target ? project(camera, [(target.x0 + target.x1) / 2, target.y1, target.zNear]) : null;
  const aim = target ? project(camera, [(target.x0 + target.x1) / 2, target.y0, target.zNear - 0.05]) : null;
  const doorFrame = onDock
    ? polygon(camera, [
        [-HALF_WIDTH - 0.06, -0.02, 0],
        [HALF_WIDTH + 0.06, -0.02, 0],
        [HALF_WIDTH + 0.06, HEIGHT + 0.06, 0],
        [-HALF_WIDTH - 0.06, HEIGHT + 0.06, 0],
      ])
    : null;
  const [, doorSill] = project(camera, [0, 0, 0]);

  const describe = current
    ? `Looking into the trailer from the dock door. Pallet ${String(current.load_sequence)}, ${current.product_name}, goes in row ${String(current.row + 1)} on your ${current.side}, ${current.level === 0 ? 'on the floor' : 'on top'}. ${String(step - 1)} of ${String(plan.pallets.length)} pallets are loaded.`
    : `Looking into the trailer from the dock door. All ${String(plan.pallets.length)} pallets are loaded.`;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label={describe}
      className="lp-view block h-auto w-full"
    >
      <Patterns prefix={prefix} />
      <defs>
        <filter id="lp-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      {/* The dock building behind the door */}
      <rect width={VIEW_W} height={VIEW_H} fill="var(--color-paper-sunk)" />
      {onDock && (
        <polygon
          points={`0,${VIEW_H} ${VIEW_W},${VIEW_H} ${VIEW_W},${doorSill.toFixed(1)} 0,${doorSill.toFixed(1)}`}
          fill="var(--color-paper-deep)"
          opacity="0.55"
        />
      )}
      {/* The trailer box */}
      <polygon points={polygon(camera, shell.ceiling)} fill="var(--color-paper-sunk)" />
      <polygon points={polygon(camera, shell.left)} fill="var(--color-surface)" />
      <polygon points={polygon(camera, shell.right)} fill="var(--color-surface)" />
      <polygon points={polygon(camera, shell.left)} fill="var(--color-black)" fillOpacity="0.04" />
      <polygon points={polygon(camera, shell.floor)} fill="var(--color-paper-deep)" />
      {/* The reefer's grooved aluminium floor runs the length of the trailer */}
      {[-1.0, -0.6, -0.2, 0.2, 0.6, 1.0].map((x) => (
        <polyline
          key={`groove${x}`}
          points={polygon(camera, [
            [x, 0.005, start],
            [x, 0.005, length],
          ])}
          stroke="var(--color-ink-mute)"
          strokeOpacity="0.14"
          strokeWidth="1"
        />
      ))}
      {/* The air chute along the ceiling */}
      <polygon
        points={polygon(camera, [
          [-0.34, HEIGHT - 0.01, start],
          [0.34, HEIGHT - 0.01, start],
          [0.34, HEIGHT - 0.01, length],
          [-0.34, HEIGHT - 0.01, length],
        ])}
        fill="var(--color-paper-deep)"
        fillOpacity="0.45"
      />
      <polygon
        points={polygon(camera, shell.nose)}
        fill="var(--color-paper-sunk)"
        stroke="var(--color-hairline)"
      />
      <rect
        x={reeferLeft}
        y={reeferTop}
        width={Math.max(reeferRight - reeferLeft, 1)}
        height={Math.max(reeferBottom - reeferTop, 1)}
        rx={Math.min(8, (reeferBottom - reeferTop) / 4)}
        fill="var(--color-paper-deep)"
        stroke="var(--color-ink-mute)"
        strokeOpacity="0.6"
        strokeWidth="1"
      />
      {[0.26, 0.42, 0.58, 0.74].map((at) => {
        const y = reeferTop + (reeferBottom - reeferTop) * at;
        return (
          <line
            key={at}
            x1={reeferLeft + (reeferRight - reeferLeft) * 0.08}
            x2={reeferRight - (reeferRight - reeferLeft) * 0.3}
            y1={y}
            y2={y}
            stroke="var(--color-ink-mute)"
            strokeOpacity="0.7"
            strokeWidth="1"
            strokeLinecap="round"
          />
        );
      })}
      <rect
        x={reeferRight - (reeferRight - reeferLeft) * 0.22}
        y={reeferTop + (reeferBottom - reeferTop) * 0.24}
        width={(reeferRight - reeferLeft) * 0.14}
        height={(reeferBottom - reeferTop) * 0.26}
        rx="2"
        fill="var(--color-sage)"
      />
      <text
        x={noseLabelX}
        y={noseLabelY}
        textAnchor="middle"
        fontSize={Math.max(11, Math.min(22, (FOCAL * 0.32) / Math.max(length - camera, 1)))}
        fontWeight="600"
        fontFamily="var(--font-sans)"
        fill="var(--color-ink-soft)"
      >
        Nose
      </text>
      {/* Rows: a rib on each wall and the row number on the floor */}
      {Array.from({ length: plan.rows }, (_, row) => {
        const zFar = length - row * ROW_DEPTH;
        const zNear = zFar - ROW_DEPTH;
        if (zFar < start) return null;
        const rib = Math.max(zNear, start);
        const middle = (Math.max(zNear, start) + zFar) / 2;
        const [numberX, numberY] = project(camera, [-HALF_WIDTH, HEIGHT - 0.1, middle]);
        const size = (FOCAL * 0.3) / Math.max(middle - camera, NEAR);
        const onRow = current?.row === row;
        return (
          <g key={row}>
            {(['left', 'right'] as const).map((side) => {
              const x = side === 'left' ? -HALF_WIDTH : HALF_WIDTH;
              const half = zNear + ROW_DEPTH / 2;
              if (half <= start) return null;
              const [x1, y1] = project(camera, [x, 0, half]);
              const [x2, y2] = project(camera, [x, HEIGHT, half]);
              return (
                <line
                  key={`half-${side}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="var(--color-hairline)"
                  strokeOpacity="0.55"
                  strokeWidth="1"
                />
              );
            })}
            {(['left', 'right'] as const).map((side) => {
              const x = side === 'left' ? -HALF_WIDTH : HALF_WIDTH;
              const [x1, y1] = project(camera, [x, 0, rib]);
              const [x2, y2] = project(camera, [x, HEIGHT, rib]);
              return (
                <line
                  key={side}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="var(--color-hairline)"
                  strokeWidth="1.5"
                />
              );
            })}
            <polyline
              points={polygon(camera, [
                [-HALF_WIDTH, 0, rib],
                [HALF_WIDTH, 0, rib],
              ])}
              stroke="var(--color-ink-mute)"
              strokeOpacity="0.3"
              strokeWidth="1"
            />
            {size >= 11 && (
              <text
                x={numberX + size * 0.25}
                y={numberY + size * 0.35}
                textAnchor="start"
                fontSize={Math.min(size, 28)}
                fontWeight="700"
                fontFamily="var(--font-sans)"
                fill={onRow ? 'var(--color-ink)' : 'var(--color-ink-mute)'}
                opacity={onRow ? 1 : 0.7}
              >
                {onRow ? `Row ${String(row + 1)}` : row + 1}
              </text>
            )}
          </g>
        );
      })}
      {/* Spots still to fill, as outlines on the floor */}
      {boxes
        .filter((box) => box.pallet.level === 0 && box.pallet.load_sequence > step && box.zNear > start)
        .map((box) => (
          <polygon
            key={`spot-${box.pallet.load_sequence}`}
            points={polygon(camera, [
              [box.x0, 0.01, box.zNear],
              [box.x1, 0.01, box.zNear],
              [box.x1, 0.01, box.zFar],
              [box.x0, 0.01, box.zFar],
            ])}
            fill="none"
            stroke="var(--color-ink-mute)"
            strokeOpacity="0.55"
            strokeWidth="1.5"
            strokeDasharray="5 5"
          />
        ))}
      {/* Soft contact shadows, so pallets stand on the floor */}
      <g filter="url(#lp-soft)">
        {boxes
          .filter(
            (box) =>
              box.pallet.level === 0 &&
              box.zNear > start &&
              (box.pallet.load_sequence < step || box.pallet.load_sequence === current?.load_sequence),
          )
          .map((box) => (
            <polygon
              key={`shadow-${box.pallet.load_sequence}`}
              points={polygon(camera, [
                [box.x0 - 0.05, 0.004, box.zNear - 0.07],
                [box.x1 + 0.05, 0.004, box.zNear - 0.07],
                [box.x1 + 0.05, 0.004, box.zFar],
                [box.x0 - 0.05, 0.004, box.zFar],
              ])}
              fill="var(--color-ink)"
              fillOpacity={box.pallet.load_sequence === current?.load_sequence ? 0.08 : 0.16}
            />
          ))}
      </g>
      {/* Pallets already on, far to near, then the one being placed */}
      {boxes
        .filter((box) => box.pallet.load_sequence < step && box.zNear > start)
        .map((box) => (
          <PalletBox
            key={box.pallet.load_sequence}
            camera={camera}
            box={box}
            fill={fills.get(box.pallet.sku) ?? 'solid'}
            prefix={prefix}
            faded={target !== undefined && box.zNear < target.zNear - 0.05}
            fresh={box.pallet.load_sequence === step - 1}
          />
        ))}
      {target && (
        <PalletBox
          camera={camera}
          box={target}
          fill={fills.get(target.pallet.sku) ?? 'solid'}
          prefix={prefix}
          ghost
        />
      )}
      {doorFrame && (
        <polygon
          points={doorFrame}
          fill="none"
          stroke="var(--color-ink-soft)"
          strokeWidth="9"
          strokeLinejoin="round"
        />
      )}
      {/* The way in: from where you stand to the spot */}
      {aim && current?.level === 0 && (
        <path
          className="lp-flow"
          d={`M${CX} ${VIEW_H - 6} Q ${CX} ${Math.max(aim[1] + 40, HORIZON + 60)} ${aim[0].toFixed(1)} ${(aim[1] + 6).toFixed(1)}`}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="2 12"
        />
      )}
      {pin && current && (
        <g className="lp-pin" transform={`translate(${pin[0].toFixed(1)} ${(pin[1] - 30).toFixed(1)})`}>
          <path d="M-9 13 L0 26 L9 13 Z" fill="var(--color-accent)" />
          <circle r="21" fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth="3" />
          <text
            y="7"
            textAnchor="middle"
            fontSize="20"
            fontWeight="700"
            fontFamily="var(--font-sans)"
            fill="var(--color-on-accent)"
          >
            {current.load_sequence}
          </text>
        </g>
      )}
      {(['left', 'right'] as const).map((side) => {
        const width = 124;
        const x = side === 'left' ? 14 : VIEW_W - 14 - width;
        const y = VIEW_H - 50;
        return (
          <g key={side} transform={`translate(${x} ${y})`}>
            <rect width={width} height="36" rx="18" className="lp-side-pill" />
            <path
              d={
                side === 'left'
                  ? 'M24 11 L17 18 L24 25'
                  : `M${width - 24} 11 L${width - 17} 18 L${width - 24} 25`
              }
              fill="none"
              stroke="var(--color-ink)"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <text
              x={side === 'left' ? 32 : width - 32}
              y="23.5"
              textAnchor={side === 'left' ? 'start' : 'end'}
              fontSize="16"
              fontWeight="600"
              fontFamily="var(--font-sans)"
              fill="var(--color-ink)"
            >
              {side === 'left' ? 'Your left' : 'Your right'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── The whole trailer from above: progress at a glance, and a way to jump to any stack ──

const MAP_ROW = 30;
const MAP_LANE = 52;
const MAP_GAP = 6;
const MAP_LABEL = 26;

type StackState = 'done' | 'current' | 'todo';

function stateOf(stack: Stack, step: number): StackState {
  if (stack.pallets.some((pallet) => pallet.load_sequence === step)) return 'current';
  if (stack.pallets.every((pallet) => pallet.load_sequence < step)) return 'done';
  return 'todo';
}

function TrailerMap({
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
  const prefix = 'lp-map';
  const width = MAP_LABEL + MAP_LANE * 2 + MAP_GAP * 3;
  const top = 26;
  const height = top + plan.rows * MAP_ROW + 30;
  const bySlot = new Map(stacks.map((stack) => [`${stack.row}-${stack.side}`, stack]));
  const laneX = { left: MAP_LABEL + MAP_GAP, right: MAP_LABEL + MAP_GAP * 2 + MAP_LANE } as const;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label={`The whole trailer from above: ${String(plan.stacks_used)} stacks on ${String(plan.floor_positions)} floor positions`}
      className="mx-auto block h-auto w-full max-w-44"
    >
      <Patterns prefix={prefix} />
      <text
        x={MAP_LABEL + (width - MAP_LABEL) / 2}
        y="16"
        textAnchor="middle"
        fontSize="14"
        fontWeight="600"
        fontFamily="var(--font-sans)"
        fill="var(--color-ink-mute)"
      >
        Nose
      </text>
      <rect
        x={MAP_LABEL}
        y={top - 4}
        width={width - MAP_LABEL}
        height={plan.rows * MAP_ROW + 8}
        rx="14"
        fill="var(--color-paper)"
        stroke="var(--color-hairline)"
        strokeWidth="2"
      />
      {Array.from({ length: plan.rows }, (_, row) => {
        const y = top + row * MAP_ROW;
        return (
          <g key={row}>
            <text
              x={MAP_LABEL - 7}
              y={y + MAP_ROW / 2 + 5}
              textAnchor="end"
              fontSize="14"
              fontFamily="var(--font-sans)"
              fill={
                row === plan.pallets.find((p) => p.load_sequence === step)?.row
                  ? 'var(--color-ink)'
                  : 'var(--color-ink-mute)'
              }
            >
              {row + 1}
            </text>
            {(['left', 'right'] as const).map((side) => {
              const x = laneX[side];
              const stack = bySlot.get(`${row}-${side}`);
              const bottom = stack?.pallets[0];
              if (!stack || !bottom) return null;
              const state = stateOf(stack, step);
              const fill = fills.get(bottom.sku) ?? 'solid';
              const nextHere = stack.pallets.find((pallet) => pallet.load_sequence >= step) ?? bottom;
              const plural = stack.pallets.length > 1 ? 's' : '';
              return (
                <g
                  key={side}
                  role="button"
                  tabIndex={0}
                  aria-label={`Row ${row + 1} ${side}: ${stack.pallets.length} pallet${plural}, first loaded at step ${bottom.load_sequence}${state === 'done' ? ', loaded' : ''}`}
                  onClick={() => onPick(nextHere.load_sequence)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onPick(nextHere.load_sequence);
                    }
                  }}
                  className="lp-stack cursor-pointer"
                >
                  <rect
                    x={x}
                    y={y + 3}
                    width={MAP_LANE}
                    height={MAP_ROW - 6}
                    rx="8"
                    fill={state === 'todo' ? 'var(--color-surface)' : fillFor(prefix, fill)}
                    stroke={state === 'current' ? 'var(--color-ink)' : HUE[fill].ink}
                    strokeWidth={state === 'current' ? 3.5 : 1.5}
                    strokeDasharray={state === 'todo' ? '4 4' : undefined}
                  />
                  {state === 'done' ? (
                    <path
                      d={`M${x + MAP_LANE / 2 - 9} ${y + MAP_ROW / 2} l5 5 l10 -10`}
                      fill="none"
                      stroke="var(--color-ink)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : (
                    <text
                      x={x + MAP_LANE / 2}
                      y={y + MAP_ROW / 2 + 5}
                      textAnchor="middle"
                      fontSize="14"
                      fontWeight="700"
                      fontFamily="var(--font-sans)"
                      fill="var(--color-ink)"
                      stroke="var(--color-surface)"
                      strokeWidth="3"
                      paintOrder="stroke"
                    >
                      {nextHere.load_sequence}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
      <text
        x={MAP_LABEL + (width - MAP_LABEL) / 2}
        y={height - 8}
        textAnchor="middle"
        fontSize="14"
        fontWeight="600"
        fontFamily="var(--font-sans)"
        fill="var(--color-ink)"
      >
        Doors · you
      </text>
    </svg>
  );
}

// ── The guide ──

function Fact({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="lp-fact rounded-2xl bg-paper-sunk px-3.5 py-3.5 sm:px-5">
      <dt className="label">{label}</dt>
      <dd className="num mt-0.5 text-2xl leading-tight sm:text-3xl">{children}</dd>
      {note && <dd className="text-sm font-semibold text-ink-soft">{note}</dd>}
    </div>
  );
}

function NowLoading({
  plan,
  fills,
  products,
  step,
  onStep,
}: {
  plan: LoadPlan;
  fills: Map<string, Fill>;
  products: Product[];
  step: number;
  onStep: (step: number) => void;
}) {
  const total = plan.pallets.length;
  const current = plan.pallets.find((pallet) => pallet.load_sequence === step);
  const loaded = Math.min(step - 1, total);
  const share = Math.round((loaded / total) * 100);
  const product = current && products.find((candidate) => candidate.sku === current.sku);
  const below =
    current &&
    plan.pallets.find(
      (pallet) =>
        pallet.row === current.row && pallet.side === current.side && pallet.level === current.level - 1,
    );
  const multiStop = current !== undefined && plan.pallets.some((pallet) => pallet.stop !== current.stop);

  const next = () => {
    try {
      if ('vibrate' in navigator) navigator.vibrate(12);
    } catch {
      /* no haptics on this device */
    }
    onStep(step + 1);
  };

  return (
    <section className="card flex flex-col gap-5 overflow-hidden p-5 sm:p-6" aria-live="polite">
      <div className="flex items-center gap-4">
        <div className="meter flex-1" aria-hidden="true">
          <div className="meter-fill" style={{ width: `${share}%` }} />
        </div>
        <p className="telemetry shrink-0 text-base">
          {loaded} of {total} loaded
        </p>
      </div>

      {current ? (
        <div className="flex items-start gap-4">
          {product && <Swatch fill={product.fill} prefix={`now-${product.sku}`} size={48} />}
          <div className="min-w-0">
            <h3 className="label">
              Load step {step} of {total}
            </h3>
            <p className="heading mt-0.5 text-2xl">{current.product_name}</p>
            <p className="telemetry mt-1 text-sm text-ink-soft">
              {current.sku} · {current.cases} cs · {formatWeight(current.weight_lbs)}
              {current.partial && ' · part pallet'}
              {multiStop && ` · stop ${String(current.stop)}`}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-green-soft text-green">
            <PackageCheck size={28} aria-hidden="true" />
          </span>
          <div>
            <p className="heading text-2xl">
              All {total} pallets <em>are on.</em>
            </p>
            <p className="text-base text-ink-mute">Check the counts, then sign the order off.</p>
          </div>
        </div>
      )}

      <div className="lp-frame -mx-5 sm:mx-0 sm:overflow-hidden sm:rounded-2xl">
        <TrailerView plan={plan} step={step} fills={fills} current={current} />
      </div>

      {current && (
        <dl className="grid grid-cols-3 gap-2 sm:gap-3">
          <Fact label="Row">{current.row + 1}</Fact>
          <Fact label="Side">{current.side === 'left' ? 'Left' : 'Right'}</Fact>
          <Fact label="Height" note={below ? `on pallet ${String(below.load_sequence)}` : undefined}>
            {current.level === 0 ? 'Floor' : 'Top'}
          </Fact>
        </dl>
      )}

      {current && plan.slip_sheets && current.level > 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-accent-soft px-4 py-3 text-base font-semibold">
          <Layers size={20} aria-hidden="true" /> Slip sheet on pallet {below?.load_sequence ?? ''} first
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="btn btn-secondary px-5"
          aria-label="Previous step"
          disabled={step <= 1}
          onClick={() => onStep(current ? step - 1 : total)}
        >
          <ChevronLeft size={18} aria-hidden="true" /> Back
        </button>
        {current && (
          <button type="button" className="btn btn-primary lp-next flex-1" onClick={next}>
            <Check size={18} aria-hidden="true" /> Loaded, next pallet
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}

function Rule({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 rounded-full bg-paper-sunk py-1.5 pr-3.5 pl-2.5 text-sm font-semibold">
      <span className="text-sage-ink">{icon}</span>
      {children}
    </li>
  );
}

/** `persist` remembers the step per order; the landing page's sample passes false. */
export function LoadPlanView({ plan, persist = true }: { plan: LoadPlan; persist?: boolean }) {
  const stacks = useMemo(() => stacksOf(plan.pallets), [plan.pallets]);
  const products = useMemo(() => {
    const seen = new Map<string, Product>();
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
  const total = plan.pallets.length;
  const [step, setStep] = useLoadStep(plan.order_id, total, persist);

  if (total === 0) {
    return <Notice title="Nothing to load">This order has no pallets.</Notice>;
  }

  return (
    <div className="flex flex-col gap-5">
      {plan.warnings.map((warning) => (
        <Notice key={warning} tone="alert" title="Load exceeds a limit">
          {warning}
        </Notice>
      ))}

      <div className="grid items-start gap-5 xl:grid-cols-7">
        <div className="xl:col-span-5">
          <NowLoading plan={plan} fills={fills} products={products} step={step} onStep={setStep} />
        </div>

        <aside
          className="grid items-start gap-5 md:grid-cols-2 xl:col-span-2 xl:grid-cols-1"
          aria-label={`${plan.company_name} load`}
        >
          <figure className="card p-5">
            <figcaption className="mb-3 flex items-baseline justify-between gap-2">
              <span className="heading text-lg">From above</span>
              <span className="label">Tap to jump</span>
            </figcaption>
            <TrailerMap plan={plan} stacks={stacks} fills={fills} step={step} onPick={setStep} />
          </figure>

          <section className="card flex flex-col gap-4 p-5" aria-label="Products on this load">
            <ul className="flex flex-col gap-3">
              {products.map((product) => (
                <li key={product.sku} className="flex items-center gap-3">
                  <Swatch fill={product.fill} prefix={product.sku} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{product.name}</span>
                    <span className="text-sm text-ink-mute">{product.category}</span>
                  </span>
                  <span className="telemetry text-base">×{product.pallets}</span>
                </li>
              ))}
            </ul>
            <ul className="flex flex-wrap gap-2" aria-label={`${plan.company_name} rules`}>
              <Rule icon={<Layers size={16} aria-hidden="true" />}>Max {plan.max_height} high</Rule>
              <Rule icon={<Weight size={16} aria-hidden="true" />}>
                {SEQUENCE_NAME[plan.sequence] ?? plan.sequence}
              </Rule>
              {plan.slip_sheets && <Rule icon={<Layers size={16} aria-hidden="true" />}>Slip sheets</Rule>}
            </ul>
            {plan.special && (
              <p className="rounded-lg bg-accent-soft px-4 py-3 text-base font-semibold">{plan.special}</p>
            )}
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-ink-soft">
                All {plan.checklist.length} customer rules
                <ChevronRight
                  size={18}
                  aria-hidden="true"
                  className="transition-transform duration-300 group-open:rotate-90"
                />
              </summary>
              <ul className="mt-1 flex flex-col gap-1.5 text-sm text-ink-soft">
                {plan.checklist.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </details>
          </section>
        </aside>
      </div>
    </div>
  );
}
