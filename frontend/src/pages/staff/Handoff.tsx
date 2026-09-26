import { Check, Plus, RotateCw } from 'lucide-react';
import { useId, useState, type SyntheticEvent } from 'react';
import { Link, useLocation } from 'react-router';

import { useDocks, useHandoffDraft, useHandoffs, useIssues, useSubmitHandoff } from '../../api/hooks';
import type { Dock, Handoff as HandoffRecord, HandoffDraft, Issue } from '../../api/types';
import { useUser } from '../../auth/AuthProvider';
import { HandoffNote, ReadReceipt } from '../../components/HandoffNote';
import { SeverityMark, severityLabel } from '../../components/Severity';
import {
  ChoiceGroup,
  EmptyState,
  FieldLabel,
  MutationError,
  PageHeader,
  Panel,
  QueryBoundary,
  Stat,
  StatGrid,
} from '../../components/ui';
import { elapsed, formatDateTime } from '../../lib/format';
import { doorStatus, waitingSince } from '../../lib/triage';
import { useNow } from '../../lib/useNow';
import { composeHandoff, HANDOFF_MAX, sectionsFrom, type HandoffSection } from '../../lib/handoff';
import { bySeverityThenAge, DOCK_STATUS, LIFECYCLE } from '../../lib/vocab';

const SHIFTS = [
  { value: 'day', label: 'Day' },
  { value: 'night', label: 'Night' },
] as const;

/**
 * The note, pre-filled from the floor as sections the supervisor edits. Mounted with the draft, so a
 * fresh draft (the "start again" button) remounts it with new text.
 */
function HandoffEditor({
  draft,
  extra,
  defaultShift,
  onRestart,
  restarting,
}: {
  draft: HandoffDraft;
  extra: string;
  defaultShift: 'day' | 'night';
  onRestart: () => void;
  restarting: boolean;
}) {
  const submit = useSubmitHandoff();
  const [shift, setShift] = useState<'day' | 'night'>(defaultShift);
  const [sections, setSections] = useState<HandoffSection[]>(() => sectionsFrom(draft, extra));
  const notes = composeHandoff(sections);
  const tooLong = notes.length > HANDOFF_MAX;

  const edit = (id: HandoffSection['id'], text: string) =>
    setSections((current) => current.map((section) => (section.id === id ? { ...section, text } : section)));

  const send = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!notes.trim() || tooLong) return;
    submit.mutate({ shift, notes });
  };

  if (submit.isSuccess) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="flex items-center gap-2 rounded-lg bg-paper-sunk p-3 font-semibold">
          <Check size={20} aria-hidden="true" /> Handoff saved. The incoming supervisor sees it on their
          floor, and you will see when they have read it.
        </p>
        <button type="button" className="btn btn-secondary" onClick={onRestart}>
          <RotateCw size={18} aria-hidden="true" /> Write another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-5">
      <p className="text-base text-ink-soft">
        Filled in from the floor since {formatDateTime(draft.since)}. Change anything; empty sections are left
        out.
      </p>
      <ChoiceGroup label="Shift" options={SHIFTS} value={shift} onChange={setShift} />
      {sections.map((section) => (
        <div key={section.id}>
          <FieldLabel htmlFor={`handoff-${section.id}`}>{section.heading}</FieldLabel>
          <textarea
            id={`handoff-${section.id}`}
            rows={Math.min(8, Math.max(2, section.text.split('\n').length + 1))}
            className="field text-base"
            value={section.text}
            onChange={(event) => edit(section.id, event.target.value)}
            placeholder={
              section.id === 'other' ? 'Equipment, staffing, anything the next shift should know' : 'Nothing'
            }
          />
        </div>
      ))}
      <p className={`telemetry text-sm ${tooLong ? 'font-semibold text-hazard-deep' : 'text-ink-mute'}`}>
        {notes.length} / {HANDOFF_MAX} characters{tooLong ? ' — shorten it to save' : ''}
      </p>
      <MutationError error={submit.error} />
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!notes.trim() || tooLong || submit.isPending}
        >
          {submit.isPending ? 'Saving…' : 'Submit handoff'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={restarting} onClick={onRestart}>
          <RotateCw size={18} aria-hidden="true" /> Start again from the floor
        </button>
      </div>
    </form>
  );
}

/** An earlier handoff as a hairline row: tap to read it; the plus turns to a cross while it is open. */
function PastHandoff({ handoff }: { handoff: HandoffRecord }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className="border-b border-hairline">
      <button
        type="button"
        className="accordion-row flex w-full items-center gap-3 py-3 text-left"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">
            {handoff.supervisor_name} · <span className="capitalize">{handoff.shift}</span> shift
          </span>
          <span className="telemetry block text-sm text-ink-mute">
            {formatDateTime(handoff.created_at)} · {handoff.read_at ? 'Read' : 'Not read yet'}
          </span>
        </span>
        <Plus size={22} aria-hidden="true" className="accordion-icon shrink-0 text-ink-mute" />
      </button>
      <div id={id} role="region" aria-label={`Handoff, ${formatDateTime(handoff.created_at)}`} hidden={!open}>
        {open && (
          <div className="accordion-body flex flex-col gap-2 pb-4">
            <p className="text-base whitespace-pre-line">{handoff.notes}</p>
            <ReadReceipt handoff={handoff} />
          </div>
        )}
      </div>
    </li>
  );
}

