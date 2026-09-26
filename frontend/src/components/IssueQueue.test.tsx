import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { issue, minutesAgo, renderAs } from '../test/fixtures';
import { IssueQueue } from './IssueQueue';

describe('IssueQueue', () => {
  it('says Overdue in words, and who has taken each issue', () => {
    renderAs(
      'supervisor',
      <IssueQueue
        issues={[
          issue({ id: 1, severity: 'critical', escalated_at: minutesAgo(40) }),
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
    expect(rows[0]).toHaveTextContent('Overdue');
    expect(rows[0]).toHaveTextContent('Waiting — nobody has taken it');
    expect(rows[1]).toHaveTextContent('Taken by Sarah Mitchell · 3m');
    expect(rows[1]).not.toHaveTextContent('Overdue');
    expect(rows[2]).toHaveTextContent('Awaiting the carrier');
    expect(screen.getAllByText('Overdue')).toHaveLength(1);
  });
});
