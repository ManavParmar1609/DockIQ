import { useIssues } from '../../api/hooks';
import { useUser } from '../../auth/AuthProvider';
import { IssueQueue } from '../../components/IssueQueue';
import { PageHeader, Panel, QueryBoundary, Stat, StatGrid } from '../../components/ui';
import { firstName, formatMoney, greeting } from '../../lib/format';
import { ISSUE_STATUS } from '../../lib/vocab';

/** Scenario 2: Quality is notified the moment a cold-chain or product-integrity issue is raised. */
export default function QualityBoard() {
  const user = useUser();
  const issues = useIssues({ limit: 300 });
  const list = issues.data ?? [];
  const open = list.filter((issue) => ISSUE_STATUS[issue.status].open);
  const temperature = list.filter((issue) => issue.issue_type === 'Temperature Deviation');
  const exposure = open.reduce((sum, issue) => sum + issue.estimated_cost_impact, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        kicker={`${greeting()}, ${firstName(user.name)}`}
        title="Quality"
        meta={
          <span>
            Every temperature, product-quality and lot/expiry issue — and anything critical — across all
            zones.
          </span>
        }
      />
      <StatGrid>
        <Stat label="Open" value={open.length} sub="Across the facility" index={0} />
        <Stat
          label="Critical open"
          value={open.filter((issue) => issue.severity === 'critical').length}
          alert={open.some((issue) => issue.severity === 'critical')}
          index={1}
        />
        <Stat label="Temperature" value={temperature.length} sub="Deviations on record" index={2} />
        <Stat label="Open exposure" value={formatMoney(exposure)} sub="Estimated" index={3} />
      </StatGrid>
      <Panel
        title="Open quality issues"
        aside={<span className="label">Critical first · then oldest</span>}
        index={4}
      >
        <QueryBoundary query={issues} loading="Loading quality issues">
          {() => <IssueQueue issues={open} empty="No open quality issues" />}
        </QueryBoundary>
      </Panel>
    </div>
  );
}
