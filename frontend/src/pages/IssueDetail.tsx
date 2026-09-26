import { ArrowLeft, ArrowUpRight, Ban, Check, Footprints, PackageCheck, PauseCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';

import {
  useAcknowledge,
  useActiveOrder,
  useDocks,
  useEscalate,
  useIssue,
  useSetDisposition,
  useSupervisorResolve,
  useTaxonomy,
} from '../api/hooks';
import { aiResolutionOf, type Disposition, type Issue, type Role, type Taxonomy } from '../api/types';
import { useUser } from '../auth/AuthProvider';
import { PhotoStrip } from '../components/Evidence';
import { ProcedureCard, RecurringPatterns, SeverityDerivation } from '../components/Resolution';
import { SelfResolveForm } from '../components/SelfResolve';
import { SeverityBadge } from '../components/Severity';
import {
  ChoiceGroup,
  Definition,
  FieldLabel,
  IssueStatusTag,
  MutationError,
  Notice,
  PageHeader,
  Panel,
  QueryBoundary,
  SimulatedTag,
  Tag,
} from '../components/ui';
import { elapsed, formatDateTime, formatMoney, formatNumber, formatTemp } from '../lib/format';
import { DISPOSITION, ISSUE_STATUS } from '../lib/vocab';

/** Filed and escalated in the same moment: a critical, or the simulator, escalated it on filing. */
const SAME_MOMENT_MS = 5_000;

const DISPOSITIONS: readonly { value: Disposition; label: string }[] = [
  { value: 'hold', label: DISPOSITION.hold },
  { value: 'release', label: 'Release' },
  { value: 'destroy', label: 'Destroy' },
  { value: 'return_to_vendor', label: 'Return to vendor' },
];

const FINAL_DISPOSITIONS: ReadonlySet<Disposition> = new Set(['release', 'destroy', 'return_to_vendor']);

function escalatedOnFiling(issue: Issue): boolean {
  if (!issue.escalated_at) return false;
  return Math.abs(Date.parse(issue.escalated_at) - Date.parse(issue.created_at)) < SAME_MOMENT_MS;
}

/** Full Reject and Override always need the reason; accepting product on a critical or cold-chain
 * issue does too (mirrors the API's 422, business-rules §7.2). */
function decisionNeedsNotes(decision: string | null, issue: Issue, taxonomy: Taxonomy | undefined) {
  if (!decision || !taxonomy) return false;
  if (taxonomy.noted_decisions?.includes(decision)) return true;
  if (!taxonomy.accept_decisions?.includes(decision)) return false;
  return issue.severity === 'critical' || (taxonomy.cold_chain_issue_types ?? []).includes(issue.issue_type);
}

// ── The record ──

function Timeline({ issue }: { issue: Issue }) {
  const decidedBy = issue.supervisor_name ? ` · ${issue.supervisor_name}` : '';
  const events: [string, string | null | undefined][] = [
    ['Reported', issue.created_at],
    [escalatedOnFiling(issue) ? 'Escalated on filing' : 'Escalated', issue.escalated_at],
    [`Taken${issue.acknowledged_by_name ? ` · ${issue.acknowledged_by_name}` : ''}`, issue.acknowledged_at],
    [`On hold${issue.pending_action ? ` · ${issue.pending_action}` : ''}`, issue.on_hold_at],
    [
      `Disposition · ${issue.disposition ? DISPOSITION[issue.disposition] : ''}${issue.disposition_by_name ? ` · ${issue.disposition_by_name}` : ''}`,
      issue.disposition_at,
    ],
    [`Resolved${issue.status === 'supervisor_resolved' ? decidedBy : ''}`, issue.resolved_at],
  ];
  const shown = events
    .filter((event): event is [string, string] => Boolean(event[1]))
    .sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <ol className="flex flex-col">
      {shown.map(([label, at]) => (
        <li
          key={label}
          className="flex items-baseline justify-between gap-4 border-b border-hairline py-2 last:border-b-0"
        >
          <span className="font-semibold">{label}</span>
          <span className="telemetry shrink-0 text-sm">{formatDateTime(at)}</span>
        </li>
      ))}
    </ol>
  );
}

