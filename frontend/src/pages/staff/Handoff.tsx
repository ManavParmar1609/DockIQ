import { Check } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router';

import { useDocks, useHandoffs, useIssues, useSubmitHandoff } from '../../api/hooks';
import { useUser } from '../../auth/AuthProvider';
import { SeverityMark } from '../../components/Severity';
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
import { formatDateTime } from '../../lib/format';
import { bySeverityThenAge, LIFECYCLE } from '../../lib/vocab';

const SHIFTS = [
  { value: 'day', label: 'Day' },
  { value: 'night', label: 'Night' },
] as const;

export default function Handoff() {
  const user = useUser();
  const docks = useDocks();
  const open = useIssues({ status: 'active' });
  const handoffs = useHandoffs();
  const submit = useSubmitHandoff();
  const [shift, setShift] = useState<'day' | 'night'>(user.shift === 'night' ? 'night' : 'day');
  const [notes, setNotes] = useState('');

  const zoneDocks = (docks.data ?? []).filter((dock) => !user.zone || dock.zone === user.zone);
  const unresolved = [...(open.data ?? [])].sort(bySeverityThenAge);

  const send = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!notes.trim()) return;
    submit.mutate({ shift, notes: notes.trim() }, { onSuccess: () => setNotes('') });
  };

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
          value={zoneDocks.filter((dock) => dock.status !== 'idle').length}
          index={0}
        />
        <Stat
          label="Open issues"
          value={unresolved.length}
          alert={unresolved.some((issue) => issue.severity === 'critical')}
          index={1}
        />
        <Stat
          label="Loads in progress"
          value={
            zoneDocks.filter(
              (dock) => dock.lifecycle_phase === 'loading' || dock.lifecycle_phase === 'unloading',
            ).length
          }
          index={2}
        />
        <Stat
          label="Idle docks"
          value={zoneDocks.filter((dock) => dock.status === 'idle').length}
          index={3}
        />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Still open — hand these over" index={4}>
          {unresolved.length === 0 ? (
            <EmptyState title="Nothing open" />
          ) : (
            <ul className="flex flex-col">
              {unresolved.map((issue) => (
                <li key={issue.id}>
                  <Link
                    to={`/app/issues/${issue.id}`}
                    className="flex items-center gap-3 border-b border-hairline py-2.5 hover:bg-paper-sunk"
                  >
                    <SeverityMark severity={issue.severity} size={16} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {issue.issue_subtype ?? issue.issue_type}
                      </span>
                      <span className="telemetry text-sm text-ink-mute">
                        Dock {issue.door_number ?? '—'} · {issue.operator_name}
                      </span>
                    </span>
                    <span className="label">{issue.severity}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Docks in your zone" index={5}>
          <ul className="flex flex-col">
            {zoneDocks.map((dock) => (
              <li key={dock.id} className="flex items-center gap-3 border-b border-hairline py-2.5">
                <span className="display w-12 text-2xl">{String(dock.door_number).padStart(2, '0')}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{dock.operator_name ?? 'Unassigned'}</span>
                  <span className="text-sm text-ink-mute">
                    {dock.company_name ?? 'No load'} · {LIFECYCLE[dock.lifecycle_phase]}
                  </span>
                </span>
                <span className="label">{dock.status}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Write the handoff" index={6}>
        {submit.isSuccess && (
          <p className="mb-4 flex items-center gap-2 border-2 border-ink bg-paper-sunk p-3 font-semibold">
            <Check size={20} aria-hidden="true" /> Handoff saved. Your zone&apos;s operators see it on their
            shift screen.
          </p>
        )}
        <form onSubmit={send} className="flex flex-col gap-4">
          <ChoiceGroup label="Shift" options={SHIFTS} value={shift} onChange={setShift} />
          <div>
            <FieldLabel htmlFor="handoff-notes">Notes</FieldLabel>
            <textarea
              id="handoff-notes"
              rows={5}
              className="field text-lg"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Key events, open issues, trailers waiting, equipment notes"
            />
          </div>
          <MutationError error={submit.error} />
          <button type="submit" className="btn btn-primary" disabled={!notes.trim() || submit.isPending}>
            {submit.isPending ? 'Saving…' : 'Submit handoff'}
          </button>
        </form>
      </Panel>

      <Panel title="Previous handoffs" index={7}>
        <QueryBoundary query={handoffs}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState title="None yet" />
            ) : (
              <ul className="flex flex-col gap-3">
                {list.map((handoff) => (
                  <li key={handoff.id} className="border-l-4 border-ink pl-4">
                    <p className="label">
                      {handoff.supervisor_name} · {handoff.shift} shift · {formatDateTime(handoff.created_at)}
                    </p>
                    <p className="mt-1 text-base">{handoff.notes}</p>
                  </li>
                ))}
              </ul>
            )
          }
        </QueryBoundary>
      </Panel>
    </div>
  );
}
