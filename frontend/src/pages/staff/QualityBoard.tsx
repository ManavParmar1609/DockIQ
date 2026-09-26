import { useIssues, useTaxonomy } from '../../api/hooks';
import { useUser } from '../../auth/AuthProvider';
import { IssueQueue } from '../../components/IssueQueue';
import { PageHeader, Panel, QueryBoundary, Stat, StatGrid } from '../../components/ui';
import { firstName, formatMoney, greeting } from '../../lib/format';
import { qualitySections } from '../../lib/triage';
import { ISSUE_STATUS } from '../../lib/vocab';

/** Scenario 2: Quality is notified the moment a cold-chain or product-integrity issue is raised. */
export default function QualityBoard() {
  const user = useUser();
  const issues = useIssues({ limit: 300 });
  const coldChain = useTaxonomy().data?.cold_chain_issue_types ?? [];
  const list = issues.data ?? [];
  const open = list.filter((issue) => ISSUE_STATUS[issue.status].open);
  const { awaiting, temperature, critical, other } = qualitySections(list, coldChain);
  const criticalOpen = open.filter((issue) => issue.severity === 'critical').length;
  const held = awaiting.reduce((sum, issue) => sum + (issue.held_pallets?.length ?? 0), 0);
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
        <Stat
          label="Awaiting your disposition"
          value={awaiting.length}
          sub={held > 0 ? `${String(held)} pallets held` : 'Nothing held'}
          index={0}
        />
        <Stat
          label="Critical open"
          value={criticalOpen}
          sub={criticalOpen > 0 ? 'Across the facility' : 'None'}
          alert={criticalOpen > 0}
          index={1}
        />
        <Stat
          label="Temperature"
          value={open.filter((issue) => coldChain.includes(issue.issue_type) || issue.room).length}
          sub="Open deviations"
          index={2}
        />
        <Stat
          label="Open exposure"
          value={formatMoney(exposure)}
          sub={`${String(open.length)} open · estimated`}
          index={3}
        />
      </StatGrid>
      <QueryBoundary query={issues} loading="Loading quality issues">
        {() => (
          <>
            <Panel
              title="Awaiting your disposition"
              aside={<span className="label">Product on hold or a room over its limit</span>}
              index={4}
            >
              <IssueQueue view="quality" issues={awaiting} empty="Nothing waiting on a disposition" />
            </Panel>
            <Panel
              title="Temperature"
              aside={<span className="label">Open cold-chain deviations</span>}
              index={5}
            >
              <IssueQueue view="quality" issues={temperature} empty="No other open temperature issues" />
            </Panel>
            <Panel
              title="Other critical"
              aside={<span className="label">Not product, still critical</span>}
              index={6}
            >
              <IssueQueue view="quality" issues={critical} empty="No other critical issues" />
            </Panel>
            {other.length > 0 && (
              <Panel
                title="Other open"
                aside={<span className="label">Product quality, lot and expiry</span>}
                index={7}
              >
                <IssueQueue view="quality" issues={other} empty="" />
              </Panel>
            )}
          </>
        )}
      </QueryBoundary>
    </div>
  );
}
