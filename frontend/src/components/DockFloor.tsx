import { CircleAlert, TriangleAlert } from 'lucide-react';
import { useCallback, useMemo, useRef } from 'react';

import type { Dock, Issue, Role } from '../api/types';
import { elapsed, initials, percent } from '../lib/format';
import { doorStatus } from '../lib/triage';
import { useNow } from '../lib/useNow';
import { DOCK_STATUS, LIFECYCLE } from '../lib/vocab';
import { DockSheet } from './DockSheet';

/**
 * The dock wall, zone by zone: each door is drawn as a bay, with a trailer backed in or the bay
 * open. Zones carry a quiet tint of their own (sage, slate, clay) so the floor reads at a glance
 * without competing with status. Status is carried by words and an icon as well as fill; critical
 * is the one solid brick-red tile. Each door opens its detail sheet; `selectedDoor` is the open one
 * (the caller keeps it in the URL).
 */
const ZONE_TINTS = ['zone-sage', 'zone-slate', 'zone-clay'] as const;

function StatusChip({ status }: { status: Dock['status'] }) {
  if (status === 'critical') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-hazard px-2.5 py-0.5 text-sm font-bold text-white">
        <TriangleAlert size={15} strokeWidth={2.4} aria-hidden="true" />
        {DOCK_STATUS.critical}
      </span>
    );
  }
  if (status === 'issue') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-soft px-2.5 py-0.5 text-sm font-bold text-orange">
        <CircleAlert size={15} strokeWidth={2.4} aria-hidden="true" />
        {DOCK_STATUS.issue}
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-soft px-2.5 py-0.5 text-sm font-semibold text-green">
        <span className="h-2 w-2 rounded-full bg-green" aria-hidden="true" />
        {DOCK_STATUS.active}
      </span>
    );
  }
  return <span className="px-1 text-sm font-semibold text-ink-mute">{DOCK_STATUS.idle}</span>;
}

/**
 * The door opening, seen from inside the building. A trailer being worked has its doors open and
 * you look into it: the load face comes toward you as a load fills, and backs away as one empties.
 * A trailer waiting or finished shows its closed doors; an empty door shows the open bay.
 */
