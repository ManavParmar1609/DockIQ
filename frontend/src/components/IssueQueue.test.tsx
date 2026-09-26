import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { issue, minutesAgo, renderAs } from '../test/fixtures';
import { IssueQueue } from './IssueQueue';

describe('IssueQueue', () => {
  it('says how far past target in words, and who has taken each issue', () => {
    renderAs(
      'supervisor',
      <IssueQueue
        issues={[
          issue({ id: 1, severity: 'critical', escalated_at: minutesAgo(40.5) }),
          issue({
            id: 2,
            severity: 'high',
            escalated_at: minutesAgo(5),
            acknowledged_at: minutesAgo(3),
            acknowledged_by_name: 'Sarah Mitchell',
          }),
          issue({ id: 3, severity: 'medium', status: 'on_hold', pending_action: 'Awaiting the carrier' }),
        ]}
        empty="Nothing"
      />,
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Overdue +25m over 15m');
    expect(rows[0]).toHaveTextContent('Waiting — nobody has taken it');
    expect(rows[1]).toHaveTextContent('Taken by Sarah Mitchell · 3m');
    expect(rows[1]).not.toHaveTextContent('Overdue');
    expect(rows[2]).toHaveTextContent('Awaiting the carrier');
    expect(screen.getAllByText(/^Overdue/)).toHaveLength(1);
  });

  it('puts the most overdue first within a severity', () => {
    renderAs(
      'supervisor',
      <IssueQueue
        issues={[
          issue({ id: 1, severity: 'high', escalated_at: minutesAgo(70), created_at: minutesAgo(900) }),
          issue({ id: 2, severity: 'high', escalated_at: minutesAgo(600), created_at: minutesAgo(600) }),
          issue({ id: 3, severity: 'critical', escalated_at: minutesAgo(1), created_at: minutesAgo(1) }),
        ]}
        empty="Nothing"
      />,
    );
    const ids = screen.getAllByRole('listitem').map((row) => row.getAttribute('data-key'));
    expect(ids).toEqual(['3', '2', '1']);
  });

  it("speaks Quality's state to Quality: the disposition, the held pallets, the reading", () => {
    renderAs(
      'quality',
      <IssueQueue
        view="quality"
        issues={[
          issue({
            id: 1,
            severity: 'critical',
            issue_type: 'Temperature Deviation',
            held_pallets: ['LPN-1', 'LPN-2'],
            temp_reading: 14,
            temp_limit: 0,
            escalated_at: minutesAgo(300),
          }),
          issue({ id: 2, severity: 'high', held_pallets: ['LPN-3'], disposition: 'release' }),
        ]}
        empty="Nothing"
      />,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Awaiting your disposition · 2 pallets held');
    expect(rows[0]).toHaveTextContent('14°F / 0°F');
    expect(rows[0]).toHaveTextContent('Your call');
    expect(rows[0]).not.toHaveTextContent('nobody has taken it');
    expect(rows[0]).not.toHaveTextContent('Overdue');
    expect(rows[1]).toHaveTextContent('Disposition recorded: Released');
  });
});
