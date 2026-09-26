import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api/client';
import { resetCountQueue } from '../../api/countQueue';
import { keys } from '../../api/hooks';
import type { OrderDetail, ReceivingChecks, Taxonomy } from '../../api/types';
import OrderWork from './OrderWork';
import ReportIssue from './ReportIssue';

const ok = (data: unknown) => ({ data, response: { ok: true, status: 200 } }) as never;
const unreachable = () => Promise.reject(new TypeError('Failed to fetch'));

const PALLETS = {
  id: 'pallets',
  question: 'Pallets intact?',
  issue_type: 'Damaged Pallet',
  issue_subtype: 'Damaged or broken pallet',
};
const LABELS = {
  id: 'labels',
  question: 'Labels readable and matching?',
  issue_type: 'Barcode Issue',
  issue_subtype: 'Barcode damaged or unreadable',
};
const CHECKS = [PALLETS, LABELS];

const TAXONOMY: Taxonomy = {
  issue_types: [
    {
      name: 'Damaged Pallet',
      group: 'product',
      icon: 'package',
      weight: 3,
      subtypes: ['Damaged or broken pallet'],
      quality_relevant: false,
      floor: {},
    },
    {
      name: 'Safety Incident',
      group: 'people',
      icon: 'hard-hat',
      weight: 5,
      subtypes: ['Slip or trip hazard'],
      quality_relevant: false,
      floor: {},
    },
  ],
  operator_resolutions: ['Corrected and Continued'],
  supervisor_decisions: [],
  request_types: [],
  receiving_checks: CHECKS,
};

const ORDER: OrderDetail = {
  id: 2,
  order_number: 'RCV-2002',
  type: 'inbound',
  company_id: 1,
  carrier_id: 1,
  trailer_number: 'TR-2002',
  bol_number: 'BOL-2002',
  dock_door_id: 3,
  operator_id: 2,
  status: 'in_progress',
  seal_number: null,
  notes: null,
  created_at: new Date().toISOString(),
  completed_at: null,
  company_name: 'Bulkhaven',
  company_tier: 2,
  count_tolerance: 0.03,
  load_pattern: {},
  sop_rules: {},
  carrier_name: 'Polar Freight',
  operator_name: 'Lisa Chen',
  door_number: 3,
  items: [
    {
      id: 21,
      order_id: 2,
      product_id: 7,
      expected_quantity: 40,
      actual_quantity: 40,
      verified: true,
      sku: 'BLK-FZ-2001',
      gtin: null,
      product_name: 'Atlantic salmon',
      category: 'Frozen',
      weight_per_case: 30,
      cases_per_pallet: 20,
      temp_min: null,
      temp_max: 0,
      is_allergen: false,
      lot_tracking_required: true,
      case_value: 90,
    },
  ],
  completion_blockers: [],
  load_step: null,
};

const SAVED: ReceivingChecks = {
  order_id: 2,
  checks: [
    { ...PALLETS, answer: true, answered_at: new Date().toISOString(), answered_by_name: 'Lisa Chen' },
    { ...LABELS, answer: null, answered_at: null, answered_by_name: null },
  ],
  all_answered: false,
  probes: 1,
  needs_probe: true,
};

