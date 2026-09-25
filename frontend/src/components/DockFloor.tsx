import type { Dock } from '../api/types';
import { DOCK_STATUS, LIFECYCLE } from '../lib/vocab';

/**
 * The twelve doors as a floor plan, one block per zone. Status is carried by fill *and* words:
 * critical is hazard red, an issue is solid ink, active is outlined, idle is recessed.
 */
export function DockFloor({ docks, highlightZone }: { docks: Dock[]; highlightZone?: string | null }) {
  const zones = [...new Set(docks.map((dock) => dock.zone))];
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {zones.map((zone) => (
        <div key={zone}>
          <p className={`label mb-2 ${zone === highlightZone ? 'text-ink' : ''}`}>
            {zone}
            {zone === highlightZone && ' · your team'}
          </p>
          <ul className="grid grid-cols-2 gap-0.5 border-2 border-ink bg-ink">
            {docks
              .filter((dock) => dock.zone === zone)
              .map((dock) => {
                const tone =
                  dock.status === 'critical'
                    ? 'bg-hazard text-light'
                    : dock.status === 'issue'
                      ? 'bg-ink text-light'
                      : dock.status === 'active'
                        ? 'bg-light'
                        : 'bg-paper-sunk text-ink-mute';
                return (
                  <li key={dock.id} className={`flex min-h-32 flex-col gap-2 p-3 ${tone}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="display text-4xl">{String(dock.door_number).padStart(2, '0')}</span>
                      <span className="label text-current">{DOCK_STATUS[dock.status]}</span>
                    </div>
                    <div className="mt-auto min-w-0">
                      <p className="truncate font-semibold">{dock.operator_name ?? 'Unassigned'}</p>
                      <p className="truncate text-sm">{dock.company_name ?? 'No load'}</p>
                      {dock.lifecycle_phase !== 'idle' && (
                        <p className="label mt-1 text-current">{LIFECYCLE[dock.lifecycle_phase]}</p>
                      )}
                    </div>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </div>
  );
}
