import { Megaphone, Send } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

import {
  useDocks,
  useFulfillRequest,
  useHandoffs,
  useIssues,
  useRequests,
  useSendBroadcast,
} from '../../api/hooks';
import { useUser } from '../../auth/AuthProvider';
import { DockFloor } from '../../components/DockFloor';
import { HandoffNote } from '../../components/HandoffNote';
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
import { triage } from '../../lib/triage';
import { useNow } from '../../lib/useNow';

const HANDOFF_FRESH_MS = 16 * 60 * 60 * 1000;

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
  const handoffs = useHandoffs();
  const now = useNow(60_000);
  const latestHandoff = handoffs.data?.find(
    (handoff) => now - new Date(handoff.created_at).getTime() < HANDOFF_FRESH_MS,
  );
  const [composing, setComposing] = useState(false);

  // The open dock lives in the URL (?dock=4), so it survives a refresh and the back button closes it.
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const selectedDoor = Number(params.get('dock')) || null;
  const openDock = (door: number) => {
    const next = new URLSearchParams(params);
    next.set('dock', String(door));
    setParams(next, { state: { dockSheet: true } });
  };
  const closeDock = () => {
    const state: unknown = location.state;
    if (typeof state === 'object' && state !== null && 'dockSheet' in state) {
      void navigate(-1);
      return;
    }
    const next = new URLSearchParams(params);
    next.delete('dock');
    setParams(next, { replace: true });
  };

  const { priority, onHold, working, critical } = triage(issues.data ?? []);
  const activeDocks = (docks.data ?? []).filter((dock) => dock.status !== 'idle');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        kicker={`${greeting()}, ${firstName(user.name)}`}
        title={user.zone ?? 'The floor'}
        meta={<span>What needs you, in the order it should be handled.</span>}
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

      {latestHandoff && (
        <Panel title="From the last shift">
          <HandoffNote handoff={latestHandoff} />
        </Panel>
      )}

      <StatGrid>
        <Stat
          label="Needs you"
          value={priority.length}
          sub={priority.length ? 'Escalated or critical' : 'Queue clear'}
          index={0}
        />
        <Stat
          label="Critical"
          value={critical.length}
          sub={critical.length ? 'Open, in any state' : 'None'}
          alert={critical.length > 0}
          index={1}
        />
        <Stat
          label="On hold"
          value={onHold.length}
          sub={onHold.length ? 'Waiting on a carrier or inspection' : 'Nothing pending'}
          index={2}
        />
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
              {() => <IssueQueue issues={priority} empty="No escalations — the team is handling it" />}
            </QueryBoundary>
          </Panel>
          {onHold.length > 0 && (
            <Panel title="On hold" aside={<span className="label">Waiting on someone else</span>} index={5}>
              <IssueQueue issues={onHold} empty="" />
            </Panel>
          )}
          {working.length > 0 && (
            <Panel
              title="Being resolved at the dock"
              aside={<span className="label">{working.length} with a procedure</span>}
              index={5}
            >
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
                          {request.details && <p className="text-base">{request.details}</p>}
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
          {(list) => (
            <DockFloor
              docks={list}
              highlightZone={user.zone}
              selectedDoor={selectedDoor}
              onOpen={openDock}
              onClose={closeDock}
            />
          )}
        </QueryBoundary>
      </Panel>
    </div>
  );
}
