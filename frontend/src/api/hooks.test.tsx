import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from './client';
import {
  applyWrite,
  countQueueState,
  queuedWrites,
  resetCountQueue,
  withQueuedWrites,
  type CountWrite,
} from './countQueue';
import { invalidateOrders, keys, useCounter } from './hooks';
import type { OrderDetail, OrderItem } from './types';

const LINE: OrderItem = {
  id: 1,
  order_id: 11,
  product_id: 1,
  expected_quantity: 20,
  actual_quantity: 0,
  verified: false,
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
};

const ORDER: OrderDetail = {
  id: 11,
  order_number: 'SO-1011',
  type: 'inbound',
  company_id: 1,
  carrier_id: 1,
  trailer_number: 'TR-4410',
  bol_number: 'BOL-1',
  dock_door_id: 4,
  operator_id: 2,
  status: 'in_progress',
  seal_number: null,
  notes: null,
  created_at: new Date().toISOString(),
  completed_at: null,
  company_name: 'Crestline Markets',
  company_tier: 1,
  count_tolerance: 0,
  load_pattern: {},
  sop_rules: {},
  carrier_name: 'Polar Freight',
  operator_name: 'Maria Lopez',
  door_number: 4,
  items: [LINE],
  completion_blockers: [],
};

const SECOND: OrderItem = { ...LINE, id: 2, product_id: 2, sku: 'RF-200', product_name: 'Whole milk' };

/** An openapi-fetch result the client's `unwrap` accepts. */
const ok = (data: unknown = { status: 'ok' }) => ({ data, response: { ok: true, status: 200 } }) as never;
const refusal = (status: number, detail: string) =>
  ({ error: { detail }, response: { ok: false, status } }) as never;
const unreachable = () => Promise.reject(new TypeError('Failed to fetch'));

function bodies(put: { mock: { calls: unknown[][] } }) {
  return put.mock.calls.map((call) => (call[1] as { body: unknown }).body);
}

function setup(...lines: OrderItem[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(keys.order(ORDER.id), { ...ORDER, items: lines });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useCounter(ORDER.id), { wrapper });
  const sent = () => client.getMutationCache().findAll({ mutationKey: keys.count(ORDER.id) }).length;
  const line = (index = 0) => client.getQueryData<OrderDetail>(keys.order(ORDER.id))?.items[index];
  return { client, result, sent, current: line };
}

beforeEach(() => {
  resetCountQueue();
  localStorage.clear();
  vi.spyOn(api, 'PUT').mockResolvedValue(ok());
  vi.spyOn(api, 'GET').mockReturnValue(new Promise(() => undefined) as never);
});

afterEach(() => {
  resetCountQueue();
  vi.restoreAllMocks();
});

describe('useCounter', () => {
  it('sends "Set 0" on a line never counted, and marks it verified: nothing arrived is a count', () => {
    const { result, sent, current } = setup(LINE);
    act(() => result.current.adjust(LINE.product_id, () => 0));
    expect(sent()).toBe(1);
    expect(current()).toMatchObject({ actual_quantity: 0, verified: true });
  });

  it('sends nothing when a verified count does not change', () => {
    const { result, sent } = setup({ ...LINE, actual_quantity: 5, verified: true });
    act(() => result.current.adjust(LINE.product_id, () => 5));
    expect(sent()).toBe(0);
  });
});

describe('the offline count queue', () => {
  it('keeps counts that could not be sent, and replays them in order on reconnect', async () => {
    const put = vi.spyOn(api, 'PUT').mockImplementation(unreachable);
    const { result, current } = setup(LINE, SECOND);

    act(() => result.current.adjust(1, (count) => count + 5));
    await waitFor(() => expect(countQueueState(ORDER.id).stalled).not.toBeNull());
    act(() => result.current.adjust(2, (count) => count + 3));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(countQueueState(ORDER.id).stalled).not.toBeNull());

    // Nothing lost: both are queued (and persisted), and the screen already shows them.
    expect(queuedWrites(ORDER.id)).toBe(2);
    expect(localStorage.getItem('dockiq.count-queue')).toContain('"actual_quantity":3');
    expect(current(0)?.actual_quantity).toBe(5);
    expect(current(1)?.actual_quantity).toBe(3);

    put.mockClear();
    put.mockResolvedValue(ok());
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(queuedWrites(ORDER.id)).toBe(0));
    expect(bodies(put)).toEqual([
      { product_id: 1, actual_quantity: 5 },
      { product_id: 2, actual_quantity: 3 },
    ]);
    expect(countQueueState(ORDER.id).stalled).toBeNull();
  });

  it('drops a count the server refuses, and says why', async () => {
    vi.spyOn(api, 'PUT').mockResolvedValue(refusal(403, 'This order is complete'));
    const { result } = setup(LINE);
    act(() => result.current.adjust(1, (count) => count + 1));
    await waitFor(() => expect(queuedWrites(ORDER.id)).toBe(0));
    expect(result.current.error?.message).toBe('This order is complete');
  });

  it('lays unsent counts over a refetched order, so a refetch never undoes a tap', () => {
    vi.spyOn(api, 'PUT').mockImplementation(unreachable);
    const { result } = setup(LINE);
    act(() => result.current.adjust(1, () => 12));
    expect(withQueuedWrites({ ...ORDER, items: [LINE] }).items[0]?.actual_quantity).toBe(12);
  });

  it('applies a load step exactly once, as the server does', () => {
    const step: CountWrite = { kind: 'step', step: 2, count: true, sku: 'FZ-100', cases: 8 };
    const before = { ...ORDER, load_step: 1, items: [LINE] };
    const after = applyWrite(before, step);
    expect(after.items[0]).toMatchObject({ actual_quantity: 8, verified: true });
    expect(after.load_step).toBe(2);
    // The server already took it: replaying it over the refetched order changes nothing.
    expect(applyWrite(after, step).items[0]?.actual_quantity).toBe(8);
    // Back one step takes the pallet off again.
    const back: CountWrite = { kind: 'step', step: 1, count: true, sku: 'FZ-100', cases: 8 };
    expect(applyWrite(after, back).items[0]).toMatchObject({ actual_quantity: 0, verified: false });
  });
});

describe('invalidateOrders', () => {
  it('spares the order detail while its counter has taps queued', () => {
    const { client, result } = setup(LINE);
    client.setQueryData(keys.orders, []);
    act(() => result.current.adjust(LINE.product_id, (count) => count + 1));
    // Checked synchronously, while the tap is still in flight.
    void invalidateOrders(client);
    expect(client.getQueryState(keys.order(ORDER.id))?.isInvalidated).toBe(false);
    expect(client.getQueryState(keys.orders)?.isInvalidated).toBe(true);
  });
});
