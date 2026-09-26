/**
 * The supervisor's "needs me" queue as pure functions: which group an open issue belongs to, how long
 * it has waited, and whether it is past its decision target (business-rules §7.4 — the targets come
 * from `GET /api/taxonomy`, never a copy here).
 */
import type { Dock, Issue } from '../api/types';
import { ISSUE_STATUS } from './vocab';

/** Minutes by severity name, as `GET /api/taxonomy` serves them. */
export type DecisionTargets = Record<string, number>;

type Queued = Pick<Issue, 'status' | 'severity' | 'created_at' | 'escalated_at'>;

/** When the issue reached the queue: escalated, else filed. */
export function waitingSince(issue: Pick<Issue, 'created_at' | 'escalated_at'>): string {
  return issue.escalated_at ?? issue.created_at;
}

/**
 * How many minutes past its severity's target an open issue with no decision yet (not on hold) has
 * waited; zero or less while it is within target, null when no target applies.
 */
export function minutesOver(issue: Queued, targets: DecisionTargets | undefined, now: number): number | null {
  if (issue.status !== 'escalated' && issue.status !== 'resolution_in_progress') return null;
  const target = targets?.[issue.severity];
  if (target === undefined) return null;
  const minutes = (now - new Date(waitingSince(issue)).getTime()) / 60_000;
  return minutes - target;
}

/** Open, no decision yet (not on hold), and waiting longer than its severity's target. */
export function isOverdue(issue: Queued, targets: DecisionTargets | undefined, now: number): boolean {
  return (minutesOver(issue, targets, now) ?? 0) > 0;
}

/** A span of minutes at a glance, in its largest whole unit: "15m", "16h", "26d". */
function roughly(minutes: number): string {
  const whole = Math.max(1, Math.floor(minutes));
  if (whole < 60) return `${String(whole)}m`;
  if (whole < 48 * 60) return `${String(Math.floor(whole / 60))}h`;
  return `${String(Math.floor(whole / (24 * 60)))}d`;
}

/** "+16h over 15m": how far past the target, and the target itself. Null when it is not overdue. */
export function overdueLabel(
  issue: Queued,
  targets: DecisionTargets | undefined,
  now: number,
): string | null {
  const over = minutesOver(issue, targets, now);
  const target = targets?.[issue.severity];
  if (over === null || over <= 0 || target === undefined) return null;
  return `+${roughly(over)} over ${roughly(target)}`;
}

const SEVERITY_RANK: Record<Issue['severity'], number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * The queue's order: severity first; within a severity, the most overdue first, then the rest oldest
 * first. Needs the taxonomy's targets, so it is made per render rather than a fixed comparator.
 */
export function byUrgency(
  targets: DecisionTargets | undefined,
  now: number,
): (a: Queued & Pick<Issue, 'id'>, b: Queued & Pick<Issue, 'id'>) => number {
  const over = (issue: Queued) => Math.max(0, minutesOver(issue, targets, now) ?? 0);
  return (a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    over(b) - over(a) ||
    a.created_at.localeCompare(b.created_at) ||
    a.id - b.id;
}

/**
 * What Quality must decide: product on hold, or a cold room over its limit, without a disposition.
 * The alerts and the Quality board use this one test.
 */
export function awaitsDisposition(issue: Pick<Issue, 'room' | 'held_pallets' | 'disposition'>): boolean {
  return Boolean(issue.room || (issue.held_pallets?.length ?? 0) > 0) && !issue.disposition;
}

/**
 * The door's status as the wall should show it. The stored status is last-event-wins, so a later
 * report or a resolution elsewhere can leave a door with an open critical labelled "Issue" (or "Active"
 * with issues open). Raise it to what the open issues say; never lower what the server flagged.
 */
export function doorStatus(
  dock: Pick<Dock, 'id' | 'status' | 'open_issues'>,
  openIssues: readonly Pick<Issue, 'dock_door_id' | 'severity' | 'status'>[],
): Dock['status'] {
  const here = openIssues.filter(
    (issue) => issue.dock_door_id === dock.id && ISSUE_STATUS[issue.status].open,
  );
  if (here.some((issue) => issue.severity === 'critical')) return 'critical';
  if (dock.status === 'critical') return 'critical';
  if ((here.length > 0 || (dock.open_issues ?? 0) > 0) && dock.status !== 'issue') {
    return dock.status === 'idle' ? 'idle' : 'issue';
  }
  return dock.status;
}

export interface Triage<T> {
  /** Escalated, and every open critical whatever its status. */
  priority: T[];
  /** Waiting on the carrier or a re-inspection (critical ones stay in `priority`). */
  onHold: T[];
  /** Being worked at the dock by the operator, with a procedure. */
  working: T[];
  /** Every open critical, for the tile. */
  critical: T[];
}

export function triage<T extends Pick<Issue, 'status' | 'severity'>>(issues: readonly T[]): Triage<T> {
  const open = issues.filter(
    (issue) =>
      issue.status === 'escalated' || issue.status === 'on_hold' || issue.status === 'resolution_in_progress',
  );
  const critical = open.filter((issue) => issue.severity === 'critical');
  return {
    priority: open.filter((issue) => issue.status === 'escalated' || issue.severity === 'critical'),
    onHold: open.filter((issue) => issue.status === 'on_hold' && issue.severity !== 'critical'),
    working: open.filter(
      (issue) => issue.status === 'resolution_in_progress' && issue.severity !== 'critical',
    ),
    critical,
  };
}

export interface QualitySections {
  /** Product on hold or a cold room over its limit, with no disposition: Quality's own decisions. */
  awaiting: Issue[];
  /** Open cold-chain issues with nothing for Quality to dispose of yet. */
  temperature: Issue[];
  /** Any other open critical. */
  critical: Issue[];
  /** The rest of Quality's open issues: product quality, lot and expiry. */
  other: Issue[];
}

/** Each open issue in exactly one section, the first that fits. */
export function qualitySections(issues: readonly Issue[], coldChain: readonly string[]): QualitySections {
  const sections: QualitySections = { awaiting: [], temperature: [], critical: [], other: [] };
  for (const issue of issues) {
    if (!ISSUE_STATUS[issue.status].open) continue;
    if (awaitsDisposition(issue)) sections.awaiting.push(issue);
    else if (coldChain.includes(issue.issue_type) || issue.room) sections.temperature.push(issue);
    else if (issue.severity === 'critical') sections.critical.push(issue);
    else sections.other.push(issue);
  }
  return sections;
}
