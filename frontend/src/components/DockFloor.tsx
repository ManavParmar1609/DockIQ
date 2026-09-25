import { useCallback, useRef } from 'react';

import type { Dock } from '../api/types';
import { DOCK_STATUS, LIFECYCLE } from '../lib/vocab';
import { DockSheet } from './DockSheet';

/**
 * The twelve doors as a floor plan, one group per zone. Status is carried by fill *and* words:
 * critical is solid red, an open issue is an orange tint, active is a white tile, idle is recessed.
 * Each door opens its detail sheet; `selectedDoor` is the open one (the caller keeps it in the URL).
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

export function DockFloor({
  docks,
  highlightZone,
  selectedDoor = null,
  onOpen,
  onClose,
}: {
  docks: Dock[];
  highlightZone?: string | null;
  selectedDoor?: number | null;
  onOpen: (door: number) => void;
  onClose: () => void;
}) {
  const tiles = useRef(new Map<number, HTMLButtonElement>());
  const returnFocus = useCallback((door: number) => tiles.current.get(door)?.focus(), []);
  const zones = [...new Set(docks.map((dock) => dock.zone))];
  const selected = docks.find((dock) => dock.door_number === selectedDoor) ?? null;

  return (
    <>
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
                  <li key={dock.id}>
                    <button
                      type="button"
                      ref={(element) => {
                        if (element) tiles.current.set(dock.door_number, element);
                        else tiles.current.delete(dock.door_number);
                      }}
                      onClick={() => onOpen(dock.door_number)}
                      aria-haspopup="dialog"
                      aria-label={`Dock ${dock.door_number}, ${DOCK_STATUS[dock.status].toLowerCase()}, open details`}
                      className={`lift flex min-h-32 w-full cursor-pointer flex-col gap-2 rounded-lg p-3 text-left ${TONE[dock.status]}`}
                    >
                      <span className="flex w-full items-baseline justify-between gap-2">
                        <span className="num text-3xl leading-none">{dock.door_number}</span>
                        <span className={`text-sm font-semibold ${STATUS_TEXT[dock.status]}`}>
                          {DOCK_STATUS[dock.status]}
                        </span>
                      </span>
                      <span className="mt-auto block w-full min-w-0">
                        <span className="block truncate text-base font-semibold">
                          {dock.operator_name ?? 'Unassigned'}
                        </span>
                        <span className="block truncate text-sm">{dock.company_name ?? 'No load'}</span>
                        {dock.lifecycle_phase !== 'idle' && (
                          <span className="mt-0.5 block text-sm font-medium">
                            {LIFECYCLE[dock.lifecycle_phase]}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
      <DockSheet dock={selected} onClose={onClose} returnFocus={returnFocus} />
    </>
  );
}
