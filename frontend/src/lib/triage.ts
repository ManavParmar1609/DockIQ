/**
 * The supervisor's "needs me" queue as pure functions: which group an open issue belongs to, how long
 * it has waited, and whether it is past its decision target (business-rules §7.4 — the targets come
 * from `GET /api/taxonomy`, never a copy here).
 */
import type { Issue } from '../api/types';

/** Minutes by severity name, as `GET /api/taxonomy` serves them. */
export type DecisionTargets = Record<string, number>;

type Queued = Pick<Issue, 'status' | 'severity' | 'created_at' | 'escalated_at'>;

/** When the issue reached the queue: escalated, else filed. */
export function waitingSince(issue: Pick<Issue, 'created_at' | 'escalated_at'>): string {
  return issue.escalated_at ?? issue.created_at;
}

/** Open, no decision yet (not on hold), and waiting longer than its severity's target. */
export function isOverdue(issue: Queued, targets: DecisionTargets | undefined, now: number): boolean {
  if (issue.status !== 'escalated' && issue.status !== 'resolution_in_progress') return false;
  const target = targets?.[issue.severity];
  if (target === undefined) return false;
  const minutes = (now - new Date(waitingSince(issue)).getTime()) / 60_000;
  return minutes > target;
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
