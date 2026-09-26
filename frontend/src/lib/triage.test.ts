import { describe, expect, it } from 'vitest';

import { issue, minutesAgo, TAXONOMY } from '../test/fixtures';
import { isOverdue, triage } from './triage';

const TARGETS = TAXONOMY.decision_targets;

describe('triage', () => {
  it('puts every open critical in the priority queue, whatever its status', () => {
    const working = issue({
      id: 1,
      severity: 'critical',
      status: 'resolution_in_progress',
      escalated_at: null,
    });
    const held = issue({ id: 2, severity: 'critical', status: 'on_hold' });
    const escalated = issue({ id: 3, severity: 'medium', status: 'escalated' });
    const heldMedium = issue({ id: 4, severity: 'medium', status: 'on_hold' });
    const workingLow = issue({ id: 5, severity: 'low', status: 'resolution_in_progress' });
    const closed = issue({ id: 6, severity: 'critical', status: 'supervisor_resolved' });

    const groups = triage([working, held, escalated, heldMedium, workingLow, closed]);

    expect(groups.priority.map((row) => row.id)).toEqual([1, 2, 3]);
    expect(groups.critical.map((row) => row.id)).toEqual([1, 2]);
    expect(groups.onHold.map((row) => row.id)).toEqual([4]);
    expect(groups.working.map((row) => row.id)).toEqual([5]);
  });
});

describe('isOverdue (business-rules §7.4)', () => {
  const now = Date.now();

  it('flags an issue waiting past its severity target, from when it reached the queue', () => {
    expect(isOverdue(issue({ severity: 'critical', escalated_at: minutesAgo(16) }), TARGETS, now)).toBe(true);
    expect(isOverdue(issue({ severity: 'critical', escalated_at: minutesAgo(14) }), TARGETS, now)).toBe(
      false,
    );
    expect(
      isOverdue(
        issue({
          severity: 'high',
          status: 'resolution_in_progress',
          escalated_at: null,
          created_at: minutesAgo(61),
        }),
        TARGETS,
        now,
      ),
    ).toBe(true);
  });

  it('never flags a pending decision, a closed issue, or without targets', () => {
    const old = minutesAgo(600);
    expect(isOverdue(issue({ status: 'on_hold', escalated_at: old }), TARGETS, now)).toBe(false);
    expect(isOverdue(issue({ status: 'supervisor_resolved', escalated_at: old }), TARGETS, now)).toBe(false);
    expect(isOverdue(issue({ escalated_at: old }), undefined, now)).toBe(false);
  });
});
