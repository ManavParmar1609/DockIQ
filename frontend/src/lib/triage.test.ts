import { describe, expect, it } from 'vitest';

import { issue, minutesAgo, TAXONOMY } from '../test/fixtures';
import {
  awaitsDisposition,
  byUrgency,
  doorStatus,
  isOverdue,
  overdueLabel,
  qualitySections,
  triage,
} from './triage';

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

describe('overdueLabel and byUrgency (business-rules §7.4)', () => {
  const now = Date.now();

  it('says how far past the target an overdue issue is, in its largest unit', () => {
    expect(
      overdueLabel(issue({ severity: 'critical', escalated_at: minutesAgo(16 * 60 + 20) }), TARGETS, now),
    ).toBe('+16h over 15m');
    expect(overdueLabel(issue({ severity: 'high', escalated_at: minutesAgo(70.5) }), TARGETS, now)).toBe(
      '+10m over 1h',
    );
    expect(
      overdueLabel(issue({ severity: 'critical', escalated_at: minutesAgo(5) }), TARGETS, now),
    ).toBeNull();
  });

  it('sorts by severity, then the most overdue first, then the oldest', () => {
    const rows = [
      issue({ id: 1, severity: 'high', escalated_at: minutesAgo(90), created_at: minutesAgo(400) }),
      issue({ id: 2, severity: 'critical', escalated_at: minutesAgo(20), created_at: minutesAgo(20) }),
      issue({ id: 3, severity: 'high', escalated_at: minutesAgo(600), created_at: minutesAgo(600) }),
      issue({ id: 4, severity: 'critical', escalated_at: minutesAgo(300), created_at: minutesAgo(10) }),
      issue({ id: 5, severity: 'high', status: 'on_hold', created_at: minutesAgo(900) }),
    ];
    expect([...rows].sort(byUrgency(TARGETS, now)).map((row) => row.id)).toEqual([4, 2, 3, 1, 5]);
  });
});

describe('awaitsDisposition', () => {
  it('is product on hold or a cold room, without a disposition', () => {
    expect(awaitsDisposition(issue({ held_pallets: ['LPN-1'] }))).toBe(true);
    expect(awaitsDisposition(issue({ room: 'Freezer 2' }))).toBe(true);
    expect(awaitsDisposition(issue({ held_pallets: ['LPN-1'], disposition: 'release' }))).toBe(false);
    expect(awaitsDisposition(issue({ held_pallets: [] }))).toBe(false);
  });
});

describe('doorStatus', () => {
  const dock = { id: 3, status: 'issue' as const, open_issues: 2 };

  it('raises a door with an open critical to Critical, whatever the stored status says', () => {
    const open = [
      issue({ dock_door_id: 3, severity: 'critical' }),
      issue({ dock_door_id: 3, severity: 'medium' }),
    ];
    expect(doorStatus(dock, open)).toBe('critical');
    expect(doorStatus({ ...dock, status: 'active' }, open)).toBe('critical');
  });

  it('shows Issue on an active door with open issues, and never lowers a flag', () => {
    expect(doorStatus({ id: 7, status: 'active', open_issues: 1 }, [])).toBe('issue');
    expect(doorStatus({ id: 6, status: 'critical', open_issues: 0 }, [])).toBe('critical');
    expect(doorStatus({ id: 2, status: 'active', open_issues: 0 }, [])).toBe('active');
    const closed = [issue({ dock_door_id: 2, severity: 'critical', status: 'supervisor_resolved' })];
    expect(doorStatus({ id: 2, status: 'active', open_issues: 0 }, closed)).toBe('active');
  });
});

describe('qualitySections', () => {
  it('files each open issue once: disposition first, then temperature, other critical, the rest', () => {
    const rows = [
      issue({ id: 1, issue_type: 'Temperature Deviation', held_pallets: ['LPN-1'] }),
      issue({ id: 2, issue_type: 'Temperature Deviation', severity: 'critical' }),
      issue({ id: 3, issue_type: 'Seal Issue', severity: 'critical' }),
      issue({ id: 4, issue_type: 'Lot / Expiry', severity: 'medium' }),
      issue({ id: 5, issue_type: 'Seal Issue', severity: 'critical', status: 'supervisor_resolved' }),
      issue({ id: 6, issue_type: 'Temperature Deviation', held_pallets: ['LPN-2'], disposition: 'destroy' }),
      issue({ id: 7, issue_type: 'Room excursion', room: 'Freezer 2', severity: 'critical' }),
    ];
    const sections = qualitySections(rows, TAXONOMY.cold_chain_issue_types ?? []);
    const ids = (list: { id: number }[]) => list.map((row) => row.id);
    expect(ids(sections.awaiting)).toEqual([1, 7]);
    expect(ids(sections.temperature)).toEqual([2, 6]);
    expect(ids(sections.critical)).toEqual([3]);
    expect(ids(sections.other)).toEqual([4]);
  });
});