export default function Handoff() {
  const user = useUser();
  const docks = useDocks();
  const open = useIssues({ status: 'active' });
  const handoffs = useHandoffs();
  const draft = useHandoffDraft();
  const [round, setRound] = useState(0);
  // The assistant's draft arrives as navigation state; it goes under "Anything else".
  const location = useLocation() as { state: { handoffNotes?: string } | null };
  const extra = round === 0 ? (location.state?.handoffNotes ?? '') : '';
  const restart = () => {
    void draft.refetch().then(() => setRound((value) => value + 1));
  };

  const inZone = (list: Dock[]) => list.filter((dock) => !user.zone || dock.zone === user.zone);
  const sorted = (list: Issue[]) => [...list].sort(bySeverityThenAge);
  // Undefined until loaded: a stat shows "—" rather than a false "0 open".
  const zoneDocks = docks.data && inZone(docks.data);
  const unresolved = open.data && sorted(open.data);
  const count = (list: unknown[] | undefined) => list?.length ?? '—';
  const criticalCount = unresolved?.filter((issue) => issue.severity === 'critical').length;
  const now = useNow();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        kicker={user.zone ?? 'Your zone'}
        title="Shift handoff"
        meta={<span>What the incoming shift needs to know.</span>}
      />

      <StatGrid>
        <Stat
          label="Active docks"
          value={count(zoneDocks?.filter((dock) => dock.status !== 'idle'))}
          index={0}
        />
        {/* A count of every open issue is not an alarm; the criticals among it are named, not painted. */}
        <Stat
          label="Open issues"
          value={count(unresolved)}
          sub={
            criticalCount === undefined
              ? undefined
              : criticalCount > 0
                ? `${String(criticalCount)} critical`
                : 'None critical'
          }
          index={1}
        />
        <Stat
          label="Loads in progress"
          value={count(
            zoneDocks?.filter(
              (dock) => dock.lifecycle_phase === 'loading' || dock.lifecycle_phase === 'unloading',
            ),
          )}
          index={2}
        />
        <Stat
          label="Idle docks"
          value={count(zoneDocks?.filter((dock) => dock.status === 'idle'))}
          index={3}
        />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Still open — hand these over" index={4}>
          <QueryBoundary query={open} loading="Loading open issues">
            {(list) =>
              list.length === 0 ? (
                <EmptyState title="Nothing open" />
              ) : (
                <ul className="flex flex-col">
                  {sorted(list).map((issue) => (
                    <li key={issue.id}>
                      <Link
                        to={`/app/issues/${issue.id}`}
                        className="flex items-center gap-3 border-b border-hairline py-2.5 hover:bg-paper-sunk"
                      >
                        <SeverityMark severity={issue.severity} size={16} tinted />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">
                            {issue.issue_subtype ?? issue.issue_type}
                          </span>
                          <span className="telemetry text-sm text-ink-mute">
                            Dock {issue.door_number ?? '—'} · {issue.operator_name} ·{' '}
                            {issue.status === 'on_hold'
                              ? (issue.pending_action ?? 'On hold')
                              : issue.acknowledged_at
                                ? `Taken by ${issue.acknowledged_by_name ?? 'a supervisor'}`
                                : issue.status === 'escalated'
                                  ? 'Not taken'
                                  : 'At the dock'}{' '}
                            · {elapsed(waitingSince(issue), now)}
                          </span>
                        </span>
                        <span className="label">{severityLabel(issue.severity)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryBoundary>
        </Panel>

        <Panel title="Docks in your zone" index={5}>
          <QueryBoundary query={docks} loading="Loading docks">
            {(list) => (
              <ul className="flex flex-col">
                {inZone(list).map((dock) => (
                  <li key={dock.id} className="flex items-center gap-3 border-b border-hairline py-2.5">
                    <span className="display w-12 text-2xl">{String(dock.door_number).padStart(2, '0')}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {dock.operator_name ?? 'Unassigned'}
                      </span>
                      <span className="text-sm text-ink-mute">
                        {dock.company_name ?? 'No load'} · {LIFECYCLE[dock.lifecycle_phase]}
                      </span>
                    </span>
                    <span className="label">{DOCK_STATUS[doorStatus(dock, open.data ?? [])]}</span>
                  </li>
                ))}
              </ul>
            )}
          </QueryBoundary>
        </Panel>
      </div>

      <Panel title="Write the handoff" index={6}>
        <QueryBoundary query={draft} loading="Gathering the shift">
          {(data) => (
            <HandoffEditor
              key={round}
              draft={data}
              extra={extra}
              defaultShift={user.shift === 'night' ? 'night' : 'day'}
              onRestart={restart}
              restarting={draft.isFetching}
            />
          )}
        </QueryBoundary>
      </Panel>

      <Panel title="Previous handoffs" index={7}>
        <QueryBoundary query={handoffs}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState title="None yet" />
            ) : (
              <div className="flex flex-col gap-4">
                {list[0] && (
                  <div className="rounded-lg bg-paper-sunk px-4 py-3">
                    <HandoffNote handoff={list[0]} />
                  </div>
                )}
                {list.length > 1 && (
                  <ul className="flex flex-col border-t border-hairline">
                    {list.slice(1).map((handoff) => (
                      <PastHandoff key={handoff.id} handoff={handoff} />
                    ))}
                  </ul>
                )}
              </div>
            )
          }
        </QueryBoundary>
      </Panel>
    </div>
  );
}
