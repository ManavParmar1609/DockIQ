import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { SelfResolveDraft } from '../api/assistant';
import { keys } from '../api/hooks';
import type { Taxonomy } from '../api/types';
import { AgentActionView, AgentCardView } from './AssistantCards';

const TAXONOMY: Taxonomy = {
  issue_types: [],
  operator_resolutions: ['Manual Entry', 'Product Segregated', 'Other'],
  supervisor_decisions: [],
  request_types: [],
};

const DRAFT: SelfResolveDraft = {
  kind: 'self_resolve',
  issue_id: 42,
  title: 'Barcode will not scan',
  severity: 'low',
  resolution_type: null,
  resolution_notes: 'Resolved by the operator, confirmed in the assistant',
};

function renderWith(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(keys.taxonomy, TAXONOMY);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Self-resolve draft', () => {
  it('offers the taxonomy resolutions and waits for the worker to pick one', async () => {
    const user = userEvent.setup();
    renderWith(<AgentActionView action={DRAFT} />);
    expect(screen.getByText('Draft resolution · not resolved yet')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /Resolve issue #42/ });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Manual Entry' }));
    expect(screen.getByRole('button', { name: 'Manual Entry' })).toHaveAttribute('aria-pressed', 'true');
    expect(confirm).toBeEnabled();
  });

  it('preselects what the assistant heard, and can be discarded', async () => {
    const user = userEvent.setup();
    renderWith(<AgentActionView action={{ ...DRAFT, resolution_type: 'Product Segregated' }} />);
    expect(screen.getByRole('button', { name: 'Product Segregated' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: /Discard/ }));
    expect(screen.getByText('Draft resolution discarded.')).toBeInTheDocument();
  });
});

describe('Self-resolve draft on an escalated issue', () => {
  it('asks the worker for their own note before it can be confirmed', async () => {
    const user = userEvent.setup();
    renderWith(
      <AgentActionView
        action={{ ...DRAFT, resolution_type: 'Manual Entry', resolution_notes: '', note_required: true }}
      />,
    );
    const confirm = screen.getByRole('button', { name: /Resolve issue #42/ });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Note for the record/), 'Typed the code in by hand');
    expect(confirm).toBeEnabled();
  });
});

describe('Cold rooms card', () => {
  it('names an alarm in words, not colour alone, and marks simulated data', () => {
    renderWith(
      <AgentCardView
        card={{
          kind: 'rooms',
          wms_online: true,
          simulated: true,
          rooms: [
            {
              code: 'P',
              name: 'Produce',
              temp: 50.2,
              limit: 45,
              setpoint: 38,
              over_limit: true,
              alarm: true,
              on_hold_cases: 0,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('Alarm')).toBeInTheDocument();
    expect(screen.getByText('Simulated data')).toBeInTheDocument();
  });
});
