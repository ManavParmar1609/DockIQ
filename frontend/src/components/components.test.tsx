import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { Severity } from '../api/types';
import { SAMPLE_PLAN } from '../pages/landing/samplePlan';
import { LoadPlanView } from './LoadPlanView';
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

  it('reserves the hazard fill for critical', () => {
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
  it('shows the customer rules and steps through the load in order', async () => {
    render(<LoadPlanView plan={SAMPLE_PLAN} />);
    expect(screen.getByText('Crestline Markets loading rules')).toBeInTheDocument();
    expect(screen.getByText('Slip sheet between every layer')).toBeInTheDocument();
    expect(screen.getByText(/Load step/)).toHaveTextContent(`01 of ${SAMPLE_PLAN.total_pallets}`);

    await userEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByText(/Load step/)).toHaveTextContent('02');
    expect(screen.getByRole('button', { name: 'Previous step' })).toBeEnabled();
  });

  it('draws one tappable stack per used floor position', () => {
    render(<LoadPlanView plan={SAMPLE_PLAN} />);
    expect(screen.getAllByRole('button', { name: /^Row \d+ (left|right):/ })).toHaveLength(
      SAMPLE_PLAN.stacks_used,
    );
  });
});
