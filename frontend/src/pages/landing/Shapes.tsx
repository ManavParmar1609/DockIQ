import { useId, type ReactNode } from 'react';

/*
 * The landing page's soft 3D shapes, drawn in SVG: each is lit from within by its own gradients (no
 * drop shadows), in the five highlighters. Decorative only — hidden from assistive technology.
 */

type ShapeProps = { className?: string };

/** A gradient stop that takes its colour from a token in app.css. */
function Stop({ offset, color, opacity }: { offset: string; color: string; opacity?: string }) {
  return <stop offset={offset} style={{ stopColor: `var(${color})`, stopOpacity: opacity }} />;
}

function Svg({ className, viewBox, children }: ShapeProps & { viewBox: string; children: ReactNode }) {
  return (
    <svg className={className} viewBox={viewBox} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** Four lobes round a centre: one soft pink form, lit from the top left, each lobe catching light. */
export function Clover({ className }: ShapeProps) {
  const id = useId();
  const lobes: [number, number][] = [
    [38, 38],
    [82, 38],
    [38, 82],
    [82, 82],
  ];
  const outline =
    lobes.map(([x, y]) => `M${String(x - 27)} ${String(y)}a27 27 0 1 0 54 0a27 27 0 1 0-54 0Z`).join('') +
    'M34 60a26 26 0 1 0 52 0a26 26 0 1 0-52 0Z';
  return (
    <Svg className={className} viewBox="0 0 120 120">
      <defs>
        <radialGradient id={`${id}p`} gradientUnits="userSpaceOnUse" cx="44" cy="36" r="92">
          <Stop offset="0" color="--shape-pink-hi" />
          <Stop offset="0.4" color="--color-pink" />
          <Stop offset="1" color="--color-lipstick" />
        </radialGradient>
        <radialGradient id={`${id}h`} cx="0.36" cy="0.3" r="0.55">
          <Stop offset="0" color="--shape-pink-hi" opacity="0.7" />
          <Stop offset="1" color="--shape-pink-hi" opacity="0" />
        </radialGradient>
      </defs>
      <path d={outline} fill={`url(#${id}p)`} />
      {lobes.map(([x, y]) => (
        <circle key={`${String(x)}-${String(y)}`} cx={x} cy={y} r="22" fill={`url(#${id}h)`} />
      ))}
    </Svg>
  );
}

/** A green dome, the half of a planet. */
export function Dome({ className }: ShapeProps) {
  const id = useId();
  return (
    <Svg className={className} viewBox="0 0 200 100">
      <defs>
        <radialGradient id={`${id}d`} cx="0.35" cy="0.15" r="1">
          <Stop offset="0" color="--shape-green-hi" />
          <Stop offset="0.35" color="--color-accent-light" />
          <Stop offset="0.75" color="--color-accent" />
          <Stop offset="1" color="--shape-teal" />
        </radialGradient>
      </defs>
      <path d="M0 100a100 100 0 0 1 200 0Z" fill={`url(#${id}d)`} />
    </Svg>
  );
}

/** An arch on two legs, pink at the crown, blue at the feet. */
export function Arch({ className }: ShapeProps) {
  const id = useId();
  return (
    <Svg className={className} viewBox="0 0 140 130">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0.3" y2="1">
          <Stop offset="0" color="--color-pink" />
          <Stop offset="0.55" color="--color-lilac" />
          <Stop offset="1" color="--color-blue" />
        </linearGradient>
        <radialGradient id={`${id}h`} cx="0.72" cy="0.7" r="0.35">
          <Stop offset="0" color="--color-pink" opacity="0.9" />
          <Stop offset="1" color="--color-pink" opacity="0" />
        </radialGradient>
      </defs>
      <path
        d="M0 70a70 70 0 0 1 140 0v44a16 16 0 0 1-16 16H100a16 16 0 0 1-16-16V74a14 14 0 0 0-28 0v40a16 16 0 0 1-16 16H16A16 16 0 0 1 0 114Z"
        fill={`url(#${id}a)`}
      />
      <path
        d="M0 70a70 70 0 0 1 140 0v44a16 16 0 0 1-16 16H100a16 16 0 0 1-16-16V74a14 14 0 0 0-28 0v40a16 16 0 0 1-16 16H16A16 16 0 0 1 0 114Z"
        fill={`url(#${id}h)`}
      />
    </Svg>
  );
}

/** A rounded block with a bubble at its foot, amber into orange. */
export function Block({ className }: ShapeProps) {
  const id = useId();
  return (
    <Svg className={className} viewBox="0 0 140 140">
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" color="--shape-amber-hi" />
          <Stop offset="0.45" color="--color-signal-ink" />
          <Stop offset="1" color="--color-orangey" />
        </linearGradient>
      </defs>
      <rect x="34" y="6" width="100" height="100" rx="16" fill={`url(#${id}b)`} />
      <circle cx="38" cy="100" r="34" fill={`url(#${id}b)`} />
    </Svg>
  );
}

/** A thick ring, blue turning pink. */
export function Ring({ className }: ShapeProps) {
  const id = useId();
  return (
    <Svg className={className} viewBox="0 0 100 100">
      <defs>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" color="--color-blue" />
          <Stop offset="0.6" color="--color-lilac" />
          <Stop offset="1" color="--color-pink" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="36" fill="none" stroke={`url(#${id}r)`} strokeWidth="18" />
    </Svg>
  );
}

/** Two triangles tip to tip, in lilac. */
export function Hourglass({ className }: ShapeProps) {
  const id = useId();
  return (
    <Svg className={className} viewBox="0 0 80 100">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" color="--shape-lilac-hi" />
          <Stop offset="1" color="--chart-2" />
        </linearGradient>
      </defs>
      <path d="M6 4h68L40 50Z M40 50 74 96H6Z" fill={`url(#${id}g)`} strokeLinejoin="round" />
    </Svg>
  );
}

/** Five tiles in an X, like the reference's UI mark. */
export function Checker({ className }: ShapeProps) {
  const id = useId();
  const tiles = [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ];
  return (
    <Svg className={className} viewBox="0 0 150 150">
      <defs>
        <linearGradient id={`${id}c`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" color="--shape-blue-hi" />
          <Stop offset="0.5" color="--shape-blue-mid" />
          <Stop offset="1" color="--color-blue" />
        </linearGradient>
      </defs>
      {tiles.map(([x = 0, y = 0]) => (
        <rect key={`${x}-${y}`} x={x * 50} y={y * 50} width="50" height="50" fill={`url(#${id}c)`} />
      ))}
    </Svg>
  );
}

/** A thick squiggle, lilac into pink. */
export function Squiggle({ className }: ShapeProps) {
  const id = useId();
  return (
    <Svg className={className} viewBox="0 0 90 140">
      <defs>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" color="--color-pink" />
          <Stop offset="1" color="--color-lilac" />
        </linearGradient>
      </defs>
      <path
        d="M22 16 68 38 22 62 68 86 22 110 60 128"
        fill="none"
        stroke={`url(#${id}s)`}
        strokeWidth="18"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** A six-armed spark, orange at the heart. */
export function Spark({ className }: ShapeProps) {
  const id = useId();
  return (
    <Svg className={className} viewBox="0 0 100 100">
      <defs>
        <radialGradient id={`${id}k`} cx="0.5" cy="0.5" r="0.55">
          <Stop offset="0" color="--color-orangey" />
          <Stop offset="1" color="--color-pink" />
        </radialGradient>
      </defs>
      <g stroke={`url(#${id}k)`} strokeWidth="11" strokeLinecap="round">
        <path d="M50 8v84M14 29l72 42M14 71l72-42" />
      </g>
    </Svg>
  );
}

/** A small tilted diamond. */
export function Diamond({ className }: ShapeProps) {
  const id = useId();
  return (
    <Svg className={className} viewBox="0 0 60 60">
      <defs>
        <linearGradient id={`${id}m`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" color="--shape-amber-hi" />
          <Stop offset="1" color="--color-orangey" />
        </linearGradient>
      </defs>
      <rect x="14" y="14" width="32" height="32" rx="5" transform="rotate(45 30 30)" fill={`url(#${id}m)`} />
    </Svg>
  );
}

/* ── Dock objects, in the same medium: the tool rows' marks ── */

/** Three cartons stacked on a pallet: load plans. */
export function PalletStack({ className }: ShapeProps) {
  const id = useId();
  return (
    <Svg className={className} viewBox="0 0 150 140">
      <defs>
        <linearGradient id={`${id}c`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" color="--shape-pink-hi" />
          <Stop offset="0.5" color="--color-pink" />
          <Stop offset="1" color="--color-lilac" />
        </linearGradient>
        <linearGradient id={`${id}w`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" color="--color-lilac" />
          <Stop offset="1" color="--chart-2" />
        </linearGradient>
      </defs>
      <rect x="10" y="62" width="62" height="52" rx="7" fill={`url(#${id}c)`} />
      <rect x="78" y="62" width="62" height="52" rx="7" fill={`url(#${id}c)`} />
      <rect x="40" y="6" width="68" height="52" rx="7" fill={`url(#${id}c)`} />
      <rect x="4" y="118" width="142" height="8" rx="3" fill={`url(#${id}w)`} />
      <rect x="12" y="126" width="18" height="10" rx="2" fill={`url(#${id}w)`} />
      <rect x="66" y="126" width="18" height="10" rx="2" fill={`url(#${id}w)`} />
      <rect x="120" y="126" width="18" height="10" rx="2" fill={`url(#${id}w)`} />
    </Svg>
  );
}

/** A probe thermometer, bulb glowing: the score's temperature term. */
export function Probe({ className }: ShapeProps) {
  const id = useId();
  return (
    <Svg className={className} viewBox="0 0 100 150">
      <defs>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" color="--shape-amber-hi" />
          <Stop offset="0.55" color="--color-signal-ink" />
          <Stop offset="1" color="--color-orangey" />
        </linearGradient>
        <radialGradient id={`${id}b`} cx="0.38" cy="0.32" r="0.7">
          <Stop offset="0" color="--shape-amber-hi" />
          <Stop offset="1" color="--color-orangey" />
        </radialGradient>
      </defs>
      <rect x="36" y="4" width="28" height="104" rx="14" fill={`url(#${id}s)`} />
      <circle cx="50" cy="118" r="28" fill={`url(#${id}b)`} />
      <g fill="none" stroke="var(--color-paper)" strokeOpacity="0.35" strokeWidth="3" strokeLinecap="round">
        <path d="M44 24h8M44 40h8M44 56h8M44 72h8" />
      </g>
    </Svg>
  );
}

/** A dock door, its roll-up slats catching the light: the operator's place. */
export function DockDoor({ className }: ShapeProps) {
  const id = useId();
  const slats = [0, 1, 2, 3, 4];
  return (
    <Svg className={className} viewBox="0 0 150 140">
      <defs>
        <linearGradient id={`${id}d`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="150" y2="140">
          <Stop offset="0" color="--shape-green-hi" />
          <Stop offset="0.45" color="--color-accent-light" />
          <Stop offset="1" color="--color-accent" />
        </linearGradient>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" color="--color-accent" />
          <Stop offset="1" color="--shape-teal" />
        </linearGradient>
      </defs>
      <path d="M8 136V26a22 22 0 0 1 22-22h90a22 22 0 0 1 22 22v110h-16V30H24v106Z" fill={`url(#${id}f)`} />
      {slats.map((slat) => (
        <rect key={slat} x="30" y={36 + slat * 18} width="90" height="14" rx="4" fill={`url(#${id}d)`} />
      ))}
    </Svg>
  );
}

/** A wall of doors, one lit: the supervisor's floor. */
export function DoorGrid({ className }: ShapeProps) {
  const id = useId();
  const doors: [number, number][] = [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ];
  return (
    <Svg className={className} viewBox="0 0 150 106">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" color="--shape-blue-hi" />
          <Stop offset="0.5" color="--shape-blue-mid" />
          <Stop offset="1" color="--color-blue" />
        </linearGradient>
        <linearGradient id={`${id}q`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" color="--color-blue" />
          <Stop offset="1" color="--chart-4" />
        </linearGradient>
      </defs>
      {doors.map(([x, y]) => (
        <rect
          key={`${String(x)}-${String(y)}`}
          x={x * 52}
          y={y * 56}
          width="46"
          height="50"
          rx="6"
          fill={x === 1 && y === 0 ? `url(#${id}g)` : `url(#${id}q)`}
          opacity={x === 1 && y === 0 ? 1 : 0.55}
        />
      ))}
    </Svg>
  );
}

/** A cold drop with a frost glint: the cold chain Quality watches. */
export function ColdDrop({ className }: ShapeProps) {
  const id = useId();
  return (
    <Svg className={className} viewBox="0 0 110 150">
      <defs>
        <radialGradient id={`${id}c`} cx="0.36" cy="0.55" r="0.7">
          <Stop offset="0" color="--shape-lilac-hi" />
          <Stop offset="0.5" color="--color-lilac" />
          <Stop offset="1" color="--chart-2" />
        </radialGradient>
      </defs>
      <path d="M55 4C55 4 104 62 104 96a49 49 0 0 1-98 0C6 62 55 4 55 4Z" fill={`url(#${id}c)`} />
      <g stroke="var(--color-paper)" strokeOpacity="0.4" strokeWidth="4" strokeLinecap="round">
        <path d="M55 78v36M39 87l32 18M39 105l32-18" />
      </g>
    </Svg>
  );
}
