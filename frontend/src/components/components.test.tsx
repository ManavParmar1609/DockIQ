import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { Severity } from '../api/types';
import { SAMPLE_PLAN } from '../pages/landing/samplePlan';
import { LoadPlanView } from './LoadPlanView';
import { PalletList } from './PalletList';
import { ConfidenceMeter, SeverityBadge } from './Severity';

describe('SeverityBadge', () => {
  it.each<[Severity, string]>([
    ['critical', 'Critical'],
    ['high', 'High'],
    ['medium', 'Medium'],
    ['low', 'Low'],
  ])('renders %s with its label, never colour alone', (severity, label) => {
    render(<SeverityBadge severity={severity} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('reserves the red fill for critical', () => {
    const { rerender } = render(<SeverityBadge severity="critical" />);
    expect(screen.getByText('Critical').className).toContain('bg-hazard');
    rerender(<SeverityBadge severity="high" />);
    expect(screen.getByText('High').className).not.toContain('hazard');
  });
});

describe('ConfidenceMeter', () => {
  it('is its own channel: labelled, and never uses the severity palette', () => {
    const { container } = render(<ConfidenceMeter confidence="medium" />);
    expect(screen.getByLabelText('Match confidence medium')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('hazard');
  });
});

describe('LoadPlanView', () => {
  it('pictures the next spot and steps through the load in order', async () => {
    render(<LoadPlanView plan={SAMPLE_PLAN} />);
    expect(
      screen.getByRole('img', { name: /Looking into the trailer from the dock door\. Pallet 1,/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Slip sheet between every layer')).toBeInTheDocument();
    expect(screen.getByText(/Load step/)).toHaveTextContent(`Load step 1 of ${SAMPLE_PLAN.total_pallets}`);

    await userEvent.click(screen.getByRole('button', { name: /Loaded, next pallet/ }));
    expect(screen.getByText(/Load step/)).toHaveTextContent('Load step 2 of');
    expect(screen.getByRole('button', { name: 'Previous step' })).toBeEnabled();
  });

  it('draws one tappable stack per used floor position', () => {
    render(<LoadPlanView plan={SAMPLE_PLAN} />);
    expect(screen.getAllByRole('button', { name: /^Row \d+ (left|right):/ })).toHaveLength(
      SAMPLE_PLAN.stacks_used,
    );
  });
});

describe('PalletList', () => {
  it('marks only the first-expiring pallet as the one to pick', () => {
    render(
      <PalletList
        pallets={[
          { pallet_id: 'P1', location: 'F-12-B04-2', cases: 40, lot: 'L2611A', best_before: '2026-11-02' },
          { pallet_id: 'P2', location: 'F-12-B09-1', cases: 40, lot: 'L2640B', best_before: '2027-03-15' },
        ]}
      />,
    );
    expect(screen.getAllByText('Pick first')).toHaveLength(1);
    expect(screen.getByText(/lot L2611A · best before 2 Nov 2026/)).toBeInTheDocument();
  });
});