function Bay({
  occupied,
  critical,
  trailer,
  phase,
  share,
}: {
  occupied: boolean;
  critical: boolean;
  trailer: string | null;
  phase: Dock['lifecycle_phase'];
  share: number | null;
}) {
  const line = critical ? 'var(--color-hazard)' : 'var(--color-ink-mute)';
  const open = occupied && (phase === 'loading' || phase === 'unloading' || phase === 'inspection');
  const done = (share ?? 0) / 100;
  const full = phase === 'loading' ? done : phase === 'unloading' ? 1 - done : 0;
  // The interior cross-section at depth: 0.3 at the nose, 0.92 at the doors.
  const section = (scale: number) => ({
    x: 80 - 56 * scale,
    y: 37.5 - 28.5 * scale,
    width: 112 * scale,
    height: 57 * scale,
  });
  const back = section(0.3);
  const face = section(0.3 + 0.62 * full);
  const palletWidth = (face.width - 3) / 2;
  const palletHeight = face.height * 0.42;
  return (
    <svg viewBox="0 0 160 76" aria-hidden="true" className="bay block h-auto w-full">
      {/* The opening in the wall, with its bumpers */}
      <rect x="18" y="4" width="124" height="66" rx="5" className="bay-opening" />
      <rect x="9" y="50" width="8" height="18" rx="2" className="bay-bumper" />
      <rect x="143" y="50" width="8" height="18" rx="2" className="bay-bumper" />
      {open ? (
        <g key={`${trailer ?? 'trailer'}-open`} className="bay-trailer">
          <rect x="24" y="9" width="112" height="57" rx="3" className="bay-interior" />
          <path
            d={`M24 66 L${back.x} ${back.y + back.height} H${back.x + back.width} L136 66 Z`}
            className="bay-floor"
          />
          <rect x={back.x} y={back.y} width={back.width} height={back.height} className="bay-backwall" />
          <line x1="24" y1="9" x2={back.x} y2={back.y} stroke={line} strokeOpacity="0.35" strokeWidth="1" />
          <line
            x1="136"
            y1="9"
            x2={back.x + back.width}
            y2={back.y}
            stroke={line}
            strokeOpacity="0.35"
            strokeWidth="1"
          />
          {full > 0.02 &&
            [0, 1].flatMap((level) =>
              [0, 1].map((column) => {
                const x = face.x + column * (palletWidth + 3);
                const y = face.y + face.height - (level + 1) * (palletHeight + 1.5);
                return (
                  <g key={`${level}-${column}`}>
                    <rect x={x} y={y} width={palletWidth} height={palletHeight} rx="1" className="bay-load" />
                    <rect
                      x={x}
                      y={y + palletHeight * 0.8}
                      width={palletWidth}
                      height={palletHeight * 0.2}
                      className="bay-load-deck"
                    />
                  </g>
                );
              }),
            )}
          {/* The doors, swung back against the trailer sides */}
          <rect x="19.5" y="9" width="4.5" height="57" rx="1" className="bay-door" />
          <rect x="136" y="9" width="4.5" height="57" rx="1" className="bay-door" />
          <rect x="24" y="9" width="112" height="57" rx="3" fill="none" stroke={line} strokeWidth="1.5" />
        </g>
      ) : occupied ? (
        <g key={trailer ?? 'trailer'} className="bay-trailer">
          <rect x="24" y="9" width="112" height="57" rx="3" className="bay-trailer-body" />
          <line x1="80" y1="11" x2="80" y2="64" stroke={line} strokeWidth="1.5" />
          {[38, 62, 98, 122].map((x) => (
            <line
              key={x}
              x1={x}
              y1="14"
              x2={x}
              y2="60"
              stroke={line}
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          ))}
          {[38, 62, 98, 122].map((x) => (
            <rect key={`h${x}`} x={x - 3} y="34" width="6" height="4" rx="1" fill={line} />
          ))}
          <rect x="28" y="60" width="9" height="3.5" rx="1.5" className="bay-lamp" />
          <rect x="123" y="60" width="9" height="3.5" rx="1.5" className="bay-lamp" />
        </g>
      ) : (
        <g>
          <path d="M22 70 L32 58 H128 L138 70 Z" className="bay-leveler" />
          <line x1="40" y1="64" x2="120" y2="64" stroke={line} strokeWidth="1" strokeDasharray="3 4" />
        </g>
      )}
    </svg>
  );
}

