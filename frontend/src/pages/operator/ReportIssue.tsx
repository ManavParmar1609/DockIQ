import { ArrowLeft, ArrowUpRight, Check, RotateCcw } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';

import { errorMessage } from '../../api/client';
import {
  useActiveOrder,
  useEscalate,
  useOrder,
  useReportIssue,
  useSelfResolve,
  useTaxonomy,
  useUploadPhoto,
} from '../../api/hooks';
import { aiResolutionOf, type IssueCreated, type IssueTypeSpec, type OrderDetail } from '../../api/types';
import { PhotoPicker, VoiceButton } from '../../components/Evidence';
import { issueIcon } from '../../components/icons';
import { ProcedureCard, RecurringPatterns, SeverityDerivation } from '../../components/Resolution';
import {
  FieldLabel,
  LoadingBlock,
  MutationError,
  Notice,
  PageHeader,
  Panel,
  QueryBoundary,
} from '../../components/ui';
import { formatTemp } from '../../lib/format';
import { readPrefill } from './reportLink';

const GROUPS: { id: string; title: string; blurb: string }[] = [
  { id: 'product', title: 'Product', blurb: 'Condition, temperature, counts, labels on the freight' },
  { id: 'people', title: 'People', blurb: 'Injury, near miss, hazards on the floor' },
  { id: 'systems', title: 'Systems', blurb: 'Equipment, WMS, barcodes, paperwork' },
];

// Descriptive chips for freight issues; they go in the description, not the score.
const QUICK_TAGS = [
  'Crushed',
  'Wet',
  'Punctured',
  'Torn label',
  'Leaking',
  'Leaning',
  'Frost',
  'Odour',
  'Mould',
  'Expired',
];

const STEPS = ['Type', 'Details', 'Procedure', 'Done'];

