import type { Dock } from '../api/types';
import { DOCK_STATUS, LIFECYCLE } from '../lib/vocab';

/**
 * The twelve doors as a floor plan, one group per zone. Status is carried by fill *and* words:
 * critical is solid red, an open issue is an orange tint, active is a white tile, idle is recessed.
 */
const TONE: Record<Dock['status'], string> = {
  critical: 'bg-hazard text-white',
  issue: 'bg-orange-soft text-ink ring-1 ring-orange',
  active: 'bg-surface ring-1 ring-hairline',
  idle: 'bg-paper-sunk text-ink-mute',
};

const STATUS_TEXT: Record<Dock['status'], string> = {
  critical: 'text-white',
  issue: 'text-orange',
  active: 'text-green',
  idle: 'text-ink-mute',
};

export function DockFloor({ docks, highlightZone }: { docks: Dock[]; highlightZone?: string | null }) {
  const zones = [...new Set(docks.map((dock) => dock.zone))];
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {zones.map((zone) => (
        <div key={zone}>
          <p
            className={`mb-2 text-sm font-semibold ${zone === highlightZone ? 'text-ink' : 'text-ink-mute'}`}
          >
            {zone}
            {zone === highlightZone && ' · your team'}
          </p>
          <ul className="grid grid-cols-2 gap-2">
            {docks
              .filter((dock) => dock.zone === zone)
              .map((dock) => (
                <li
                  key={dock.id}
                  className={`flex min-h-32 flex-col gap-2 rounded-lg p-3 ${TONE[dock.status]}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="num text-3xl leading-none">{dock.door_number}</span>
                    <span className={`text-sm font-semibold ${STATUS_TEXT[dock.status]}`}>
                      {DOCK_STATUS[dock.status]}
                    </span>
                  </div>
                  <div className="mt-auto min-w-0">
                    <p className="truncate text-base font-semibold">{dock.operator_name ?? 'Unassigned'}</p>
                    <p className="truncate text-sm">{dock.company_name ?? 'No load'}</p>
                    {dock.lifecycle_phase !== 'idle' && (
                      <p className="mt-0.5 text-sm font-medium">{LIFECYCLE[dock.lifecycle_phase]}</p>
                    )}
                  </div>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