function DoorTile({
  dock,
  now,
  onOpen,
  register,
}: {
  dock: Dock;
  now: number;
  onOpen: (door: number) => void;
  register: (door: number, element: HTMLButtonElement | null) => void;
}) {
  const occupied = dock.current_order_id !== null || dock.current_trailer !== null;
  const critical = dock.status === 'critical';
  const phase = dock.lifecycle_phase !== 'idle' ? LIFECYCLE[dock.lifecycle_phase] : null;
  const share =
    dock.cases_expected != null && dock.cases_expected > 0
      ? percent(dock.cases_done ?? 0, dock.cases_expected)
      : null;

  return (
    <button
      type="button"
      ref={(element) => register(dock.door_number, element)}
      onClick={() => onOpen(dock.door_number)}
      aria-haspopup="dialog"
      aria-label={`Dock ${dock.door_number}, ${DOCK_STATUS[dock.status].toLowerCase()}${
        dock.operator_name ? `, ${dock.operator_name}` : ''
      }${share !== null ? `, ${share}% counted` : ''}, open details`}
      className={`door-tile door-${dock.status} lift flex h-full w-full cursor-pointer flex-col gap-3 rounded-2xl p-3.5 text-left`}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="door-plate num text-2xl leading-none">
          {String(dock.door_number).padStart(2, '0')}
        </span>
        <StatusChip status={dock.status} />
      </span>

      <span className="flex w-full min-w-0 items-center gap-3 sm:flex-col sm:items-stretch">
        <span className="w-2/5 shrink-0 sm:w-full">
          <Bay
            occupied={occupied}
            critical={critical}
            trailer={dock.trailer_number ?? dock.current_trailer}
            phase={dock.lifecycle_phase}
            share={share}
          />
        </span>
        <span className="flex w-full min-w-0 items-center gap-2.5">
          {dock.operator_name ? (
            <span className="door-avatar grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold">
              {initials(dock.operator_name)}
            </span>
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold">
              {dock.operator_name ?? (occupied ? 'Unassigned' : 'Open door')}
            </span>
            <span className="door-sub block truncate text-sm">
              {dock.company_name ?? (occupied ? (dock.trailer_number ?? 'Trailer at door') : 'No trailer')}
            </span>
          </span>
        </span>
      </span>

      {phase && (
        <span className="mt-auto flex w-full flex-col gap-1.5">
          <span className="flex items-baseline justify-between gap-2 text-sm font-semibold">
            <span className="whitespace-nowrap">
              {phase}
              {share !== null && <span className="telemetry"> · {share}%</span>}
            </span>
            {dock.trailer_arrived_at && (
              <span className="door-sub telemetry whitespace-nowrap">
                {elapsed(dock.trailer_arrived_at, now)}
              </span>
            )}
          </span>
          {share !== null && (
            <span
              className="door-progress block h-1.5 w-full overflow-hidden rounded-full"
              aria-hidden="true"
            >
              <span className="door-progress-fill block h-full rounded-full" style={{ width: `${share}%` }} />
            </span>
          )}
        </span>
      )}
    </button>
  );
}

export function DockFloor({
  docks: stored,
  openIssues,
  highlightZone,
  viewerRole = null,
  selectedDoor = null,
  onOpen,
  onClose,
}: {
  docks: Dock[];
  /** The viewer's open issues: a door with an open critical reads Critical whatever its stored status. */
  openIssues?: Issue[];
  highlightZone?: string | null;
  viewerRole?: Role | null;
  selectedDoor?: number | null;
  onOpen: (door: number) => void;
  onClose: () => void;
}) {
  const now = useNow();
  const docks = useMemo(
    () =>
      openIssues === undefined
        ? stored
        : stored.map((dock) => {
            const status = doorStatus(dock, openIssues);
            return status === dock.status ? dock : { ...dock, status };
          }),
    [stored, openIssues],
  );
  const tiles = useRef(new Map<number, HTMLButtonElement>());
  const register = useCallback((door: number, element: HTMLButtonElement | null) => {
    if (element) tiles.current.set(door, element);
    else tiles.current.delete(door);
  }, []);
  const returnFocus = useCallback((door: number) => tiles.current.get(door)?.focus(), []);
  const zones = [...new Set(docks.map((dock) => dock.zone))];
  const selected = docks.find((dock) => dock.door_number === selectedDoor) ?? null;

  return (
    <>
      <div className="flex flex-col gap-6">
        {zones.map((zone, index) => {
          const doors = docks.filter((dock) => dock.zone === zone);
          const active = doors.filter((dock) => dock.status !== 'idle').length;
          const issues = doors.filter((dock) => dock.status === 'issue' || dock.status === 'critical').length;
          const yours = zone === highlightZone;
          return (
            <section
              key={zone}
              className={`${ZONE_TINTS[index % ZONE_TINTS.length]} zone-wall`}
              aria-label={zone}
            >
              <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="heading flex items-center gap-2.5 text-xl">
                  <span className="zone-swatch h-3 w-3 rounded-full" aria-hidden="true" />
                  {zone}
                  {yours && <em className="text-base">your team</em>}
                </h3>
                <p className="label">
                  <span className="telemetry text-ink">{active}</span> active
                  {issues > 0 && (
                    <>
                      {' · '}
                      <span className="telemetry text-ink">{issues}</span> with an issue
                    </>
                  )}
                  {' · '}
                  <span className="telemetry text-ink">{doors.length - active}</span> free
                </p>
              </header>
              <ul className="zone-apron grid grid-cols-1 gap-2.5 rounded-3xl p-2.5 sm:grid-cols-2 xl:grid-cols-4">
                {doors.map((dock) => (
                  <li key={dock.id}>
                    <DoorTile dock={dock} now={now} onOpen={onOpen} register={register} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <DockSheet
        dock={selected}
        onClose={onClose}
        returnFocus={returnFocus}
        viewerZone={highlightZone}
        viewerRole={viewerRole}
      />
    </>
  );
}
