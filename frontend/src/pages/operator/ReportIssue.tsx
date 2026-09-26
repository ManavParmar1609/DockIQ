import { ArrowLeft, ArrowUpRight, Check, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';

import { errorMessage } from '../../api/client';
import {
  useActiveOrder,
  useDocks,
  useEscalate,
  useOrder,
  useReportIssue,
  useTaxonomy,
  useUploadPhoto,
} from '../../api/hooks';
import { QueuedOffline } from '../../api/offline';
import { aiResolutionOf, type IssueCreated, type IssueTypeSpec, type OrderDetail } from '../../api/types';
import { PhotoPicker, VoiceButton } from '../../components/Evidence';
import { issueIcon } from '../../components/icons';
import { ProcedureCard, RecurringPatterns, SeverityDerivation } from '../../components/Resolution';
import { SelfResolveForm } from '../../components/SelfResolve';
import { TempInput } from '../../components/TempInput';
import {
  ErrorBlock,
  FieldLabel,
  LoadingBlock,
  MutationError,
  Notice,
  PageHeader,
  Panel,
  QueryBoundary,
} from '../../components/ui';
import { formatTemp } from '../../lib/format';
import { bringIntoView } from '../../lib/motion';
import { rovingKeyDown, rovingTabIndex } from '../../lib/roving';
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

function TypeStep({
  types,
  onPick,
  hasOrder,
}: {
  types: IssueTypeSpec[];
  onPick: (type: IssueTypeSpec) => void;
  hasOrder: boolean;
}) {
  const groups = hasOrder ? GROUPS : GROUPS.filter((group) => group.id !== 'product');
  return (
    <div className="flex flex-col gap-6">
      {!hasOrder && (
        <Notice title="No trailer assigned">
          Product issues need the trailer you are on; safety, equipment and system problems can be reported
          now.
        </Notice>
      )}
      {groups.map((group, groupIndex) => (
        <section
          key={group.id}
          className={`reveal file-${group.id}`}
          style={{ '--i': groupIndex } as CSSProperties}
        >
          <div className="mb-3 flex flex-wrap items-baseline gap-3 border-b border-hairline pb-2">
            <h2 className="serif-title flex items-center gap-2 text-3xl">
              <span className="file-dot" aria-hidden="true" />
              {group.title}
            </h2>
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
                    <span className="medallion">
                      <Icon size={22} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-lg">{type.name}</span>
                      <span className="block text-sm font-normal text-ink-mute">
                        {type.subtypes[0]}
                        {type.subtypes.length > 1 && ` · +${String(type.subtypes.length - 1)} more`}
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
  /** The dock, when there is no order to take it from. */
  dockId: number | null;
  description: string;
  tags: string[];
  temp: string;
  limit: string;
  expected: string;
  actual: string;
  quantity: string;
  photos: Blob[];
}

/** Where it happened, when there is no assignment to say so. Optional: a WMS fault has no dock. */
function DockPicker({ value, onChange }: { value: number | null; onChange: (dock: number | null) => void }) {
  const docks = useDocks();
  return (
    <Panel title="Which dock?">
      <label htmlFor="report-dock" className="sr-only">
        Dock
      </label>
      <select
        id="report-dock"
        className="field text-lg"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
      >
        <option value="">Not at a dock</option>
        {(docks.data ?? []).map((dock) => (
          <option key={dock.id} value={dock.id}>
            Dock {dock.door_number}
          </option>
        ))}
      </select>
      {docks.isError && (
        <p className="mt-2 text-sm text-ink-mute">Docks could not be loaded; it can be filed without one.</p>
      )}
    </Panel>
  );
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
  const subtypeIndex = type.subtypes.findIndex((subtype) => subtype === draft.subtype);
  const products = order?.items ?? [];
  const productIndex = products.findIndex((item) => item.product_id === draft.productId);
  const pickProduct = (item: OrderDetail['items'][number]) =>
    set({
      productId: item.product_id,
      limit: draft.limit || (item.temp_max === null ? '' : String(item.temp_max)),
    });
  const pickSubtype = (subtype: string) => {
    const first = draft.subtype === null;
    set({ subtype });
    // The first pick brings the next question into view; changing your mind does not jump the page.
    if (first) {
      window.setTimeout(() => bringIntoView(document.getElementById('report-rest'), 'start'), 60);
    }
  };
  const missing = !draft.subtype ? 'Pick what exactly happened, above' : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" /> Type
        </button>
        <h2 className="display text-3xl">{type.name}</h2>
      </div>

      <Panel title="What exactly?">
        <div
          className="grid gap-2 sm:grid-cols-2"
          role="radiogroup"
          aria-label="Situation"
          onKeyDown={rovingKeyDown('radio', subtypeIndex, type.subtypes.length, (index) => {
            const subtype = type.subtypes[index];
            if (subtype) pickSubtype(subtype);
          })}
        >
          {type.subtypes.map((subtype, index) => (
            <button
              key={subtype}
              type="button"
              role="radio"
              aria-checked={draft.subtype === subtype}
              tabIndex={rovingTabIndex(index, subtypeIndex)}
              className="choice"
              onClick={() => pickSubtype(subtype)}
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

      <div id="report-rest" className="flex scroll-mt-24 flex-col gap-6">
        {!order && <DockPicker value={draft.dockId} onChange={(dockId) => set({ dockId })} />}

        {isProduct && order && order.items.length > 0 && (
          <Panel title="Which product?">
            <div
              className="grid gap-2 sm:grid-cols-2"
              role="radiogroup"
              aria-label="Product"
              onKeyDown={rovingKeyDown('radio', productIndex, products.length, (index) => {
                const item = products[index];
                if (item) pickProduct(item);
              })}
            >
              {order.items.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={draft.productId === item.product_id}
                  tabIndex={rovingTabIndex(index, productIndex)}
                  className="choice"
                  onClick={() => pickProduct(item)}
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
                <TempInput id="temp" value={draft.temp} onChange={(temp) => set({ temp })} />
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
                <TempInput id="limit" value={draft.limit} onChange={(limit) => set({ limit })} />
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
              onText={(text) =>
                set({
                  description: (draft.description ? `${draft.description} ${text}` : text).slice(0, 2000),
                })
              }
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
            maxLength={2000}
            value={draft.description}
            onChange={(event) => set({ description: event.target.value })}
            placeholder="What you see, where, how much"
          />
        </Panel>

        <Panel title="Photos">
          <PhotoPicker photos={draft.photos} onChange={(photos) => set({ photos })} />
        </Panel>

        <MutationError error={error} />
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="btn btn-primary text-lg"
            disabled={!draft.subtype || pending}
            aria-describedby={missing ? 'report-missing' : undefined}
            onClick={onSubmit}
          >
            {pending ? 'Scoring and finding the procedure…' : 'Submit and get the procedure'}
          </button>
          {missing && (
            <p id="report-missing" className="label text-center">
              {missing}
            </p>
          )}
        </div>
      </div>
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
  const escalate = useEscalate();
  const resolution = aiResolutionOf(created);
  const critical = created.severity === 'critical';

  return (
    <div className="flex flex-col gap-4">
      {critical && (
        <Notice tone="alert" title="Critical: escalated to your supervisor">
          They have been alerted and decide what happens next, so a critical issue cannot be resolved on your
          own. Follow the procedure below while they come to you.
        </Notice>
      )}
      <SeverityDerivation
        severity={created.severity}
        score={created.severity_score}
        reason={created.severity_reason}
        index={0}
      />
      <RecurringPatterns patterns={created.recurring_patterns} />
      {resolution && <ProcedureCard resolution={resolution} fallbackTitle={type.name} index={1} />}
      {photoProblem && (
        <Notice tone="alert" title="Photos not attached">
          {photoProblem}
        </Notice>
      )}

      {created.can_self_resolve ? (
        <Panel title="Resolve it yourself" index={2}>
          <SelfResolveForm
            issueId={created.id}
            issueType={type.name}
            needsNote={created.self_resolve_needs_note === true}
            columns={4}
            disabled={escalate.isPending}
            onResolved={() => onDone('resolved')}
          />
          {created.status === 'resolution_in_progress' && (
            <div className="mt-5 border-t border-hairline pt-5">
              <button
                type="button"
                className="btn btn-hazard w-full text-lg"
                disabled={escalate.isPending}
                onClick={() => escalate.mutate(created.id, { onSuccess: () => onDone('escalated') })}
              >
                <ArrowUpRight size={22} aria-hidden="true" /> No — escalate to my supervisor
              </button>
              <p className="mt-2 text-sm text-ink-mute">
                They get the full context, the procedure you were shown, and your photos.
              </p>
              <div className="mt-3">
                <MutationError error={escalate.error} />
              </div>
            </div>
          )}
        </Panel>
      ) : (
        <Panel title="What happens now" index={2}>
          <p className="text-lg">
            {critical ? <strong>Your supervisor decides — critical. </strong> : null}
            Your supervisor has the full context, the procedure you were shown, and your photos. Keep the
            product where it is until they decide.
          </p>
          <button type="button" className="btn btn-primary mt-4" onClick={() => onDone('escalated')}>
            Done
          </button>
        </Panel>
      )}
    </div>
  );
}

const EMPTY_DRAFT: Draft = {
  subtype: null,
  productId: null,
  dockId: null,
  description: '',
  tags: [],
  temp: '',
  limit: '',
  expected: '',
  actual: '',
  quantity: '',
  photos: [],
};

const DRAFT_KEY = 'dockiq.report.draft';

/** What was typed, kept for this session so leaving the page loses nothing. Photos are not kept. */
function loadStored(): { typeName: string | null; draft: Draft } | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { typeName?: unknown; draft?: Partial<Draft> };
    return {
      typeName: typeof parsed.typeName === 'string' ? parsed.typeName : null,
      draft: { ...EMPTY_DRAFT, ...parsed.draft, photos: [] },
    };
  } catch {
    return null;
  }
}

function storeDraft(typeName: string | null, draft: Draft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ typeName, draft: { ...draft, photos: [] } }));
  } catch {
    /* the draft lasts for this page view only */
  }
}

function clearStoredDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing kept */
  }
}

function toNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function Flow({ order }: { order: OrderDetail | undefined }) {
  const taxonomy = useTaxonomy();
  const [search, setSearch] = useSearchParams();
  const prefill = useMemo(() => readPrefill(search), [search]);
  const report = useReportIssue();
  const upload = useUploadPhoto();
  const [type, setType] = useState<IssueTypeSpec | null>(null);
  // A pre-filled link starts fresh; otherwise the session's unfinished report comes back.
  const [stored] = useState(() => (search.size > 0 ? null : loadStored()));
  const [restoredType, setRestoredType] = useState<string | null>(stored?.typeName ?? null);
  const [draft, setDraft] = useState<Draft>(
    () =>
      stored?.draft ?? {
        ...EMPTY_DRAFT,
        subtype: prefill.subtype ?? null,
        description: prefill.description ?? '',
        temp: prefill.temp === undefined ? '' : String(prefill.temp),
        limit: prefill.limit === undefined ? '' : String(prefill.limit),
        expected: prefill.expected === undefined ? '' : String(prefill.expected),
        actual: prefill.actual === undefined ? '' : String(prefill.actual),
      },
  );
  const [created, setCreated] = useState<IssueCreated | null>(null);
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<'resolved' | 'escalated' | null>(null);
  const typeName = type?.name ?? restoredType;
  useEffect(() => {
    if (created) return;
    if (typeName || draft.subtype || draft.description.trim()) storeDraft(typeName, draft);
  }, [typeName, draft, created]);

  if (taxonomy.isPending) return <LoadingBlock label="Loading issue types" />;
  if (!taxonomy.data)
    return (
      <Notice tone="alert" title="Issue types unavailable">
        {errorMessage(taxonomy.error)}
      </Notice>
    );
  // Without an order, a product type cannot be reported: the link's type is ignored.
  const prefilledType = prefill.type
    ? taxonomy.data.issue_types.find(
        (spec) => spec.name === prefill.type && (order !== undefined || spec.group !== 'product'),
      )
    : undefined;
  const restored = restoredType
    ? taxonomy.data.issue_types.find(
        (spec) => spec.name === restoredType && (order !== undefined || spec.group !== 'product'),
      )
    : undefined;
  const current = type ?? prefilledType ?? restored ?? null;
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
    if (!current) return;
    const product = order?.items.find((item) => item.product_id === draft.productId);
    // The tags ride along in the text; keep the whole within the server's 2000-character limit.
    const tagText = draft.tags.join('. ');
    const room = 2000 - (tagText ? tagText.length + 2 : 0);
    const description = [draft.description.trim().slice(0, room), tagText].filter(Boolean).join('. ');
    report.mutate(
      {
        // People and systems issues need no order (business-rules §8); product ones always have one here.
        order_id: order?.id ?? null,
        dock_door_id: order ? order.dock_door_id : draft.dockId,
        issue_type: current.name,
        issue_subtype: draft.subtype,
        description,
        quick_tags: draft.tags,
        product_id: product?.product_id ?? null,
        company_id: order?.company_id ?? null,
        carrier_id: order?.carrier_id ?? null,
        // Blank = not stated: severity is not scaled by a guess (business-rules §1.9).
        quantity_affected: toNumber(draft.quantity),
        temp_reading: toNumber(draft.temp),
        temp_threshold_max: toNumber(draft.limit),
        count_expected: toNumber(draft.expected),
        count_actual: toNumber(draft.actual),
      },
      {
        onSuccess: (result) => {
          clearStoredDraft();
          setCreated(result);
          void attachPhotos(result.id);
        },
        // Offline: the report is kept on the tablet and sent later (api/offline.ts), its message says so.
        onError: (error) => {
          if (error instanceof QueuedOffline) clearStoredDraft();
        },
      },
    );
  };

  /** Drop the link's pre-fill, so the type picker shows and a fresh report starts from nothing. */
  const clearPrefill = () => {
    if (search.size > 0) setSearch(new URLSearchParams(), { replace: true });
  };

  const restart = () => {
    clearPrefill();
    clearStoredDraft();
    setRestoredType(null);
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
      <StepMotion step={step}>
        {step === 0 && (
          <TypeStep
            types={taxonomy.data.issue_types}
            hasOrder={order !== undefined}
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
              // Back to the types, keeping what was typed; a pre-filled link must not pull straight back.
              clearPrefill();
              setRestoredType(null);
              setType(null);
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
      </StepMotion>
    </div>
  );
}

/** Keys a step's content so it slides in from the side it lies on: forward from the right, back from the left. */
function StepMotion({ step, children }: { step: number; children: React.ReactNode }) {
  const [shown, setShown] = useState({ step, direction: 1 });
  if (shown.step !== step) setShown({ step, direction: step > shown.step ? 1 : -1 });
  return (
    <div key={step} className="tab-swap" style={{ '--dir': shown.direction } as CSSProperties}>
      {children}
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
      ) : active.isError && !active.data ? (
        <ErrorBlock error={active.error} onRetry={() => void active.refetch()} />
      ) : !active.data ? (
        <Flow order={undefined} />
      ) : (
        <QueryBoundary query={order} loading="Loading the order">
          {(detail) => <Flow order={detail} />}
        </QueryBoundary>
      )}
    </div>
  );
}
