import { Check, X } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router';

import { useActiveOrder, useInspection } from '../../api/hooks';
import {
  ChoiceGroup,
  EmptyState,
  FieldLabel,
  LoadingBlock,
  MutationError,
  Notice,
  PageHeader,
  Panel,
} from '../../components/ui';
import { formatTemp } from '../../lib/format';
import { reportLink } from './reportLink';

const SEAL = [
  { value: 'intact', label: 'Intact' },
  { value: 'broken', label: 'Broken' },
  { value: 'missing', label: 'Missing' },
] as const;
const CLEAN = [
  { value: 'clean', label: 'Clean' },
  { value: 'debris', label: 'Debris' },
  { value: 'odor', label: 'Odour' },
  { value: 'wet', label: 'Wet' },
] as const;
const DAMAGE = [
  { value: 'none', label: 'None' },
  { value: 'wall', label: 'Walls' },
  { value: 'floor', label: 'Floor' },
  { value: 'ceiling', label: 'Ceiling' },
] as const;

const FAILED_LABEL: Record<string, string> = {
  seal: 'Seal',
  cleanliness: 'Cleanliness',
  damage: 'Visible damage',
  temperature: 'Temperature',
};
const FAILED_REPORT: Record<string, { type: string; subtype: string }> = {
  seal: { type: 'Seal/Trailer Condition', subtype: 'Seal broken or missing' },
  cleanliness: { type: 'Seal/Trailer Condition', subtype: 'Dirty or contaminated trailer' },
  damage: { type: 'Seal/Trailer Condition', subtype: 'Trailer damaged (floor or walls)' },
  temperature: { type: 'Temperature Deviation', subtype: 'Trailer not pre-cooled' },
};

export default function Inspection() {
  const order = useActiveOrder();
  const inspect = useInspection();
  const [seal, setSeal] = useState<(typeof SEAL)[number]['value'] | null>(null);
  const [clean, setClean] = useState<(typeof CLEAN)[number]['value'] | null>(null);
  const [damage, setDamage] = useState<(typeof DAMAGE)[number]['value'] | null>(null);
  const [temperature, setTemperature] = useState('');
  const [notes, setNotes] = useState('');

  if (order.isPending) return <LoadingBlock label="Finding your assignment" />;
  const assignment = order.data;
  if (!assignment?.dock_door_id) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Inspection" />
        <EmptyState title="No trailer to inspect">
          A trailer assigned to your dock will appear here.
        </EmptyState>
      </div>
    );
  }

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!seal || !clean || !damage) return;
    const reading = Number.parseFloat(temperature);
    inspect.mutate({
      order_id: assignment.id,
      dock_door_id: assignment.dock_door_id ?? 0,
      seal_condition: seal,
      interior_cleanliness: clean,
      visible_damage: damage,
      interior_temperature: Number.isNaN(reading) ? null : reading,
      notes,
    });
  };

  const result = inspect.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        kicker="Pre-work check"
        title="Trailer inspection"
        meta={
          <>
            <span className="telemetry">Dock {assignment.door_number}</span>
            <span className="telemetry">Trailer {assignment.trailer_number}</span>
            <span>{assignment.company_name}</span>
          </>
        }
      />

      {result ? (
        <Panel title="Result">
          {result.overall_pass ? (
            <div className="flex items-center gap-4">
              <span className="grid h-16 w-16 place-items-center bg-ink text-light">
                <Check size={36} aria-hidden="true" />
              </span>
              <div>
                <p className="display text-3xl">Passed</p>
                <p className="text-lg text-ink-soft">
                  Cleared to {assignment.type === 'outbound' ? 'load' : 'unload'}.
                </p>
              </div>
            </div>
          ) : (
            <Notice tone="alert" title="Inspection failed — do not start work">
              <ul className="mt-2 flex flex-col gap-2">
                {result.failed_checks.map((check) => (
                  <li key={check} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-semibold">
                      <X size={18} aria-hidden="true" /> {FAILED_LABEL[check] ?? check}
                      {check === 'temperature' &&
                        ` — above the ${formatTemp(result.temperature_limit)} limit for this load`}
                    </span>
                    {FAILED_REPORT[check] && (
                      <Link
                        to={reportLink({
                          ...FAILED_REPORT[check],
                          description: `Inspection failed: ${FAILED_LABEL[check] ?? check}`,
                        })}
                        className="btn btn-hazard"
                      >
                        Report
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </Notice>
          )}
          <p className="label mt-4">
            Temperature limit applied: {formatTemp(result.temperature_limit)} — the strictest product on this
            load
          </p>
          <div className="mt-4 flex gap-2">
            <Link to="/app/order" className="btn btn-primary">
              Go to order
            </Link>
            <button type="button" className="btn btn-secondary" onClick={() => inspect.reset()}>
              Inspect again
            </button>
          </div>
        </Panel>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-6">
          <Panel title="Condition">
            <div className="flex flex-col gap-6">
              <ChoiceGroup label="Seal" options={SEAL} value={seal} onChange={setSeal} columns={3} />
              <ChoiceGroup label="Interior" options={CLEAN} value={clean} onChange={setClean} columns={4} />
              <ChoiceGroup
                label="Visible damage"
                options={DAMAGE}
                value={damage}
                onChange={setDamage}
                columns={4}
              />
            </div>
          </Panel>
          <Panel title="Reefer">
            <FieldLabel htmlFor="interior-temp" hint="Leave blank for a dry-goods trailer">
              Interior temperature (°F)
            </FieldLabel>
            <input
              id="interior-temp"
              type="number"
              step="0.1"
              inputMode="decimal"
              className="field text-2xl"
              value={temperature}
              onChange={(event) => setTemperature(event.target.value)}
            />
          </Panel>
          <Panel title="Notes">
            <label htmlFor="inspection-notes" className="sr-only">
              Notes
            </label>
            <textarea
              id="inspection-notes"
              rows={3}
              className="field"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Anything else you noticed"
            />
          </Panel>
          <MutationError error={inspect.error} />
          <button
            type="submit"
            className="btn btn-primary text-lg"
            disabled={!seal || !clean || !damage || inspect.isPending}
          >
            {inspect.isPending ? 'Submitting…' : 'Submit inspection'}
          </button>
        </form>
      )}
    </div>
  );
}
