import { Check, ClipboardCheck, NotebookPen, ShieldCheck, Thermometer, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router';

import { useActiveOrder, useInspection, useOrder } from '../../api/hooks';
import type { InspectionResult } from '../../api/types';
import {
  ChoiceGroup,
  EmptyState,
  ErrorBlock,
  FieldLabel,
  LoadingBlock,
  MutationError,
  Notice,
  PageHeader,
  Panel,
} from '../../components/ui';
import { formatDateTime, formatTemp } from '../../lib/format';
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

type Outcome = Pick<InspectionResult, 'overall_pass' | 'temperature_limit' | 'failed_checks'> & {
  created_at?: string;
};

/** A section title with its filed medallion: the colour says what kind of check it is. */
function SectionTitle({ icon, file, children }: { icon: ReactNode; file: string; children: ReactNode }) {
  return (
    <span className={`file-${file} flex items-center gap-3`}>
      <span className="medallion">{icon}</span>
      {children}
    </span>
  );
}

export default function Inspection() {
  const order = useActiveOrder();
  // The detail says what the load needs (a temperature-controlled line) and how the last inspection went.
  const detail = useOrder(order.data?.id);
  const inspect = useInspection();
  const [again, setAgain] = useState(false);
  const [seal, setSeal] = useState<(typeof SEAL)[number]['value'] | null>(null);
  const [clean, setClean] = useState<(typeof CLEAN)[number]['value'] | null>(null);
  const [damage, setDamage] = useState<(typeof DAMAGE)[number]['value'] | null>(null);
  const [temperature, setTemperature] = useState('');
  const [notes, setNotes] = useState('');

  if (order.isPending) return <LoadingBlock label="Finding your assignment" />;
  if (order.isError && !order.data) {
    return <ErrorBlock error={order.error} onRetry={() => void order.refetch()} />;
  }
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

  const limits = (detail.data?.items ?? [])
    .map((item) => item.temp_max)
    .filter((limit): limit is number => limit !== null);
  const needsTemperature = limits.length > 0;
  const strictest = needsTemperature ? Math.min(...limits) : null;
  const reading = Number.parseFloat(temperature);
  const missingTemperature = needsTemperature && Number.isNaN(reading);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!seal || !clean || !damage || missingTemperature) return;
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

  // The inspection just submitted, or the last one on record when coming back to this screen.
  const result: Outcome | undefined =
    inspect.data ?? (again ? undefined : (detail.data?.inspection ?? undefined));
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
        <Panel
          title={
            <SectionTitle icon={<ClipboardCheck size={20} aria-hidden="true" />} file="green">
              Result
            </SectionTitle>
          }
        >
          {result.overall_pass ? (
            <div className="flex items-center gap-4">
              <span className="grid h-16 w-16 place-items-center rounded-full bg-green-soft text-green">
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
          {result.created_at && (
            <p className="telemetry mt-1 text-sm text-ink-mute">
              Inspected {formatDateTime(result.created_at)}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <Link to="/app/order" className="btn btn-primary">
              Go to order
            </Link>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                inspect.reset();
                setAgain(true);
              }}
            >
              Inspect again
            </button>
          </div>
        </Panel>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-6">
          <Panel
            title={
              <SectionTitle icon={<ShieldCheck size={20} aria-hidden="true" />} file="product">
                Condition
              </SectionTitle>
            }
          >
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
          <Panel
            title={
              <SectionTitle icon={<Thermometer size={20} aria-hidden="true" />} file="systems">
                Reefer
              </SectionTitle>
            }
          >
            <FieldLabel
              htmlFor="interior-temp"
              hint={
                strictest === null
                  ? 'Leave blank for a dry-goods trailer'
                  : `Required · this load must hold ${formatTemp(strictest)} or colder`
              }
            >
              Interior temperature (°F)
            </FieldLabel>
            <input
              id="interior-temp"
              type="number"
              step="0.1"
              inputMode="decimal"
              className="field text-2xl"
              value={temperature}
              required={needsTemperature}
              aria-required={needsTemperature}
              onChange={(event) => setTemperature(event.target.value)}
            />
          </Panel>
          <Panel
            title={
              <SectionTitle icon={<NotebookPen size={20} aria-hidden="true" />} file="people">
                Notes
              </SectionTitle>
            }
          >
            <label htmlFor="inspection-notes" className="sr-only">
              Notes
            </label>
            <textarea
              id="inspection-notes"
              rows={3}
              maxLength={2000}
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
            disabled={
              !seal || !clean || !damage || missingTemperature || detail.isPending || inspect.isPending
            }
          >
            {inspect.isPending ? 'Submitting…' : 'Submit inspection'}
          </button>
        </form>
      )}
    </div>
  );
}