function StepBar({ step }: { step: number }) {
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="Progress">
      {STEPS.map((label, index) => (
        <li
          key={label}
          aria-current={index === step ? 'step' : undefined}
          className={`flex flex-col gap-1.5 ${index <= step ? 'text-ink' : 'text-ink-mute'}`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 rounded-full ${index <= step ? 'bg-accent' : 'bg-paper-deep'}`}
          />
          <span className="text-sm font-semibold">
            <span className="telemetry">{index + 1}</span>
            <span className="hidden sm:inline"> · {label}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function TypeStep({ types, onPick }: { types: IssueTypeSpec[]; onPick: (type: IssueTypeSpec) => void }) {
  return (
    <div className="flex flex-col gap-6">
      {GROUPS.map((group, groupIndex) => (
        <section key={group.id} className="reveal" style={{ '--i': groupIndex } as CSSProperties}>
          <div className="mb-3 flex flex-wrap items-baseline gap-3 border-b border-hairline pb-2">
            <h2 className="heading text-2xl">{group.title}</h2>
            <p className="text-ink-soft">{group.blurb}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {types
              .filter((type) => type.group === group.id)
              .map((type) => {
                const Icon = issueIcon(type.icon);
                return (
                  <button
                    key={type.name}
                    type="button"
                    className="choice min-h-20"
                    onClick={() => onPick(type)}
                  >
                    <Icon size={26} aria-hidden="true" className="shrink-0" />
                    <span>
                      <span className="block text-lg">{type.name}</span>
                      <span className="text-sm font-normal text-ink-mute">
                        {type.subtypes.length} situations
                      </span>
                    </span>
                  </button>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}

interface Draft {
  subtype: string | null;
  productId: number | null;
  description: string;
  tags: string[];
  temp: string;
  limit: string;
  expected: string;
  actual: string;
  quantity: string;
  photos: Blob[];
}

function DetailsStep({
  type,
  order,
  draft,
  setDraft,
  onBack,
  onSubmit,
  pending,
  error,
}: {
  type: IssueTypeSpec;
  order: OrderDetail | undefined;
  draft: Draft;
  setDraft: (next: Draft) => void;
  onBack: () => void;
  onSubmit: () => void;
  pending: boolean;
  error: Error | null;
}) {
  const product = order?.items.find((item) => item.product_id === draft.productId);
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const isProduct = type.group === 'product';
  const floor = type.floor[draft.subtype ?? ''] ?? type.floor['*'];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" /> Type
        </button>
        <h2 className="display text-3xl">{type.name}</h2>
      </div>

      <Panel title="What exactly?">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Situation">
          {type.subtypes.map((subtype) => (
            <button
              key={subtype}
              type="button"
              role="radio"
              aria-checked={draft.subtype === subtype}
              className="choice"
              onClick={() => set({ subtype })}
            >
              {subtype}
            </button>
          ))}
        </div>
        {floor && (
          <p className="label mt-3 text-ink">
            {floor === 'critical'
              ? 'Always critical — your supervisor is alerted at once'
              : `Never below ${floor}`}
          </p>
        )}
      </Panel>

      {isProduct && order && order.items.length > 0 && (
        <Panel title="Which product?">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Product">
            {order.items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={draft.productId === item.product_id}
                className="choice"
                onClick={() =>
                  set({
                    productId: item.product_id,
                    limit: draft.limit || (item.temp_max === null ? '' : String(item.temp_max)),
                  })
                }
              >
                <span>
                  <span className="block">{item.product_name}</span>
                  <span className="telemetry text-sm font-normal opacity-80">
                    {item.sku} · {item.category}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Panel>
      )}

      {type.name === 'Temperature Deviation' && (
        <Panel title="Readings">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="temp">Probe reading (°F)</FieldLabel>
              <input
                id="temp"
                type="number"
                step="0.1"
                inputMode="decimal"
                className="field text-2xl"
                value={draft.temp}
                onChange={(event) => set({ temp: event.target.value })}
              />
            </div>
            <div>
              <FieldLabel
                htmlFor="limit"
                hint={
                  product && product.temp_max !== null
                    ? `Product max ${formatTemp(product.temp_max)}`
                    : undefined
                }
              >
                Limit (°F)
              </FieldLabel>
              <input
                id="limit"
                type="number"
                step="0.1"
                inputMode="decimal"
                className="field text-2xl"
                value={draft.limit}
                onChange={(event) => set({ limit: event.target.value })}
              />
            </div>
          </div>
        </Panel>
      )}

      {type.name === 'Count Discrepancy' && (
        <Panel title="Counts">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="expected">Expected</FieldLabel>
              <input
                id="expected"
                type="number"
                min={0}
                inputMode="numeric"
                className="field text-2xl"
                value={draft.expected}
                onChange={(event) => set({ expected: event.target.value })}
              />
            </div>
            <div>
              <FieldLabel htmlFor="actual" hint="0 = nothing arrived">
                Actual
              </FieldLabel>
              <input
                id="actual"
                type="number"
                min={0}
                inputMode="numeric"
                className="field text-2xl"
                value={draft.actual}
                onChange={(event) => set({ actual: event.target.value })}
              />
            </div>
          </div>
        </Panel>
      )}

      {isProduct && (
        <Panel title="Cases affected">
          <label htmlFor="quantity" className="sr-only">
            Cases affected
          </label>
          <input
            id="quantity"
            type="number"
            min={0}
            inputMode="numeric"
            className="field w-40 text-2xl"
            value={draft.quantity}
            onChange={(event) => set({ quantity: event.target.value })}
          />
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Quick tags">
            {QUICK_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                className="choice min-h-11 py-1"
                aria-pressed={draft.tags.includes(tag)}
                onClick={() =>
                  set({
                    tags: draft.tags.includes(tag)
                      ? draft.tags.filter((t) => t !== tag)
                      : [...draft.tags, tag],
                  })
                }
              >
                {tag}
              </button>
            ))}
          </div>
        </Panel>
      )}

      <Panel
        title="Describe it"
        aside={
          <VoiceButton
            onText={(text) => set({ description: draft.description ? `${draft.description} ${text}` : text })}
          />
        }
      >
        <label htmlFor="description" className="sr-only">
          Description
        </label>
        <textarea
          id="description"
          rows={3}
          className="field text-lg"
          value={draft.description}
          onChange={(event) => set({ description: event.target.value })}
          placeholder="What you see, where, how much"
        />
      </Panel>

      <Panel title="Photos">
        <PhotoPicker photos={draft.photos} onChange={(photos) => set({ photos })} />
      </Panel>

      <MutationError error={error} />
      <button
        type="button"
        className="btn btn-primary text-lg"
        disabled={!draft.subtype || pending}
        onClick={onSubmit}
      >
        {pending ? 'Scoring and finding the procedure…' : 'Submit and get the procedure'}
      </button>
    </div>
  );
}

function ResultStep({
  type,
  created,
  photoProblem,
  onDone,
}: {
  type: IssueTypeSpec;
  created: IssueCreated;
  photoProblem: string | null;
  onDone: (outcome: 'resolved' | 'escalated') => void;
}) {
  const taxonomy = useTaxonomy();
  const selfResolve = useSelfResolve();
  const escalate = useEscalate();
  const resolution = aiResolutionOf(created);
  const critical = created.severity === 'critical';

  return (
    <div className="flex flex-col gap-4">
      {critical && (
        <Notice tone="alert" title="Critical: escalated to your supervisor">
          They have been alerted and decide what happens next. Follow the procedure below while they come to
          you.
        </Notice>
      )}
      <SeverityDerivation
        severity={created.severity}
        score={created.severity_score}
        reason={created.severity_reason}
        cost={created.estimated_cost_impact}
        index={0}
      />
      <RecurringPatterns patterns={created.recurring_patterns} />
      {resolution && <ProcedureCard resolution={resolution} fallbackTitle={type.name} index={1} />}
      {photoProblem && (
        <Notice tone="alert" title="Photos not attached">
          {photoProblem}
        </Notice>
      )}

      {created.status === 'escalated' ? (
        <Panel title="What happens now" index={2}>
          <p className="text-lg">
            Your supervisor has the full context, the procedure you were shown, and your photos. Keep the
            product where it is until they decide.
          </p>
          <button type="button" className="btn btn-primary mt-4" onClick={() => onDone('escalated')}>
            Done
          </button>
        </Panel>
      ) : (
        <Panel title="Did the procedure fix it?" index={2}>
          <p className="label mb-2">Yes — how:</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {(taxonomy.data?.operator_resolutions ?? []).map((option) => (
              <button
                key={option}
                type="button"
                className="choice justify-center"
                disabled={selfResolve.isPending || escalate.isPending}
                onClick={() =>
                  selfResolve.mutate(
                    {
                      id: created.id,
                      resolution_type: option,
                      resolution_notes: 'Resolved with the suggested procedure',
                    },
                    { onSuccess: () => onDone('resolved') },
                  )
                }
              >
                {option}
              </button>
            ))}
          </div>
          <div className="mt-5 border-t border-hairline pt-5">
            <button
              type="button"
              className="btn btn-hazard w-full text-lg"
              disabled={escalate.isPending || selfResolve.isPending}
              onClick={() => escalate.mutate(created.id, { onSuccess: () => onDone('escalated') })}
            >
              <ArrowUpRight size={22} aria-hidden="true" /> No — escalate to my supervisor
            </button>
            <p className="mt-2 text-sm text-ink-mute">
              They get the full context, the procedure you were shown, and your photos.
            </p>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <MutationError error={selfResolve.error} />
            <MutationError error={escalate.error} />
          </div>
        </Panel>
      )}
    </div>
  );
}

const EMPTY_DRAFT: Draft = {
  subtype: null,
  productId: null,
  description: '',
  tags: [],
  temp: '',
  limit: '',
  expected: '',
  actual: '',
  quantity: '1',
  photos: [],
};

function toNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function Flow({ order }: { order: OrderDetail | undefined }) {
  const taxonomy = useTaxonomy();
  const [search] = useSearchParams();
  const prefill = useMemo(() => readPrefill(search), [search]);
  const report = useReportIssue();
  const upload = useUploadPhoto();
  const [type, setType] = useState<IssueTypeSpec | null>(null);
  const [draft, setDraft] = useState<Draft>(() => ({
    ...EMPTY_DRAFT,
    subtype: prefill.subtype ?? null,
    description: prefill.description ?? '',
    temp: prefill.temp === undefined ? '' : String(prefill.temp),
    limit: prefill.limit === undefined ? '' : String(prefill.limit),
    expected: prefill.expected === undefined ? '' : String(prefill.expected),
    actual: prefill.actual === undefined ? '' : String(prefill.actual),
  }));
  const [created, setCreated] = useState<IssueCreated | null>(null);
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<'resolved' | 'escalated' | null>(null);

  if (taxonomy.isPending) return <LoadingBlock label="Loading issue types" />;
  if (!taxonomy.data)
    return (
      <Notice tone="alert" title="Issue types unavailable">
        {errorMessage(taxonomy.error)}
      </Notice>
    );
  const prefilledType = prefill.type
    ? taxonomy.data.issue_types.find((spec) => spec.name === prefill.type)
    : undefined;
  const current = type ?? prefilledType ?? null;
  const step = outcome ? 3 : created ? 2 : current ? 1 : 0;

  const attachPhotos = async (issueId: number) => {
    for (const photo of draft.photos) {
      try {
        await upload.mutateAsync({ issueId, file: photo });
      } catch (error) {
        setPhotoProblem(errorMessage(error));
      }
    }
  };

  const submit = () => {
    if (!current || !order?.dock_door_id) return;
    const product = order.items.find((item) => item.product_id === draft.productId);
    const description = [draft.description.trim(), ...draft.tags].filter(Boolean).join('. ');
    report.mutate(
      {
        order_id: order.id,
        dock_door_id: order.dock_door_id,
        issue_type: current.name,
        issue_subtype: draft.subtype,
        description,
        quick_tags: draft.tags,
        product_id: product?.product_id ?? null,
        company_id: order.company_id,
        carrier_id: order.carrier_id,
        quantity_affected: toNumber(draft.quantity) ?? 1,
        temp_reading: toNumber(draft.temp),
        temp_threshold_max: toNumber(draft.limit),
        count_expected: toNumber(draft.expected),
        count_actual: toNumber(draft.actual),
      },
      {
        onSuccess: (result) => {
          setCreated(result);
          void attachPhotos(result.id);
        },
      },
    );
  };

  const restart = () => {
    setType(null);
    setDraft(EMPTY_DRAFT);
    setCreated(null);
    setOutcome(null);
    setPhotoProblem(null);
    report.reset();
  };

  return (
    <div className="flex flex-col gap-6">
      <StepBar step={step} />
      {step === 0 && (
        <TypeStep
          types={taxonomy.data.issue_types}
          onPick={(spec) => {
            setType(spec);
            setDraft({ ...draft, subtype: null });
          }}
        />
      )}
      {step === 1 && current && (
        <DetailsStep
          type={current}
          order={order}
          draft={draft}
          setDraft={setDraft}
          onBack={() => {
            setType(null);
            setDraft(EMPTY_DRAFT);
          }}
          onSubmit={submit}
          pending={report.isPending}
          error={report.error}
        />
      )}
      {step === 2 && current && created && (
        <ResultStep type={current} created={created} photoProblem={photoProblem} onDone={setOutcome} />
      )}
      {step === 3 && created && (
        <Panel title="Logged">
          <div className="flex items-center gap-4">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-green-soft text-green">
              <Check size={36} aria-hidden="true" />
            </span>
            <div>
              <p className="display text-3xl">{outcome === 'escalated' ? 'Escalated' : 'Resolved'}</p>
              <p className="text-lg text-ink-soft">
                {outcome === 'escalated'
                  ? 'Your supervisor has it, with everything you recorded.'
                  : 'Recorded as resolved by you. It counts toward the dock and carrier history.'}
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to={`/app/issues/${created.id}`} className="btn btn-secondary">
              View issue <span className="telemetry">#{created.id}</span>
            </Link>
            <button type="button" className="btn btn-secondary" onClick={restart}>
              <RotateCcw size={18} aria-hidden="true" /> Report another
            </button>
            <Link to="/app" className="btn btn-primary">
              Back to shift
            </Link>
          </div>
        </Panel>
      )}
    </div>
  );
}

export default function ReportIssue() {
  const active = useActiveOrder();
  const order = useOrder(active.data?.id);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        kicker="Report and resolve"
        title="Issue"
        meta={
          active.data ? (
            <>
              <span className="telemetry">Dock {active.data.door_number}</span>
              <span>{active.data.company_name}</span>
              <span className="telemetry">Trailer {active.data.trailer_number}</span>
            </>
          ) : undefined
        }
      />
      {active.isPending ? (
        <LoadingBlock label="Finding your assignment" />
      ) : !active.data ? (
        <Notice title="No active assignment">
          Issues are reported against the trailer at your dock. Ask your supervisor for an assignment.
        </Notice>
      ) : (
        <QueryBoundary query={order} loading="Loading the order">
          {(detail) => <Flow order={detail} />}
        </QueryBoundary>
      )}
    </div>
  );
}
