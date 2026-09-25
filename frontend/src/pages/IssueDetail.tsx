import { ArrowLeft, ArrowUpRight, Check, Footprints } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import {
  useAcknowledge,
  useEscalate,
  useIssue,
  useSelfResolve,
  useSupervisorResolve,
  useTaxonomy,
} from '../api/hooks';
import { aiResolutionOf, type Issue } from '../api/types';
import { useUser } from '../auth/AuthProvider';
import { PhotoStrip } from '../components/Evidence';
import { ProcedureCard, RecurringPatterns, SeverityDerivation } from '../components/Resolution';
import { SeverityBadge } from '../components/Severity';
import {
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
import { elapsed, formatDateTime, formatMoney } from '../lib/format';
import { ISSUE_STATUS } from '../lib/vocab';

function Timeline({ issue }: { issue: Issue }) {
  const events = [
    ['Reported', issue.created_at],
    ['Escalated', issue.escalated_at],
    ['Acknowledged', issue.acknowledged_at],
    ['Resolved', issue.resolved_at],
  ].filter((event): event is [string, string] => Boolean(event[1]));
  return (
    <ol className="flex flex-col">
      {events.map(([label, at]) => (
        <li
          key={label}
          className="flex items-baseline justify-between gap-4 border-b border-hairline py-2 last:border-b-0"
        >
          <span className="font-semibold">{label}</span>
          <span className="telemetry text-sm">{formatDateTime(at)}</span>
        </li>
      ))}
    </ol>
  );
}

/** One tap tells the operator who is coming; the decision can follow at the dock. */
function OnMyWay({ issue }: { issue: Issue }) {
  const acknowledge = useAcknowledge();
  if (issue.acknowledged_at) {
    return (
      <p className="mb-4 flex items-center gap-2 rounded-lg bg-paper-sunk p-3 text-base">
        <Footprints size={20} aria-hidden="true" />
        {issue.supervisor_name ?? 'You'} took this at {formatDateTime(issue.acknowledged_at)}. The operator
        knows.
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
        <Footprints size={22} aria-hidden="true" /> On my way to dock {issue.door_number ?? '—'}
      </button>
      <p className="text-sm text-ink-mute">Tells {issue.operator_name ?? 'the operator'} you are coming.</p>
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

  if (resolve.isSuccess) {
    return (
      <Panel title="Decision recorded">
        <p className="flex items-center gap-2 text-lg">
          <Check size={22} aria-hidden="true" /> {decision} — the operator has been notified.
        </p>
        <button type="button" className="btn btn-primary mt-4" onClick={() => void navigate('/app')}>
          Back to the floor
        </button>
      </Panel>
    );
  }
  return (
    <Panel title="Your decision">
      <OnMyWay issue={issue} />
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Decision">
        {(taxonomy.data?.supervisor_decisions ?? []).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={decision === option}
            className="choice"
            onClick={() => setDecision(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="mt-4">
        <FieldLabel htmlFor="supervisor-notes">Notes for the record</FieldLabel>
        <textarea
          id="supervisor-notes"
          rows={3}
          maxLength={2000}
          className="field"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <MutationError error={resolve.error} />
        <button
          type="button"
          className="btn btn-primary text-lg"
          disabled={!decision || resolve.isPending}
          onClick={() =>
            decision && resolve.mutate({ id: issue.id, resolution_type: decision, supervisor_notes: notes })
          }
        >
          {resolve.isPending ? 'Recording…' : 'Resolve issue'}
        </button>
      </div>
    </Panel>
  );
}

function OperatorActions({ issue }: { issue: Issue }) {
  const taxonomy = useTaxonomy();
  const selfResolve = useSelfResolve();
  const escalate = useEscalate();
  return (
    <Panel title="Resolve it yourself">
      {issue.severity === 'critical' ? (
        <p className="text-lg">
          <strong>Critical: your supervisor decides.</strong> Critical issues cannot be resolved on your own;
          your supervisor has been alerted and has your report.
        </p>
      ) : (
        <>
          <p className="mb-3 text-base">Fixed it? Tap what you did and the issue is closed.</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {(taxonomy.data?.operator_resolutions ?? []).map((option) => (
              <button
                key={option}
                type="button"
                className="choice justify-center"
                disabled={selfResolve.isPending}
                onClick={() =>
                  selfResolve.mutate({
                    id: issue.id,
                    resolution_type: option,
                    resolution_notes: 'Resolved by operator',
                  })
                }
              >
                {option}
              </button>
            ))}
          </div>
        </>
      )}
      {issue.status === 'resolution_in_progress' && (
        <button
          type="button"
          className="btn btn-hazard mt-4 w-full"
          disabled={escalate.isPending}
          onClick={() => escalate.mutate(issue.id)}
        >
          <ArrowUpRight size={20} aria-hidden="true" /> Escalate to supervisor
        </button>
      )}
      <div className="mt-3 flex flex-col gap-2">
        <MutationError error={selfResolve.error} />
        <MutationError error={escalate.error} />
      </div>
    </Panel>
  );
}

function Detail({ issue }: { issue: Issue }) {
  const user = useUser();
  const open = ISSUE_STATUS[issue.status].open;
  const resolution = aiResolutionOf(issue);
  const since = issue.escalated_at ?? issue.created_at;
  const canDecide = user.role === 'supervisor' && open;
  const canClose =
    user.role === 'operator' &&
    open &&
    issue.operator_id === user.id &&
    issue.status === 'resolution_in_progress';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        kicker={`Issue #${issue.id} · ${issue.issue_type}`}
        title={issue.issue_subtype ?? issue.issue_type}
        size="md"
        actions={
          <Link to={user.role === 'operator' ? '/app/issues' : '/app'} className="btn btn-secondary">
            <ArrowLeft size={18} aria-hidden="true" /> Back
          </Link>
        }
        meta={
          <>
            <SeverityBadge severity={issue.severity} />
            <IssueStatusTag status={issue.status} />
            {issue.simulated && <SimulatedTag compact />}
            {open && <Tag>Open {elapsed(since)}</Tag>}
          </>
        }
      />

      {issue.status === 'escalated' && issue.severity === 'critical' && (
        <Notice tone="alert" title={`Critical at Dock ${issue.door_number ?? '—'}`}>
          Go to the dock. {issue.operator_name} has been following the procedure below.
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Panel title="What was reported" index={0}>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Definition term="Dock" mono>
                {issue.door_number ?? '—'}
              </Definition>
              <Definition term="Operator">{issue.operator_name ?? '—'}</Definition>
              <Definition term="Customer">{issue.company_name ?? '—'}</Definition>
              <Definition term="Carrier">{issue.carrier_name ?? '—'}</Definition>
              <Definition term="Product">{issue.product_name ?? '—'}</Definition>
              <Definition term="SKU" mono>
                {issue.product_sku ?? '—'}
              </Definition>
              {user.role !== 'operator' && (
                <Definition term="Cost impact" mono>
                  {formatMoney(issue.estimated_cost_impact)}
                </Definition>
              )}
              <Definition term="Reported" mono>
                {formatDateTime(issue.created_at)}
              </Definition>
            </dl>
            {issue.description && (
              <p className="mt-4 border-t border-hairline pt-4 text-lg">{issue.description}</p>
            )}
            {issue.quick_tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {issue.quick_tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </div>
            )}
          </Panel>

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
              note={
                issue.status === 'escalated'
                  ? 'The operator was shown this procedure before escalating.'
                  : undefined
              }
            />
          )}

          <Panel title={`Photos (${issue.photo_count})`} index={3}>
            <PhotoStrip issueId={issue.id} count={issue.photo_count} />
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          {user.role === 'operator' && open && issue.acknowledged_at && (
            <Notice title={`${issue.supervisor_name ?? 'Your supervisor'} is on the way`}>
              Took your issue at {formatDateTime(issue.acknowledged_at)}. Keep the product where it is.
            </Notice>
          )}
          {canDecide && <SupervisorDecision issue={issue} />}
          {canClose && <OperatorActions issue={issue} />}
          {!open && (
            <Panel title="Outcome">
              <p className="heading text-xl">{issue.resolution_type ?? '—'}</p>
              {/* supervisor_name is also set by an acknowledgement, so it names the resolver only here. */}
              {issue.status === 'supervisor_resolved'
                ? issue.supervisor_name && <p className="label mt-1">By {issue.supervisor_name}</p>
                : issue.operator_name && <p className="label mt-1">By {issue.operator_name}</p>}
              {(issue.supervisor_notes ?? issue.resolution_notes) && (
                <p className="mt-3 text-base">{issue.supervisor_notes ?? issue.resolution_notes}</p>
              )}
            </Panel>
          )}
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
