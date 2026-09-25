import { Megaphone, Send } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';

import { useDocks, useFulfillRequest, useIssues, useRequests, useSendBroadcast } from '../../api/hooks';
import { useUser } from '../../auth/AuthProvider';
import { DockFloor } from '../../components/DockFloor';
import { IssueQueue } from '../../components/IssueQueue';
import {
  EmptyState,
  MutationError,
  PageHeader,
  Panel,
  QueryBoundary,
  Stat,
  StatGrid,
} from '../../components/ui';
import { firstName, greeting, timeAgo } from '../../lib/format';

function BroadcastComposer({ onSent }: { onSent: () => void }) {
  const send = useSendBroadcast();
  const [message, setMessage] = useState('');
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!message.trim()) return;
    send.mutate(message.trim(), {
      onSuccess: () => {
        setMessage('');
        onSent();
      },
    });
  };
  return (
    <Panel title="Broadcast to your team">
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <label htmlFor="broadcast" className="sr-only">
          Message
        </label>
        <input
          id="broadcast"
          className="field flex-1 text-lg"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Shows on every tablet in your team at once"
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={!message.trim() || send.isPending}>
          <Send size={18} aria-hidden="true" /> Send
        </button>
      </form>
      <div className="mt-2">
        <MutationError error={send.error} />
      </div>
    </Panel>
  );
}

export default function SupervisorFloor() {
  const user = useUser();
  const issues = useIssues({ status: 'active' });
  const docks = useDocks();
  const requests = useRequests('pending');
  const fulfill = useFulfillRequest();
  const [composing, setComposing] = useState(false);

  const open = issues.data ?? [];
  const escalated = open.filter((issue) => issue.status === 'escalated');
  const working = open.filter((issue) => issue.status === 'resolution_in_progress');
  const critical = escalated.filter((issue) => issue.severity === 'critical');
  const activeDocks = (docks.data ?? []).filter((dock) => dock.status !== 'idle');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        kicker={`${greeting()}, ${firstName(user.name)}`}
        title={user.zone ?? 'The floor'}
        meta={<span>Your team&apos;s escalations, in the order they should be handled.</span>}
        actions={
          <button
            type="button"
            className={`btn ${composing ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setComposing((value) => !value)}
            aria-expanded={composing}
          >
            <Megaphone size={18} aria-hidden="true" /> Broadcast
          </button>
        }
      />

      {composing && <BroadcastComposer onSent={() => setComposing(false)} />}

      <StatGrid>
        <Stat
          label="Escalated"
          value={escalated.length}
          sub={escalated.length ? 'Awaiting you' : 'Queue clear'}
          index={0}
        />
        <Stat
          label="Critical"
          value={critical.length}
          sub={critical.length ? 'Go now' : 'None'}
          alert={critical.length > 0}
          index={1}
        />
        <Stat label="Being resolved" value={working.length} sub="By operators, with a procedure" index={2} />
        <Stat label="Requests" value={requests.data?.length ?? 0} sub="Pending" index={3} />
      </StatGrid>

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="flex flex-col gap-6 xl:col-span-3">
          <Panel
            title="Priority queue"
            aside={<span className="label">Critical first · then oldest</span>}
            index={4}
          >
            <QueryBoundary query={issues} loading="Loading the queue">
              {() => <IssueQueue issues={escalated} empty="No escalations — the team is handling it" />}
            </QueryBoundary>
          </Panel>
          {working.length > 0 && (
            <Panel title="Being resolved at the dock" index={5}>
              <IssueQueue issues={working} empty="" />
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-6 xl:col-span-2">
          <Panel title="Requests" index={6}>
            <QueryBoundary query={requests}>
              {(list) =>
                list.length === 0 ? (
                  <EmptyState title="Nothing pending" />
                ) : (
                  <ul className="flex flex-col gap-2">
                    {list.map((request) => (
                      <li key={request.id} className="flex items-center gap-3 rounded-lg bg-paper p-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-bold">{request.request_type}</p>
                          <p className="telemetry text-sm text-ink-mute">
                            {request.operator_name} · Dock {request.door_number ?? '—'} ·{' '}
                            {timeAgo(request.created_at)}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={fulfill.isPending}
                          onClick={() => fulfill.mutate(request.id)}
                        >
                          Done
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              }
            </QueryBoundary>
            <div className="mt-2">
              <MutationError error={fulfill.error} />
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="Dock floor" aside={<span className="label">{activeDocks.length} active</span>} index={7}>
        <QueryBoundary query={docks}>
          {(list) => <DockFloor docks={list} highlightZone={user.zone} />}
        </QueryBoundary>
      </Panel>
    </div>
  );
}
