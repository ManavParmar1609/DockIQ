/**
 * What the assistant found and drafted, rendered as data. Every figure here comes from a tool (a
 * deterministic rule or the database), never from model text. Drafts are dashed and say "not filed"
 * until a person presses the button — the assistant itself cannot file or send anything.
 */
import { ArrowRight, BookOpen, Check, Megaphone, Thermometer, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import type {
  AgentAction,
  AgentCard,
  BroadcastDraft,
  HandoffDraft,
  IssueDraft,
  SelfResolveDraft,
} from '../api/assistant';
import { useReportIssue, useSelfResolve, useSendBroadcast, useTaxonomy } from '../api/hooks';
import { duration, formatDate, formatTemp } from '../lib/format';
import { parseSeverityReason } from '../lib/vocab';
import { PalletList } from './PalletList';
import { ConfidenceMeter, SeverityBadge } from './Severity';
import { FieldLabel, MutationError, SimulatedTag, Tag } from './ui';

function CardFrame({
  kicker,
  title,
  children,
  draft = false,
}: {
  kicker: string;
  title?: string;
  children: React.ReactNode;
  draft?: boolean;
}) {
  return (
    <section className={`card overflow-hidden ${draft ? 'ring-2 ring-accent' : ''}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
        <p className={`font-caption text-sm font-semibold ${draft ? 'text-accent-ink' : 'text-ink-soft'}`}>
          {kicker}
        </p>
        {title && <p className="telemetry text-sm text-ink-mute">{title}</p>}
      </header>
      <div className="px-5 pt-2 pb-5">{children}</div>
    </section>
  );
}

// ── Cards ──

const TEMPERATURE_LABEL: Record<string, string> = {
  ok: 'Within limit',
  marginal: 'Marginal',
  warning: 'Warning',
  critical: 'Critical',
  not_applicable: 'No limit on this load',
};

function TemperatureView({ card }: { card: Extract<AgentCard, { kind: 'temperature' }> }) {
  const critical = card.status === 'critical';
  const tone = critical ? 'hazard' : card.status === 'warning' ? 'ink' : 'plain';
  return (
    <CardFrame kicker="Temperature check" title={card.order_number ?? undefined}>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <p className="telemetry text-4xl leading-none">{formatTemp(card.reading)}</p>
        {card.limit != null && (
          <p className="telemetry text-lg text-ink-soft">
            limit {formatTemp(card.limit)}
            {card.delta != null && card.delta > 0 && ` · ${card.delta.toFixed(1)}° over`}
          </p>
        )}
        <Tag tone={tone}>
          <Thermometer size={16} aria-hidden="true" className="mr-1" />
          {TEMPERATURE_LABEL[card.status] ?? card.status}
        </Tag>
      </div>
      <p className={`mt-3 text-lg font-bold ${critical ? 'text-hazard-deep' : ''}`}>{card.guidance}</p>
    </CardFrame>
  );
}

function OrderView({ card }: { card: Extract<AgentCard, { kind: 'order' }> }) {
  return (
    <CardFrame
      kicker={`${card.type === 'outbound' ? 'Loading' : 'Receiving'} · door ${card.door ?? '—'}`}
      title={card.order_number}
    >
      <p className="mb-3 flex flex-wrap items-center gap-2 font-bold">
        {card.customer}
        {card.simulated && <SimulatedTag compact />}
      </p>
      <ul className="flex flex-col gap-2">
        {card.lines.map((line) => {
          const share = line.expected ? Math.min(100, Math.round((line.counted / line.expected) * 100)) : 0;
          return (
            <li key={line.sku}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">{line.name}</span>
                <span className="telemetry shrink-0">
                  {line.counted}/{line.expected}
                </span>
              </div>
              <div className="meter mt-1.5" aria-hidden="true">
                <div className="meter-fill" style={{ width: `${share}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <Link to="/app/order" className="btn btn-secondary mt-4">
        Open the order <ArrowRight size={18} aria-hidden="true" />
      </Link>
    </CardFrame>
  );
}

function StockView({ card }: { card: Extract<AgentCard, { kind: 'stock' }> }) {
  return (
    <CardFrame kicker="Stored at · from the WMS" title={card.sku}>
      {card.product_name && <p className="mb-3 font-bold">{card.product_name}</p>}
      {!card.wms_online ? (
        <p className="text-base">WMS offline. Pick from the paper pick list.</p>
      ) : card.pallets.length === 0 ? (
        <p className="text-base">No stock on hand.</p>
      ) : (
        <PalletList pallets={card.pallets} />
      )}
    </CardFrame>
  );
}

function ProcedureView({ card }: { card: Extract<AgentCard, { kind: 'procedure' }> }) {
  return (
    <CardFrame kicker="Procedure">
      <p className="heading mb-3 text-lg">{card.title}</p>
      <ol className="flex flex-col gap-2">
        {card.steps.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span className="telemetry w-6 shrink-0 text-lg">{index + 1}</span>
            <span className="text-base">{step}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <BookOpen size={16} aria-hidden="true" />
          {card.source}
        </span>
        <ConfidenceMeter confidence={card.confidence} />
      </div>
    </CardFrame>
  );
}

function IssuesView({ card }: { card: Extract<AgentCard, { kind: 'issues' }> }) {
  return (
    <CardFrame kicker={card.title}>
      {card.issues.length === 0 ? (
        <p className="text-base">None.</p>
      ) : (
        <ul className="flex flex-col">
          {card.issues.map((issue) => (
            <li key={issue.id} className="border-b border-hairline last:border-b-0">
              <Link to={`/app/issues/${issue.id}`} className="flex flex-wrap items-center gap-3 py-2">
                <SeverityBadge severity={issue.severity} size="sm" />
                <span className="min-w-0 flex-1 font-bold">{issue.title}</span>
                <span className="telemetry text-sm text-ink-mute">
                  #{issue.id} · dock {issue.door ?? '—'} · {duration(issue.minutes_open)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CardFrame>
  );
}

function RoomsView({ card }: { card: Extract<AgentCard, { kind: 'rooms' }> }) {
  return (
    <CardFrame kicker="Cold rooms · from the WMS">
      {card.simulated && (
        <p className="mb-3">
          <SimulatedTag />
        </p>
      )}
      {!card.wms_online ? (
        <p className="text-base">WMS offline. Read the room displays directly.</p>
      ) : (
        <ul className="flex flex-col">
          {card.rooms.map((room) => (
            <li
              key={room.code}
              className="flex flex-wrap items-center gap-3 border-b border-hairline py-2 last:border-b-0"
            >
              <span className="min-w-0 flex-1 font-bold">{room.name}</span>
              <span className="telemetry text-lg">{formatTemp(room.temp)}</span>
              <span className="telemetry text-sm text-ink-mute">limit {formatTemp(room.limit)}</span>
              <Tag tone={room.alarm ? 'hazard' : room.over_limit ? 'ink' : 'plain'}>
                <Thermometer size={16} aria-hidden="true" className="mr-1" />
                {room.alarm ? 'Alarm' : room.over_limit ? 'Over limit' : 'Within limit'}
              </Tag>
            </li>
          ))}
        </ul>
      )}
    </CardFrame>
  );
}

function TraceView({ card }: { card: Extract<AgentCard, { kind: 'trace' }> }) {
  return (
    <CardFrame kicker="Lot trace · from the WMS" title={card.sku}>
      <p className="mb-3 flex flex-wrap items-center gap-2 font-bold">
        {card.product_name}
        <span className="telemetry text-sm text-ink-mute">{card.lot ? `lot ${card.lot}` : 'all lots'}</span>
        {card.simulated && <SimulatedTag compact />}
      </p>
      {!card.wms_online ? (
        <p className="text-base">WMS offline. Trace from the paper receiving log.</p>
      ) : (
        <>
          <p className="label mb-1">On hand</p>
          {card.on_hand.length === 0 ? (
            <p className="text-base">None on hand.</p>
          ) : (
            <ul className="flex flex-col">
              {card.on_hand.map((pallet) => (
                <li key={pallet.pallet_id} className="border-b border-hairline py-2 last:border-b-0">
                  <span className="telemetry text-lg">{pallet.location}</span>
                  <p className="telemetry text-sm text-ink-mute">
                    {pallet.pallet_id} · {pallet.cases} cs · lot {pallet.lot} · best before{' '}
                    {formatDate(pallet.best_before)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {card.movements.length > 0 && (
            <div className="mt-3 border-t border-hairline pt-3">
              <p className="label mb-1">Latest movements</p>
              <ul className="flex flex-col gap-1">
                {card.movements.map((move) => (
                  <li key={`${move.time}-${move.kind}-${move.pallet_id}`} className="telemetry text-sm">
                    {move.time} · {move.kind} · {move.cases} cs · {move.from_location ?? '—'} →{' '}
                    {move.to_location ?? '—'}
                    {move.order_number && ` · ${move.order_number}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </CardFrame>
  );
}

export function AgentCardView({ card }: { card: AgentCard }) {
  switch (card.kind) {
    case 'temperature':
      return <TemperatureView card={card} />;
    case 'order':
      return <OrderView card={card} />;
    case 'stock':
      return <StockView card={card} />;
    case 'procedure':
      return <ProcedureView card={card} />;
    case 'issues':
      return <IssuesView card={card} />;
    case 'rooms':
      return <RoomsView card={card} />;
    case 'trace':
      return <TraceView card={card} />;
  }
}

// ── Drafts: a person confirms ──

function Discarded({ what }: { what: string }) {
  return (
    <p className="rounded-xl border border-dashed border-hairline p-3 text-base text-ink-mute">
      {what} discarded.
    </p>
  );
}

function IssueDraftView({ draft }: { draft: IssueDraft }) {
  const file = useReportIssue();
  const [discarded, setDiscarded] = useState(false);
  const { summary, factors } = parseSeverityReason(draft.severity_reason);
  if (discarded) return <Discarded what="Draft report" />;
  const filed = file.data;
  return (
    <CardFrame kicker={filed ? 'Report filed' : 'Draft report · not filed yet'} draft={!filed}>
      <div className="flex flex-wrap items-center gap-3">
        <SeverityBadge severity={filed?.severity ?? draft.severity} />
        <p className="heading text-lg">{draft.payload.issue_subtype ?? draft.payload.issue_type}</p>
      </div>
      {draft.payload.description && <p className="mt-2 text-base">{draft.payload.description}</p>}
      <dl className="telemetry mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {draft.payload.quantity_affected != null && <div>{draft.payload.quantity_affected} cases</div>}
        {draft.payload.temp_reading != null && <div>{formatTemp(draft.payload.temp_reading)}</div>}
        {draft.payload.count_actual != null && draft.payload.count_expected != null && (
          <div>
            {draft.payload.count_actual}/{draft.payload.count_expected} counted
          </div>
        )}
        <div>score {draft.severity_score}</div>
      </dl>
      <details className="mt-3">
        <summary className="label cursor-pointer">Why {draft.severity}</summary>
        <p className="mt-2 text-sm">{summary}</p>
        <ul className="mt-1 list-inside list-disc text-sm">
          {factors.map((factor) => (
            <li key={factor}>{factor}</li>
          ))}
        </ul>
      </details>
      {draft.steps.length > 0 && (
        <div className="mt-3 border-t border-hairline pt-3">
          <p className="label mb-1">First steps · {draft.source}</p>
          <ol className="list-inside list-decimal text-base">
            {draft.steps.slice(0, 3).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {filed ? (
          <Link to={`/app/issues/${filed.id}`} className="btn btn-primary">
            <Check size={20} aria-hidden="true" /> Filed as #{filed.id}: open it
          </Link>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary"
              disabled={file.isPending}
              onClick={() => file.mutate(draft.payload)}
            >
              <Check size={20} aria-hidden="true" /> File report
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setDiscarded(true)}>
              <X size={20} aria-hidden="true" /> Discard
            </button>
          </>
        )}
      </div>
      <div className="mt-2">
        <MutationError error={file.error} />
      </div>
    </CardFrame>
  );
}

function BroadcastDraftView({ draft }: { draft: BroadcastDraft }) {
  const send = useSendBroadcast();
  const [discarded, setDiscarded] = useState(false);
  if (discarded) return <Discarded what="Broadcast" />;
  return (
    <CardFrame
      kicker={send.isSuccess ? 'Sent to your team' : 'Draft broadcast · not sent yet'}
      draft={!send.isSuccess}
    >
      <p className="flex items-start gap-3 text-lg font-semibold">
        <Megaphone size={22} aria-hidden="true" className="mt-1 shrink-0" />
        {draft.message}
      </p>
      {!send.isSuccess && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={send.isPending}
            onClick={() => send.mutate(draft.message)}
          >
            <Megaphone size={20} aria-hidden="true" /> Send to the team
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setDiscarded(true)}>
            <X size={20} aria-hidden="true" /> Discard
          </button>
        </div>
      )}
      <div className="mt-2">
        <MutationError error={send.error} />
      </div>
    </CardFrame>
  );
}

function HandoffDraftView({ draft }: { draft: HandoffDraft }) {
  const navigate = useNavigate();
  return (
    <CardFrame kicker="Draft handoff · not saved yet" draft>
      <p className="whitespace-pre-wrap text-base">{draft.notes}</p>
      <button
        type="button"
        className="btn btn-primary mt-4"
        onClick={() => void navigate('/app/handoff', { state: { handoffNotes: draft.notes } })}
      >
        Edit and submit in Handoff <ArrowRight size={18} aria-hidden="true" />
      </button>
    </CardFrame>
  );
}

function SelfResolveDraftView({ draft }: { draft: SelfResolveDraft }) {
  const taxonomy = useTaxonomy();
  const resolve = useSelfResolve();
  const [choice, setChoice] = useState<string | null>(draft.resolution_type);
  // Escalated: the worker writes the note themselves before confirming (business-rules §7.5).
  const noteRequired = draft.note_required === true;
  const [note, setNote] = useState(draft.resolution_notes);
  const [discarded, setDiscarded] = useState(false);
  if (discarded) return <Discarded what="Draft resolution" />;
  const resolved = resolve.isSuccess;
  const noteId = `self-resolve-note-${String(draft.issue_id)}`;
  return (
    <CardFrame
      kicker={resolved ? 'Issue resolved' : 'Draft resolution · not resolved yet'}
      title={`#${String(draft.issue_id)}`}
      draft={!resolved}
    >
      <div className="flex flex-wrap items-center gap-3">
        <SeverityBadge severity={draft.severity} />
        <p className="heading text-lg">{draft.title}</p>
      </div>
      {!noteRequired && draft.resolution_notes && <p className="mt-2 text-base">{draft.resolution_notes}</p>}
      {resolved ? (
        <Link to={`/app/issues/${String(draft.issue_id)}`} className="btn btn-primary mt-4">
          <Check size={20} aria-hidden="true" /> Resolved as {choice}: open it
        </Link>
      ) : (
        <>
          <p className="label mt-3 mb-1">What you did</p>
          <div className="grid gap-2 sm:grid-cols-2" aria-label="Resolution">
            {(taxonomy.data?.operator_resolutions ?? []).map((option) => (
              <button
                key={option}
                type="button"
                className="choice justify-center"
                aria-pressed={choice === option}
                disabled={resolve.isPending}
                onClick={() => setChoice(option)}
              >
                {option}
              </button>
            ))}
          </div>
          {noteRequired && (
            <div className="mt-4">
              <FieldLabel htmlFor={noteId} hint="Required: the issue is with your supervisor">
                Note for the record
              </FieldLabel>
              <textarea
                id={noteId}
                rows={2}
                className="field text-lg"
                maxLength={2000}
                required
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="What you did, what you saw"
              />
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={choice === null || (noteRequired && !note.trim()) || resolve.isPending}
              onClick={() => {
                if (choice !== null) {
                  resolve.mutate({
                    id: draft.issue_id,
                    resolution_type: choice,
                    resolution_notes: noteRequired ? note.trim() : draft.resolution_notes,
                  });
                }
              }}
            >
              <Check size={20} aria-hidden="true" /> Resolve issue #{draft.issue_id}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setDiscarded(true)}>
              <X size={20} aria-hidden="true" /> Discard
            </button>
          </div>
        </>
      )}
      <div className="mt-2">
        <MutationError error={resolve.error} />
      </div>
    </CardFrame>
  );
}

export function AgentActionView({ action }: { action: AgentAction }) {
  switch (action.kind) {
    case 'file_issue':
      return <IssueDraftView draft={action} />;
    case 'send_broadcast':
      return <BroadcastDraftView draft={action} />;
    case 'handoff_note':
      return <HandoffDraftView draft={action} />;
    case 'self_resolve':
      return <SelfResolveDraftView draft={action} />;
  }
}
