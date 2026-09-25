/**
 * The single place each status vocabulary is labelled. The old UI had four competing maps for the
 * same five issue statuses; this replaces all of them.
 */
import type { Dock, IssueStatus, Severity } from '../api/types';

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const ISSUE_STATUS: Record<IssueStatus, { label: string; open: boolean }> = {
  resolution_in_progress: { label: 'In progress', open: true },
  escalated: { label: 'Escalated', open: true },
  self_resolved: { label: 'Self-resolved', open: false },
  supervisor_resolved: { label: 'Supervisor resolved', open: false },
};

export const DOCK_STATUS: Record<Dock['status'], string> = {
  idle: 'Idle',
  active: 'Active',
  issue: 'Issue',
  critical: 'Critical',
};

export const LIFECYCLE: Record<Dock['lifecycle_phase'], string> = {
  idle: 'Idle',
  inspection: 'Inspection',
  loading: 'Loading',
  unloading: 'Unloading',
  complete: 'Complete',
};

export function bySeverityThenAge<T extends { severity: Severity; created_at: string }>(a: T, b: T): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.created_at.localeCompare(b.created_at);
}

/**
 * The severity engine's reason text — "Score: 20.0 → CRITICAL. Factors: a; b; c" — split for display,
 * so the derivation stays visible (rules §2.4.4) without the UI re-computing anything.
 */
export function parseSeverityReason(reason: string | null | undefined): {
  summary: string;
  factors: string[];
} {
  if (!reason) return { summary: '', factors: [] };
  const [summary = '', factors = ''] = reason.split('. Factors: ');
  return { summary, factors: factors.split('; ').filter(Boolean) };
}
