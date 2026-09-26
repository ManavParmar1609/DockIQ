import {
  CloudOff,
  FastForward,
  Flame,
  PackageX,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  Siren,
  Truck,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router';

import { ApiError } from '../../api/client';
import { useInjectScenario, useSimControl, useSimStatus, useYard } from '../../api/hooks';
import type { SimScenario, SimSpeed, SimStatus, YardEntry } from '../../api/types';
import { useUser } from '../../auth/AuthProvider';
import {
  EmptyState,
  MutationError,
  Notice,
  PageHeader,
  Panel,
  QueryBoundary,
  SimulatedTag,
  Stat,
  StatGrid,
  Tag,
} from '../../components/ui';
import { duration, formatTemp } from '../../lib/format';
import { WarehouseTabs } from './WarehouseTabs';

const SPEEDS: readonly { value: `${SimSpeed}`; label: string }[] = [
  { value: '1', label: '1× real time' },
  { value: '5', label: '5×' },
  { value: '15', label: '15×' },
  { value: '60', label: '60×' },
];

const SCENARIOS: readonly { value: SimScenario; label: string; detail: string; icon: LucideIcon }[] = [
  {
    value: 'temperature_emergency',
    label: 'Temperature emergency',
    detail: 'Frozen load reads 28°F over its limit. Critical; Quality is alerted.',
    icon: Flame,
  },
  {
    value: 'wrong_product',
    label: 'Wrong product staged',
    detail: 'Look-alike packaging on an outbound load.',
    icon: PackageX,
  },
  {
    value: 'damaged_pallet',
    label: 'Crushed pallet',
    detail: 'About 8 cases damaged on arrival.',
    icon: Truck,
  },
  {
    value: 'injury',
    label: 'Employee injury',
    detail: 'Always critical, whatever the load.',
    icon: Siren,
  },
  {
    value: 'wms_outage',
    label: 'WMS outage',
    detail: 'Lookups fail for 8 simulated minutes; completions queue.',
    icon: CloudOff,
  },
];

const YARD_STATE: Record<YardEntry['state'], string> = {
  scheduled: 'Due',
  in_yard: 'In yard',
  at_door: 'At door',
  departed: 'Left',
};

const EVENT_KIND: Record<string, string> = {
  arrival: 'Arrived',
  work: 'Work',
  exception: 'Exception',
  follow_up: 'Follow-up',
  departure: 'Left',
  outage: 'WMS',
  injected: 'Injected',
  stock_exception: 'Warehouse',
  room_excursion: 'Cold room',
};

/** "Are you sure?" for the one control that removes data: the existing centred-sheet dialog. */
function ConfirmReset({
  open,
  seed,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  seed: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      onClose={onCancel}
      aria-labelledby="reset-title"
      className="sheet m-auto rounded-2xl bg-surface p-0 text-ink shadow-float"
    >
      <div className="flex items-center justify-between px-5 pt-4">
        <h2 id="reset-title" className="heading text-xl">
          Reset the simulation?
        </h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="grid h-11 w-11 place-items-center rounded-full bg-paper-sunk text-ink-mute"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-col gap-4 p-5">
        <p className="text-base">
          Every simulated trailer, order, issue and movement is removed and the clock goes back to 06:00,
          paused{seed ? `, with seed ${seed}` : ''}. Reports people filed on simulated trailers are kept. This
          cannot be undone.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Keep the shift
          </button>
          <button type="button" className="btn btn-hazard" disabled={busy} onClick={onConfirm}>
            <RotateCcw size={20} aria-hidden="true" /> Reset to 06:00
          </button>
        </div>
      </div>
    </dialog>
  );
}

function Controls({ status }: { status: SimStatus }) {
  const control = useSimControl();
  const busy = control.isPending;

  return (
    <Panel title="Clock" index={1}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-2">
          {status.running ? (
            <button
              type="button"
              className="btn btn-primary min-w-40"
              disabled={busy}
              onClick={() => control.mutate({ action: 'pause' })}
            >
              <Pause size={20} aria-hidden="true" /> Pause
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary min-w-40"
              disabled={busy}
              onClick={() => control.mutate({ action: 'play' })}
            >
              <Play size={20} aria-hidden="true" /> Play
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => control.mutate({ action: 'step', minutes: 15 })}
          >
            <FastForward size={20} aria-hidden="true" /> +15 min
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => control.mutate({ action: 'step', minutes: 60 })}
          >
            <FastForward size={20} aria-hidden="true" /> +1 hour
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => control.mutate({ action: 'next-shift' })}
          >
            <SkipForward size={20} aria-hidden="true" /> Next shift
          </button>
        </div>

        <fieldset>
          <legend className="heading mb-2 text-base">Speed</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Speed">
            {SPEEDS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={String(status.speed) === option.value}
                className="choice justify-center"
                disabled={busy}
                onClick={() => control.mutate({ action: 'speed', speed: Number(option.value) as SimSpeed })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
        <MutationError error={control.error} />
      </div>
    </Panel>
  );
}

/** Reset to 06:00, behind its "are you sure?" dialog. Supervisors only. */
function ResetShift({ status }: { status: SimStatus }) {
  const control = useSimControl();
  const [seed, setSeed] = useState('');
  const [confirming, setConfirming] = useState(false);
  const busy = control.isPending;

  const askReset = (event: SyntheticEvent) => {
    event.preventDefault();
    setConfirming(true);
  };
  const reset = () => {
    const value = seed.trim() === '' ? null : Number(seed);
    control.mutate({ action: 'reset', seed: value }, { onSettled: () => setConfirming(false) });
  };

  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-4">
      <form onSubmit={askReset} className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label htmlFor="seed" className="heading mb-2 block text-base">
            Reset to 06:00
          </label>
          <input
            id="seed"
            className="field telemetry w-full"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder={`Seed ${status.seed} (same seed, same shift)`}
            value={seed}
            onChange={(event) => setSeed(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={busy}>
          <RotateCcw size={20} aria-hidden="true" /> Reset…
        </button>
      </form>
      <MutationError error={control.error} />
      <ConfirmReset
        open={confirming}
        seed={seed}
        busy={busy}
        onConfirm={reset}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

/** A scenario puts a real-looking alert on screens across the floor, so it takes a second, deliberate tap. */
function Scenarios() {
  const inject = useInjectScenario();
  const [armed, setArmed] = useState<SimScenario | null>(null);
  const chosen = SCENARIOS.find((scenario) => scenario.value === armed);
  const fire = () => {
    if (!armed) return;
    inject.mutate(armed, { onSettled: () => setArmed(null) });
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="heading text-base">Trigger a scenario</p>
      <ul className="flex flex-col gap-2">
        {SCENARIOS.map((scenario) => (
          <li key={scenario.value}>
            <button
              type="button"
              className="choice w-full items-start gap-3 text-left"
              aria-pressed={armed === scenario.value}
              disabled={inject.isPending}
              onClick={() => setArmed((current) => (current === scenario.value ? null : scenario.value))}
            >
              <scenario.icon size={22} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="flex flex-col gap-0.5">
                <span className="heading text-base">{scenario.label}</span>
                <span className="text-sm font-normal">{scenario.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {chosen && (
        <div
          className="flex flex-col gap-3 rounded-lg bg-paper-sunk p-3"
          role="group"
          aria-label="Confirm the scenario"
        >
          <p className="text-base">
            Trigger <strong>{chosen.label}</strong> now? It reaches the floor as a simulated issue, with its
            alerts.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" disabled={inject.isPending} onClick={fire}>
              <chosen.icon size={20} aria-hidden="true" /> Trigger it
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setArmed(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div aria-live="polite">
        {inject.isSuccess && <p className="rounded-lg bg-paper-sunk p-3 text-base">{inject.data.message}</p>}
        <MutationError error={inject.error} />
      </div>
    </div>
  );
}

/** Scenario triggers and the reset, tucked away: a live floor is not changed by a stray tap. */
function DemoControls({ status, canReset }: { status: SimStatus; canReset: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <Panel index={2}>
      <button
        type="button"
        className="accordion-row flex w-full items-center gap-3 text-left"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0 flex-1">
          <span className="serif-title block text-xl">Demo controls</span>
          <span className="label block">
            Scenarios on cue{canReset ? ' and the reset' : ''}, each with a confirm
          </span>
        </span>
        <Plus size={22} aria-hidden="true" className="accordion-icon shrink-0 text-ink-mute" />
      </button>
      <div id={id} hidden={!open}>
        {open && (
          <div className="accordion-body flex flex-col gap-5 pt-4">
            <Scenarios />
            {canReset && <ResetShift status={status} />}
          </div>
        )}
      </div>
    </Panel>
  );
}

/** "On time", "22 min late" or "8 min early", against the booked appointment. */
function punctualityOf(entry: YardEntry): string {
  if (entry.arrived_at == null || entry.late_minutes == null) return 'Not arrived';
  const late = Math.round(entry.late_minutes);
  if (late > 15) return `Arrived ${entry.arrived_at} · ${String(late)} min late`;
  if (late < -5) return `Arrived ${entry.arrived_at} · ${String(-late)} min early`;
  return `Arrived ${entry.arrived_at} · on time`;
}

function Kpis({ status }: { status: SimStatus }) {
  const { kpis } = status;
  return (
    <StatGrid>
      <Stat
        label="On time"
        value={kpis.on_time_percent == null ? '—' : `${String(kpis.on_time_percent)}%`}
        sub={`${String(kpis.arrived)} trailers arrived`}
        index={4}
      />
      <Stat
        label="Turn time"
        value={kpis.average_turn_minutes == null ? '—' : duration(kpis.average_turn_minutes)}
        sub="Gate to departure"
        index={5}
      />
      <Stat
        label="Door use"
        value={`${String(Math.round(kpis.door_utilization_percent))}%`}
        sub={`${String(kpis.pallets_per_hour)} pallets an hour`}
        index={6}
      />
      <Stat label="Detention" value={kpis.on_detention} sub="On site over two hours" index={7} />
    </StatGrid>
  );
}

function YardBoard({ online }: { online: boolean }) {
  const yard = useYard(online);
  const offline = !online || (yard.error instanceof ApiError && yard.error.status === 503);
  return (
    <Panel title="Yard board" aside={<span className="label">From the WMS</span>} index={3} flush>
      {offline ? (
        <div className="p-4">
          <EmptyState title="WMS offline" icon={<CloudOff size={28} aria-hidden="true" />}>
            The yard board comes back with the WMS. Trailers keep moving at the doors meanwhile.
          </EmptyState>
        </div>
      ) : (
        <QueryBoundary query={yard} loading="Reading the yard">
          {(entries) =>
            entries.length === 0 ? (
              <div className="p-4">
                <EmptyState title="No trailers booked">
                  Press play and the first appointments arrive.
                </EmptyState>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-xl border-collapse text-left">
                  <thead>
                    <tr className="border-b border-hairline">
                      {['Door', 'Trailer', 'Customer', 'Booked', 'Reefer', 'State'].map((heading) => (
                        <th key={heading} scope="col" className="label px-4 py-2 font-normal">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.ref} className="border-b border-hairline">
                        <td className="px-4 py-2.5">
                          <p className="telemetry text-lg">{String(entry.door).padStart(2, '0')}</p>
                          {entry.booked_door != null && entry.booked_door !== entry.door && (
                            <p className="telemetry whitespace-nowrap text-sm text-ink-mute">
                              Booked {String(entry.booked_door).padStart(2, '0')}
                            </p>
                          )}
                          {entry.yard_spot && (
                            <p className="telemetry text-sm text-ink-mute">{entry.yard_spot}</p>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="telemetry whitespace-nowrap">{entry.trailer}</p>
                          <p className="telemetry whitespace-nowrap text-sm text-ink-mute">
                            {entry.order_number} · {entry.type === 'inbound' ? 'In' : 'Out'}
                          </p>
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="font-semibold">{entry.customer}</p>
                          <p className="text-sm text-ink-mute">{entry.carrier}</p>
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="telemetry text-lg">{entry.scheduled_at}</p>
                          <p className="whitespace-nowrap text-sm text-ink-mute">{punctualityOf(entry)}</p>
                        </td>
                        <td className="telemetry whitespace-nowrap px-4 py-2.5">
                          {entry.reefer_setpoint == null ? '—' : formatTemp(entry.reefer_setpoint)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Tag tone={entry.state === 'at_door' ? 'ink' : 'plain'}>
                              {YARD_STATE[entry.state]}
                              {entry.due_in_minutes != null && ` · ${Math.round(entry.due_in_minutes)}m`}
                            </Tag>
                            {entry.detention && <Tag tone="accent">Detention</Tag>}
                          </div>
                          {entry.dwell_minutes != null && (
                            <p className="mt-1 whitespace-nowrap text-sm text-ink-mute">
                              {duration(entry.dwell_minutes)} on site
                            </p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </QueryBoundary>
      )}
    </Panel>
  );
}

function EventFeed({ status }: { status: SimStatus }) {
  return (
    <Panel title="What just happened" index={4}>
      {status.events.length === 0 ? (
        <EmptyState title="Quiet">Events appear here as the shift runs.</EmptyState>
      ) : (
        <ol className="flex flex-col">
          {status.events.map((event, index) => (
            <li
              key={`${event.clock}-${event.kind}-${index}`}
              className="flex gap-3 border-b border-hairline py-2 last:border-b-0"
            >
              <span className="telemetry w-14 shrink-0 text-base">
                {event.clock.split('· ')[1] ?? event.clock}
              </span>
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="label">{EVENT_KIND[event.kind] ?? event.kind}</span>
                {event.issue_id != null ? (
                  <Link to={`/app/issues/${event.issue_id}`} className="font-semibold underline">
                    {event.message}
                  </Link>
                ) : (
                  <span>{event.message}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export default function Simulator() {
  const user = useUser();
  const status = useSimStatus();
  return (
    <QueryBoundary query={status} loading="Starting the simulator">
      {(sim) => {
        const [shiftLabel, time] = sim.clock.split(' · ');
        return (
          <div className="flex flex-col gap-6">
            <PageHeader
              kicker={`Simulated WMS · seed ${sim.seed}`}
              title={<span className="num">{time ?? sim.clock}</span>}
              meta={
                <>
                  <span>{shiftLabel}</span>
                  <span>{sim.running ? `Running at ${sim.speed}×` : 'Paused'}</span>
                  <SimulatedTag />
                </>
              }
              actions={
                <Tag tone={sim.wms_online ? 'plain' : 'hazard'}>
                  {sim.wms_online ? 'WMS online' : 'WMS offline'}
                </Tag>
              }
            />

            <div
              className="meter h-2.5"
              role="progressbar"
              aria-label="Shift progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={sim.shift_progress}
            >
              <div className="meter-fill" style={{ width: `${sim.shift_progress}%` }} />
            </div>

            {!sim.running && sim.minute === 0 && (
              <Notice title="A whole shift, on demand">
                Trailers arrive at the doors, simulated crew count and inspect them, and problems surface and
                get scored by the same formula as a real report. Press play, or trigger a scenario. Anything a
                person touches is theirs from then on.
              </Notice>
            )}

            <StatGrid>
              <Stat label="Due" value={sim.trailers.scheduled} sub="Booked, not arrived" index={0} />
              <Stat label="In yard" value={sim.trailers.in_yard} sub="Waiting for a door" index={1} />
              <Stat label="At door" value={sim.trailers.at_door} sub="Being worked" index={2} />
              <Stat label="Left" value={sim.trailers.departed} sub="This shift" index={3} />
            </StatGrid>
            <Kpis status={sim} />

            <div className="grid items-start gap-6 xl:grid-cols-5">
              <div className="xl:col-span-3">
                <Controls status={sim} />
              </div>
              <div className="xl:col-span-2">
                <DemoControls status={sim} canReset={user.role === 'supervisor'} />
              </div>
            </div>
            <WarehouseTabs online={sim.wms_online} yard={<YardBoard online={sim.wms_online} />} />
            <EventFeed status={sim} />
          </div>
        );
      }}
    </QueryBoundary>
  );
}