/** A link to the order where this viewer can open it: an operator's own active order, or the dock sheet. */
function OrderLink({ issue, role }: { issue: Issue; role: Role }) {
  const active = useActiveOrder();
  const docks = useDocks();
  const label = issue.order_number ?? (issue.order_id == null ? null : `Order #${String(issue.order_id)}`);
  if (!label) return <>—</>;
  if (role === 'operator' && active.data?.id === issue.order_id) {
    return (
      <Link to="/app/order" className="underline">
        {label}
      </Link>
    );
  }
  const door = docks.data?.find(
    (dock) => dock.current_order_id != null && dock.current_order_id === issue.order_id,
  );
  if (role === 'supervisor' && door) {
    return (
      <Link to={`/app?dock=${String(door.door_number)}`} className="underline">
        {label}
      </Link>
    );
  }
  return <>{label}</>;
}

function Reported({ issue, role }: { issue: Issue; role: Role }) {
  const over =
    issue.temp_reading != null && issue.temp_limit != null ? issue.temp_reading - issue.temp_limit : null;
  const held = issue.held_pallets ?? [];
  const rows: [string, ReactNode, boolean][] = [
    ['Dock', issue.door_number ?? '—', true],
    ['Operator', issue.operator_name ?? '—', false],
    ['Customer', issue.company_name ?? '—', false],
    ['Carrier', issue.carrier_name ?? '—', false],
    ['Product', issue.product_name ?? '—', false],
    ['SKU', issue.product_sku ?? '—', true],
  ];
  if (issue.temp_reading != null) {
    rows.push([
      'Reading / limit',
      <>
        {formatTemp(issue.temp_reading)} / {issue.temp_limit == null ? '—' : formatTemp(issue.temp_limit)}
        {over !== null && over > 0 && <span className="block text-sm">{formatTemp(over)} over</span>}
      </>,
      true,
    ]);
  }
  if (issue.quantity_affected != null)
    rows.push(['Quantity', `${formatNumber(issue.quantity_affected)} cases`, true]);
  if (issue.lot) rows.push(['Lot', issue.lot, true]);
  if (issue.room) rows.push(['Room', issue.room, false]);
  if (issue.order_number ?? issue.order_id)
    rows.push(['Order', <OrderLink key="order" issue={issue} role={role} />, true]);
  if (issue.trailer_number) rows.push(['Trailer', issue.trailer_number, true]);
  if (issue.bol_number) rows.push(['BOL', issue.bol_number, true]);
  if (role !== 'operator') rows.push(['Cost impact', formatMoney(issue.estimated_cost_impact), true]);
  rows.push([
    'Reported',
    <>
      {formatDateTime(issue.created_at)}
      {issue.sim_time && (
        <span className="block text-sm">
          Sim {issue.sim_time}
          {issue.sim_shift != null && ` · shift ${String(issue.sim_shift)}`}
        </span>
      )}
    </>,
    true,
  ]);

  return (
    <Panel title="What was reported" index={0}>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {rows.map(([term, value, mono]) => (
          <Definition key={term} term={term} mono={mono}>
            {value}
          </Definition>
        ))}
      </dl>
      {held.length > 0 && <HeldPallets pallets={held} />}
      {issue.description && <p className="mt-4 border-t border-hairline pt-4 text-lg">{issue.description}</p>}
      {issue.quick_tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {issue.quick_tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </div>
      )}
    </Panel>
  );
}

