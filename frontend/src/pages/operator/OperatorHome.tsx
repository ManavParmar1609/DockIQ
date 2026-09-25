import {
  ArrowRight,
  ChevronRight,
  ClipboardCheck,
  MessageSquare,
  PackageCheck,
  TriangleAlert,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';

import { useActiveOrder, useHandoffs, useIssues } from '../../api/hooks';
import type { Issue } from '../../api/types';
import { useUser } from '../../auth/AuthProvider';
import { SeverityMark, severityLabel } from '../../components/Severity';
import {
  Definition,
  EmptyState,
  ErrorBlock,
  IssueStatusTag,
  LoadingBlock,
  PageHeader,
  Panel,
  Stat,
  StatGrid,
} from '../../components/ui';
import { firstName, greeting, timeAgo } from '../../lib/format';
import { ISSUE_STATUS } from '../../lib/vocab';

function Action({
  to,
  icon: Icon,
  title,
  sub,
  index,
}: {
  to: string;
  icon: typeof PackageCheck;
  title: string;
  sub: string;
  index: number;
}) {
  return (
    <Link
      to={to}
      className="reveal group card lift flex items-center gap-4 p-5 active:scale-99"
      style={{ '--i': index } as CSSProperties}
    >
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-ink">
        <Icon size={26} aria-hidden="true" />
      </span>
      <span className="flex-1">
        <span className="heading block text-lg">{title}</span>
        <span className="text-base text-ink-mute">{sub}</span>
      </span>
      <ArrowRight size={22} aria-hidden="true" className="text-ink-mute" />
    </Link>
  );
}

function RecentIssue({ issue }: { issue: Issue }) {
  return (
    <li>
      <Link
        to={`/app/issues/${issue.id}`}
        className="flex items-center gap-3 border-b border-hairline px-5 py-3 transition-colors hover:bg-paper"
      >
        <SeverityMark severity={issue.severity} size={16} tinted />
        <span className="sr-only">{severityLabel(issue.severity)} severity:</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{issue.issue_subtype ?? issue.issue_type}</span>
          <span className="telemetry text-sm text-ink-mute">
            #{issue.id} · Dock {issue.door_number ?? '—'} · {timeAgo(issue.created_at)}
          </span>
        </span>
        <IssueStatusTag status={issue.status} />
        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-ink-mute" />
      </Link>
    </li>
  );
}

export default function OperatorHome() {
  const user = useUser();
  const order = useActiveOrder();
  const issues = useIssues({ limit: 100 });
  const handoffs = useHandoffs();
  const handoff = handoffs.data?.[0];
  const list = issues.data ?? [];
  const open = list.filter((issue) => ISSUE_STATUS[issue.status].open);

  const assignment = order.data;
  const outbound = assignment?.type === 'outbound';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        kicker={`${greeting()}, ${firstName(user.name)}`}
        title={assignment ? `Dock ${assignment.door_number ?? '—'}` : 'No assignment'}
        meta={
          assignment ? (
            <>
              <span>
                {outbound ? 'Loading' : 'Unloading'} for{' '}
                <strong className="text-ink">{assignment.company_name}</strong>
              </span>
              <span className="telemetry">{assignment.order_number}</span>
              <span className="telemetry">Trailer {assignment.trailer_number}</span>
              <span>{assignment.carrier_name}</span>
            </>
          ) : (
            <span>Your dock assignment appears here as soon as a load is ready for you.</span>
          )
        }
      />

      {order.isError && <ErrorBlock error={order.error} onRetry={() => void order.refetch()} />}

      {handoff && (
        <Panel
          title={`From the ${handoff.shift} shift`}
          aside={<span className="label">{timeAgo(handoff.created_at)}</span>}
          index={0}
        >
          <p className="text-lg">{handoff.notes}</p>
          <p className="label mt-3">Handed off by {handoff.supervisor_name}</p>
        </Panel>
      )}

      {assignment && (
        <div className="grid gap-3 md:grid-cols-2">
          <Action
            to="/app/inspection"
            icon={ClipboardCheck}
            title="1 · Inspect the trailer"
            sub="Seal, cleanliness, damage, temperature"
            index={1}
          />
          <Action
            to="/app/order"
            icon={PackageCheck}
            title={outbound ? '2 · Load the trailer' : '2 · Receive the trailer'}
            sub={outbound ? 'Load plan, scanning and counts' : 'Temperature, checks and counts'}
            index={2}
          />
          <Action
            to="/app/report"
            icon={TriangleAlert}
            title="Report an issue"
            sub="Get the procedure, or escalate"
            index={3}
          />
          <Action
            to="/app/chat"
            icon={MessageSquare}
            title="Ask the assistant"
            sub="SOPs, locations, thresholds"
            index={4}
          />
        </div>
      )}

      <StatGrid>
        <Stat
          label="Open"
          value={open.length}
          sub={open.length ? 'Needs attention' : 'All clear'}
          alert={open.some((issue) => issue.severity === 'critical')}
          index={5}
        />
        <Stat
          label="Fixed by you"
          value={list.filter((issue) => issue.status === 'self_resolved').length}
          sub="Self-resolved"
          index={6}
        />
        <Stat
          label="Escalated"
          value={list.filter((issue) => issue.status === 'escalated').length}
          sub="With your supervisor"
          index={7}
        />
        <Stat label="Your history" value={list.length} sub="Issues logged" index={8} />
      </StatGrid>

      <Panel
        title="Recent issues"
        aside={
          <Link to="/app/issues" className="label flex items-center text-ink underline">
            All
          </Link>
        }
        flush
        index={9}
      >
        {issues.isPending ? (
          <LoadingBlock />
        ) : issues.isError ? (
          <div className="p-4">
            <ErrorBlock error={issues.error} onRetry={() => void issues.refetch()} />
          </div>
        ) : list.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Nothing reported yet" />
          </div>
        ) : (
          <ul>
            {list.slice(0, 5).map((issue) => (
              <RecentIssue key={issue.id} issue={issue} />
            ))}
          </ul>
        )}
      </Panel>

      {!assignment && !order.isPending && (
        <Panel title="While you wait">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Definition term="Supervisor">{user.supervisor_name ?? '—'}</Definition>
            <Definition term="Employee ID" mono>
              {user.employee_id}
            </Definition>
            <Definition term="Shift">{user.shift}</Definition>
          </dl>
        </Panel>
      )}
    </div>
  );
}