function renderWith(node: ReactNode, seed: (client: QueryClient) => void, path = '/app/order') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(keys.taxonomy, TAXONOMY);
  seed(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

/** The list row holding a check's question. */
function rowOf(text: string): HTMLElement {
  const row = screen.getByText(text).closest('li');
  if (!row) throw new Error(`No row for ${text}`);
  return row;
}

function seedOrder(client: QueryClient) {
  client.setQueryData([...keys.orders, 'in_progress'], [ORDER]);
  client.setQueryData(keys.order(ORDER.id), ORDER);
  client.setQueryData(keys.temperatureLog(ORDER.id), []);
  client.setQueryData(keys.receivingChecks(ORDER.id), SAVED);
}

beforeEach(() => {
  resetCountQueue();
  localStorage.clear();
  // Anything not seeded stays loading: no test reaches a real server.
  vi.spyOn(api, 'GET').mockReturnValue(new Promise(() => undefined) as never);
});

afterEach(() => {
  resetCountQueue();
  vi.restoreAllMocks();
});

describe('Order work — offline counting', () => {
  it('holds sign-off while a count is unsent, and releases it once the count is delivered', async () => {
    const user = userEvent.setup();
    const put = vi.spyOn(api, 'PUT').mockImplementation(unreachable);
    renderWith(<OrderWork />, seedOrder);

    await user.click(screen.getByRole('tab', { name: /Scan & count/ }));
    await user.click(screen.getByRole('button', { name: /^5$/ }));
    await waitFor(() => expect(screen.getByText('1 count not sent yet')).toBeInTheDocument());

    await user.click(screen.getByRole('tab', { name: /Sign-off/ }));
    const confirm = screen.getByRole('button', { name: 'Confirm receiving complete' });
    expect(confirm).toBeDisabled();

    put.mockResolvedValue(ok({ status: 'ok' }));
    await user.click(screen.getByRole('button', { name: /Send now/ }));
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(screen.queryByText(/not sent yet/)).not.toBeInTheDocument();
  });
});

describe('Order work — receiving checks', () => {
  it('restores the saved answers and saves a new one to the server', async () => {
    const user = userEvent.setup();
    const put = vi.spyOn(api, 'PUT').mockResolvedValue(
      ok({
        ...SAVED,
        checks: [SAVED.checks[0], { ...SAVED.checks[1], answer: false, answered_by_name: 'Lisa Chen' }],
      }),
    );
    renderWith(<OrderWork />, seedOrder);
    await user.click(screen.getByRole('tab', { name: /Checks/ }));

    const pallets = rowOf('Pallets intact?');
    expect(within(pallets).getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(pallets).getByText(/Lisa Chen/)).toBeInTheDocument();

    const labels = rowOf('Labels readable and matching?');
    await user.click(within(labels).getByRole('button', { name: 'No' }));
    expect(put).toHaveBeenCalledWith(
      '/api/orders/{order_id}/receiving-checks',
      expect.objectContaining({ body: { answers: { labels: false } } }),
    );
    await waitFor(() =>
      expect(within(labels).getByRole('button', { name: 'No' })).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(within(labels).getByRole('link', { name: /Report/ })).toBeInTheDocument();
  });
});

describe('Report without an assignment', () => {
  const noOrder = (client: QueryClient) => {
    client.setQueryData([...keys.orders, 'in_progress'], []);
    client.setQueryData(keys.docks, [{ id: 3, door_number: 3 }]);
  };

  it('offers people and systems issues, and files one without an order', async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api, 'POST').mockReturnValue(new Promise(() => undefined));
    renderWith(<ReportIssue />, noOrder, '/app/report');

    expect(screen.getByText('No trailer assigned')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Damaged Pallet/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Safety Incident/ }));
    await user.click(screen.getByRole('radio', { name: 'Slip or trip hazard' }));
    await user.selectOptions(screen.getByLabelText('Dock'), '3');
    await user.click(screen.getByRole('button', { name: /Submit and get the procedure/ }));

    const calls = post.mock.calls as unknown as unknown[][];
    const call = calls[0] ?? [];
    expect(call[0]).toBe('/api/issues');
    expect((call[1] as { body?: unknown } | undefined)?.body).toMatchObject({
      order_id: null,
      dock_door_id: 3,
      issue_type: 'Safety Incident',
      company_id: null,
      quantity_affected: null,
    });
  });

  it('goes back from a pre-filled report to the types, keeping what was typed', async () => {
    const user = userEvent.setup();
    renderWith(<ReportIssue />, noOrder, '/app/report?type=Safety%20Incident&description=Wet%20floor');

    expect(screen.getByLabelText('Description')).toHaveValue('Wet floor');
    await user.click(screen.getByRole('button', { name: /Type/ }));
    expect(screen.getByRole('button', { name: /Safety Incident/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Safety Incident/ }));
    expect(screen.getByLabelText('Description')).toHaveValue('Wet floor');
  });
});