/** The licence plates on hold for this issue; each opens its movements in the Simulator's ledger. */
function HeldPallets({ pallets }: { pallets: string[] }) {
  const user = useUser();
  const canTrace = user.role !== 'operator';
  return (
    <div className="mt-4 border-t border-hairline pt-4">
      <p className="label">Pallets on hold ({pallets.length})</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {pallets.map((lpn) => (
          <li key={lpn}>
            {canTrace ? (
              <Link
                to={`/app/sim?view=ledger&pallet=${encodeURIComponent(lpn)}`}
                className="pill telemetry min-h-11 bg-paper-sunk text-ink underline"
                aria-label={`Pallet ${lpn}: its movements`}
              >
                {lpn}
              </Link>
            ) : (
              <span className="pill telemetry bg-paper-sunk text-ink">{lpn}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── The supervisor ──

/** One tap tells the operator who is coming; the decision can follow at the dock. */
function OnMyWay({ issue }: { issue: Issue }) {
  const acknowledge = useAcknowledge();
  if (issue.acknowledged_at) {
    return (
      <p className="mb-4 flex items-center gap-2 rounded-lg bg-paper-sunk p-3 text-base">
        <Footprints size={20} aria-hidden="true" className="shrink-0" />
        {issue.acknowledged_by_name ?? 'A supervisor'} took this at {formatDateTime(issue.acknowledged_at)}.
        The operator knows.
      </p>
    );
  }
  return (
    <div className="mb-4 flex flex-col gap-2 border-b border-hairline pb-4">
      <button
        type="button"
        className="btn btn-primary text-lg"
        disabled={acknowledge.isPending}
        onClick={() => acknowledge.mutate(issue.id)}
      >
        <Footprints size={22} aria-hidden="true" /> On my way
      </button>
      <p className="text-sm text-ink-mute">
        Tells {issue.operator_name ?? 'the operator'} you are coming
        {issue.door_number == null ? '' : ` to Dock ${String(issue.door_number)}`}.
      </p>
      <MutationError error={acknowledge.error} />
    </div>
  );
}

function SupervisorDecision({ issue }: { issue: Issue }) {
  const taxonomy = useTaxonomy();
  const resolve = useSupervisorResolve();
  const navigate = useNavigate();
  const [decision, setDecision] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const pendingActions = taxonomy.data?.pending_actions ?? {};
  const pending = decision ? pendingActions[decision] : undefined;
  const needsNotes = decisionNeedsNotes(decision, issue, taxonomy.data);
  const missingNotes = needsNotes && !notes.trim();
  const alwaysNoted = decision !== null && (taxonomy.data?.noted_decisions ?? []).includes(decision);
  const suggested = aiResolutionOf(issue)?.suggested_decision ?? null;

  if (resolve.isSuccess && resolve.variables.resolution_type) {
    const onHold = resolve.variables.resolution_type in pendingActions;
    return (
      <Panel title="Decision recorded">
        <p className="flex items-center gap-2 text-lg">
          {onHold ? (
            <PauseCircle size={22} aria-hidden="true" className="shrink-0" />
          ) : (
            <Check size={22} aria-hidden="true" className="shrink-0" />
          )}
          {onHold
            ? `Put on hold — ${(pendingActions[resolve.variables.resolution_type] ?? 'awaiting').toLowerCase()}. It stays in your queue.`
            : `${resolve.variables.resolution_type} — the operator has been notified.`}
        </p>
        <button type="button" className="btn btn-primary mt-4" onClick={() => void navigate('/app')}>
          Back to the floor
        </button>
      </Panel>
    );
  }
  const options = (taxonomy.data?.supervisor_decisions ?? []).map((option) => ({
    value: option,
    label: option === suggested ? `${option} · suggested` : option,
  }));
  return (
    <Panel title="Your decision">
      <OnMyWay issue={issue} />
      {issue.status === 'on_hold' && (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-paper-sunk p-3 text-base">
          <PauseCircle size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            On hold — {(issue.pending_action ?? 'awaiting a decision').toLowerCase()}
            {issue.on_hold_at && ` since ${formatDateTime(issue.on_hold_at)}`}
            {issue.supervisor_name && ` (${issue.supervisor_name})`}. Record the final decision when it comes.
          </span>
        </p>
      )}
      {suggested && (
        <p className="bracket mb-3 text-base text-ink-soft">
          <span>
            Procedure suggests: <span className="hl hl-cream font-semibold">{suggested}</span>. Advice from
            the SOP — the call is yours.
          </span>
        </p>
      )}
      <ChoiceGroup label="Decision" options={options} value={decision} onChange={setDecision} />
      {Object.keys(pendingActions).length > 0 && (
        <p className="mt-2 text-sm text-ink-mute">
          {Object.keys(pendingActions).join(' and ')} put the issue on hold: it stays open until you decide.
        </p>
      )}
      <div className="mt-4">
        <FieldLabel
          htmlFor="supervisor-notes"
          hint={needsNotes ? (alwaysNoted ? 'Required: your reason' : 'Required: why accept it') : undefined}
        >
          Notes for the record
        </FieldLabel>
        <textarea
          id="supervisor-notes"
          rows={3}
          maxLength={2000}
          required={needsNotes}
          aria-invalid={missingNotes}
          className="field"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        {needsNotes && (
          <p className="mt-1 text-sm text-ink-mute">
            {alwaysNoted
              ? `${decision} is always recorded with your reason.`
              : `Accepting product on a ${issue.severity === 'critical' ? 'critical' : 'temperature'} issue is recorded with your reason.`}
          </p>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <MutationError error={resolve.error} />
        {decision && missingNotes && (
          <p className="text-sm text-ink-soft" id="decision-blocked">
            Write your reason in the notes to record {decision}.
          </p>
        )}
        <button
          type="button"
          className="btn btn-primary text-lg"
          aria-describedby={decision && missingNotes ? 'decision-blocked' : undefined}
          disabled={!decision || missingNotes || resolve.isPending}
          onClick={() =>
            decision &&
            resolve.mutate({ id: issue.id, resolution_type: decision, supervisor_notes: notes.trim() })
          }
        >
          {resolve.isPending
            ? 'Recording…'
            : pending
              ? `Put on hold — ${pending.toLowerCase()}`
              : decision
                ? `Record: ${decision}`
                : 'Choose a decision'}
        </button>
      </div>
    </Panel>
  );
}

// ── Quality ──

function DispositionRecord({ issue }: { issue: Issue }) {
  if (!issue.disposition) return <p className="text-base text-ink-mute">No disposition yet.</p>;
  return (
    <div className="flex flex-col gap-1">
      <p className="heading text-xl">{DISPOSITION[issue.disposition]}</p>
      <p className="label">
        {issue.disposition_by_name ?? 'Quality'}
        {issue.disposition_at && ` · ${formatDateTime(issue.disposition_at)}`}
      </p>
      {issue.disposition_notes && <p className="mt-1 text-base">{issue.disposition_notes}</p>}
    </div>
  );
}

/** Quality decides what happens to the held product; supervisors read it (business-rules §7.3). */
function DispositionPanel({ issue, role }: { issue: Issue; role: Role }) {
  const set = useSetDisposition();
  const [choice, setChoice] = useState<Disposition | null>(null);
  const [notes, setNotes] = useState('');
  const final = issue.disposition != null && FINAL_DISPOSITIONS.has(issue.disposition);
  const held = issue.held_pallets ?? [];
  const canDecide = role === 'quality' && !final;

  if (role === 'operator') return null;
  if (role === 'supervisor' && !issue.disposition && held.length === 0) return null;

  return (
    <Panel
      title="Product disposition"
      aside={held.length > 0 ? <span className="label telemetry">{held.length} held</span> : undefined}
    >
      <DispositionRecord issue={issue} />
      {role === 'supervisor' && (
        <p className="mt-3 text-sm text-ink-mute">Quality decides the disposition.</p>
      )}
      {final && role === 'quality' && (
        <p className="mt-3 text-sm text-ink-mute">This disposition is final.</p>
      )}
      {canDecide && (
        <form
          className="mt-4 flex flex-col gap-4 border-t border-hairline pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!choice || !notes.trim()) return;
            set.mutate(
              { id: issue.id, disposition: choice, notes: notes.trim() },
              {
                onSuccess: () => {
                  setChoice(null);
                  setNotes('');
                },
              },
            );
          }}
        >
          <ChoiceGroup label="Decide" options={DISPOSITIONS} value={choice} onChange={setChoice} />
          <div>
            <FieldLabel htmlFor="disposition-notes" hint="Required">
              Notes for the record
            </FieldLabel>
            <textarea
              id="disposition-notes"
              rows={3}
              maxLength={2000}
              required
              className="field"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          {choice && FINAL_DISPOSITIONS.has(choice) && (
            <p className="text-sm text-ink-mute">
              {choice === 'release' ? 'Released' : choice === 'destroy' ? 'Destroyed' : 'Returned'} is final:
              it cannot be changed afterwards.
            </p>
          )}
          <MutationError error={set.error} />
          <button
            type="submit"
            className={`btn ${choice === 'destroy' ? 'btn-hazard' : 'btn-primary'}`}
            disabled={!choice || !notes.trim() || set.isPending}
          >
            {set.isPending ? 'Recording…' : 'Record disposition'}
          </button>
        </form>
      )}
    </Panel>
  );
}

// ── The operator ──

function OperatorActions({ issue }: { issue: Issue }) {
  const escalate = useEscalate();
  return (
    <Panel title="Resolve it yourself">
      {issue.severity === 'critical' ? (
        <p className="text-lg">
          <strong>Your supervisor decides — critical.</strong> Critical issues cannot be resolved on your own;
          your supervisor has been alerted and has your report.
        </p>
      ) : issue.can_self_resolve ? (
        <SelfResolveForm
          issueId={issue.id}
          issueType={issue.issue_type}
          needsNote={issue.self_resolve_needs_note === true}
          disabled={escalate.isPending}
        />
      ) : null}
      {issue.status === 'resolution_in_progress' && (
        <div className="mt-5 border-t border-hairline pt-5">
          <button
            type="button"
            className="btn btn-hazard w-full text-lg"
            disabled={escalate.isPending}
            onClick={() => escalate.mutate(issue.id)}
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
  );
}

// ── The outcome ──

function Outcome({ issue }: { issue: Issue }) {
  const rejected = issue.resolution_type === 'Full Reject';
  return (
    <Panel title="Outcome">
      <p className="heading flex items-center gap-2 text-xl">
        {rejected ? <Ban size={22} aria-hidden="true" /> : <PackageCheck size={22} aria-hidden="true" />}
        {issue.resolution_type ?? '—'}
      </p>
      {issue.status === 'supervisor_resolved'
        ? issue.supervisor_name && <p className="label mt-1">Decided by {issue.supervisor_name}</p>
        : issue.operator_name && <p className="label mt-1">By {issue.operator_name}</p>}
      {(issue.supervisor_notes ?? issue.resolution_notes) && (
        <p className="mt-3 text-base">{issue.supervisor_notes ?? issue.resolution_notes}</p>
      )}
      {rejected && (
        <div className="mt-4">
          <Notice title={`Order blocked: rejected by ${issue.supervisor_name ?? 'the supervisor'}`}>
            {issue.order_number ?? 'The load'} cannot be signed off
            {issue.door_number == null ? '' : `, and Dock ${String(issue.door_number)} is flagged`}.
          </Notice>
        </div>
      )}
    </Panel>
  );
}

function BackButton({ fallback }: { fallback: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  // A first page load has no history to go back to ("default"): go to the list instead.
  const hasHistory = location.key !== 'default';
  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={() => void (hasHistory ? navigate(-1) : navigate(fallback))}
    >
      <ArrowLeft size={18} aria-hidden="true" /> Back
    </button>
  );
}

function procedureNote(issue: Issue): string | undefined {
  if (!issue.escalated_at) return undefined;
  return escalatedOnFiling(issue)
    ? 'Shown to the operator on filing.'
    : 'The operator was shown this procedure before escalating.';
}

function Detail({ issue }: { issue: Issue }) {
  const user = useUser();
  const open = ISSUE_STATUS[issue.status].open;
  const resolution = aiResolutionOf(issue);
  const since = issue.escalated_at ?? issue.created_at;
  const canDecide = user.role === 'supervisor' && open;
  // The reporter's own open issue, unless a supervisor's decision is pending on it (business-rules §7.5).
  const canClose =
    user.role === 'operator' && open && issue.operator_id === user.id && issue.status !== 'on_hold';
  const critical = issue.severity === 'critical';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        kicker={`Issue #${String(issue.id)} · ${issue.issue_type}`}
        title={issue.issue_subtype ?? issue.issue_type}
        size="md"
        actions={<BackButton fallback={user.role === 'operator' ? '/app/issues' : '/app'} />}
        meta={
          <>
            <SeverityBadge severity={issue.severity} />
            <IssueStatusTag status={issue.status} />
            {issue.simulated && <SimulatedTag compact />}
            {open && <Tag>Open {elapsed(since)}</Tag>}
          </>
        }
      />

      {user.role === 'supervisor' &&
        open &&
        critical &&
        issue.status !== 'on_hold' &&
        !issue.acknowledged_at && (
          <Notice
            tone="alert"
            title={`Critical at Dock ${issue.door_number == null ? '—' : String(issue.door_number)}`}
          >
            Go to the dock. {issue.operator_name ?? 'The operator'} has the procedure below.
          </Notice>
        )}
      {user.role === 'quality' && open && critical && (
        <Notice tone="alert" title="For your review">
          A critical issue{issue.door_number == null ? '' : ` at Dock ${String(issue.door_number)}`}. Its
          supervisor decides the issue; you decide the product.
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Reported issue={issue} role={user.role} />

          <SeverityDerivation
            severity={issue.severity}
            score={issue.severity_score}
            reason={issue.severity_reason}
            cost={user.role === 'operator' ? undefined : issue.estimated_cost_impact}
            index={1}
          />
          <RecurringPatterns patterns={issue.recurring_patterns} />
          {resolution && (
            <ProcedureCard
              resolution={resolution}
              fallbackTitle={issue.issue_type}
              index={2}
              note={user.role === 'operator' ? undefined : procedureNote(issue)}
            />
          )}

          <Panel title={`Photos (${String(issue.photo_count)})`} index={3}>
            <PhotoStrip issueId={issue.id} count={issue.photo_count} />
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          {user.role === 'operator' && open && issue.status === 'on_hold' && (
            <Notice title="On hold">
              {issue.supervisor_name ?? 'Your supervisor'} decided: {issue.resolution_type ?? 'wait'}.{' '}
              {issue.pending_action ?? 'Awaiting the next step'} — keep the product where it is.
            </Notice>
          )}
          {user.role === 'operator' && open && issue.status !== 'on_hold' && issue.acknowledged_at && (
            <Notice title={`${issue.acknowledged_by_name ?? 'Your supervisor'} is on the way`}>
              Took your issue at {formatDateTime(issue.acknowledged_at)}. Keep the product where it is.
            </Notice>
          )}
          {canDecide && <SupervisorDecision issue={issue} />}
          {canClose && <OperatorActions issue={issue} />}
          {!open && <Outcome issue={issue} />}
          <DispositionPanel issue={issue} role={user.role} />
          <Panel title="Timeline">
            <Timeline issue={issue} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

export default function IssueDetail() {
  const { issueId } = useParams();
  const issue = useIssue(Number(issueId));
  return (
    <QueryBoundary query={issue} loading="Loading the issue">
      {(data) => <Detail issue={data} />}
    </QueryBoundary>
  );
}
