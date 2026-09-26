import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { keys } from '../../api/hooks';
import { issue, minutesAgo, renderAs } from '../../test/fixtures';
import QualityBoard from './QualityBoard';

function section(name: string): HTMLElement {
  const panel = screen.getByRole('heading', { name }).closest('section');
  if (!panel) throw new Error(`No section titled ${name}`);
  return panel;
}

describe('Quality board', () => {
  it("splits Quality's work into what awaits a disposition, temperature and other critical", () => {
    renderAs('quality', <QualityBoard />, {
      seed: (client) =>
        client.setQueryData(keys.issueList({ limit: 300 }), [
          issue({
            id: 1,
            issue_type: 'Temperature Deviation',
            issue_subtype: 'Product temperature out of range',
            severity: 'critical',
            held_pallets: ['LPN-1', 'LPN-2', 'LPN-3'],
            temp_reading: 14,
            temp_limit: 0,
          }),
          issue({ id: 2, issue_type: 'Temperature Deviation', issue_subtype: 'Reefer set wrong' }),
          issue({ id: 3, issue_type: 'Seal Issue', issue_subtype: 'Seal broken', severity: 'critical' }),
          issue({
            id: 4,
            issue_subtype: 'Already closed',
            status: 'supervisor_resolved',
            resolved_at: minutesAgo(5),
          }),
        ]),
    });

    const awaiting = section('Awaiting your disposition');
    expect(within(awaiting).getByText('Product temperature out of range')).toBeInTheDocument();
    expect(within(awaiting).getByText(/Awaiting your disposition · 3 pallets held/)).toBeInTheDocument();
    expect(within(awaiting).getByText('14°F / 0°F')).toBeInTheDocument();
    expect(within(section('Temperature')).getByText('Reefer set wrong')).toBeInTheDocument();
    expect(within(section('Other critical')).getByText('Seal broken')).toBeInTheDocument();
    expect(screen.queryByText('Already closed')).not.toBeInTheDocument();
    expect(screen.queryByText(/nobody has taken it/)).not.toBeInTheDocument();
  });
});
