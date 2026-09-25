import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';

import { keys } from '../api/hooks';
import type { Dock, Issue, OrderDetail } from '../api/types';
import { DockFloor } from './DockFloor';

// jsdom has <dialog> but not its modal API.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
  };
});

const NOW = new Date().toISOString();

const ACTIVE: Dock = {
  id: 4,
  door_number: 4,
  zone: 'Frozen',
  status: 'issue',
  lifecycle_phase: 'loading',
  current_trailer: 'TR-4410',
  current_order_id: 11,
  current_operator_id: 2,
  trailer_arrived_at: NOW,
  last_activity_at: NOW,
  operator_name: 'Maria Lopez',
  order_number: 'SO-1011',
  trailer_number: 'TR-4410',
  company_name: 'Crestline Markets',
  order_type: 'outbound',
  cases_done: 12,
  cases_expected: 20,
};

const IDLE: Dock = {
  ...ACTIVE,
  id: 5,
  door_number: 5,
  status: 'idle',
  lifecycle_phase: 'idle',
  current_trailer: null,
  current_order_id: null,
  current_operator_id: null,
  trailer_arrived_at: null,
  operator_name: null,
  order_number: null,
  trailer_number: null,
  company_name: null,
  order_type: null,
};

const ORDER: OrderDetail = {
  id: 11,
  order_number: 'SO-1011',
  type: 'outbound',
  company_id: 1,
  carrier_id: 1,
  trailer_number: 'TR-4410',
  bol_number: 'BOL-1',
  dock_door_id: 4,
  operator_id: 2,
  status: 'in_progress',
  seal_number: null,
  notes: null,
  created_at: NOW,
  completed_at: null,
  company_name: 'Crestline Markets',
  company_tier: 1,
  count_tolerance: 0,
  load_pattern: {},
  sop_rules: {},
  carrier_name: 'Polar Freight',
  operator_name: 'Maria Lopez',
  door_number: 4,
  items: [
    {
      id: 1,
      order_id: 11,
      product_id: 1,
      expected_quantity: 20,
      actual_quantity: 12,
      verified: true,
      sku: 'FZ-100',
      gtin: null,
      product_name: 'Frozen peas',
      category: 'Frozen',
      weight_per_case: 20,
      cases_per_pallet: 40,
      temp_min: null,
      temp_max: 0,
      is_allergen: false,
      lot_tracking_required: false,
      case_value: 30,
    },
  ],
  completion_blockers: [],
};

const ISSUE: Issue = {
  id: 7,
  order_id: 11,
  dock_door_id: 4,
  operator_id: 2,
  supervisor_id: null,
  issue_type: 'Damaged product',
  issue_subtype: 'Crushed cases',
  description: null,
  quick_tags: [],
  severity: 'high',
  severity_score: 12,
  severity_reason: null,
  status: 'escalated',
  ai_resolution: null,
  recurring_patterns: [],
  ai_confidence: null,
  resolution_type: null,
  resolution_notes: null,
  supervisor_notes: null,
  product_id: 1,
  company_id: 1,
  carrier_id: 1,
  estimated_cost_impact: 0,
  escalated_at: NOW,
  acknowledged_at: null,
  resolved_at: null,
  created_at: NOW,
  operator_name: 'Maria Lopez',
  supervisor_name: null,
  door_number: 4,
  company_name: 'Crestline Markets',
  product_name: 'Frozen peas',
  product_sku: 'FZ-100',
  carrier_name: 'Polar Freight',
  photo_count: 0,
};

function Floor({ docks }: { docks: Dock[] }) {
  const [door, setDoor] = useState<number | null>(null);
  return <DockFloor docks={docks} selectedDoor={door} onOpen={setDoor} onClose={() => setDoor(null)} />;
}

function renderFloor(docks: Dock[]) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(keys.order(ORDER.id), ORDER);
  client.setQueryData(keys.issueList({ status: 'active' }), [ISSUE]);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Floor docks={docks} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DockSheet', () => {
  it('opens from a tile with the dock as its name, and closes on Escape back to the tile', async () => {
    const user = userEvent.setup();
    renderFloor([ACTIVE, IDLE]);

    const tile = screen.getByRole('button', {
      name: /^Dock 4, issue, Maria Lopez, 60% counted, open details$/,
    });
    await user.click(tile);

    const sheet = screen.getByRole('dialog', { name: 'Dock 4' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(screen.getByText('12 / 20 cases · 60%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Cases counted' })).toHaveAttribute('aria-valuenow', '60');
    expect(screen.getByRole('link', { name: /Crushed cases/ })).toHaveAttribute('href', '/app/issues/7');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('heading', { name: 'Dock 4' })).not.toBeInTheDocument();
    expect(tile).toHaveFocus();
  });

  it('shows an idle door as an empty state', async () => {
    const user = userEvent.setup();
    renderFloor([ACTIVE, IDLE]);

    await user.click(screen.getByRole('button', { name: /^Dock 5, idle.*open details$/ }));
    expect(screen.getByRole('dialog', { name: 'Dock 5' })).toBeInTheDocument();
    expect(screen.getByText('This door is idle')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('heading', { name: 'Dock 5' })).not.toBeInTheDocument();
  });
});
