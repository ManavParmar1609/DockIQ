import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

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

function setup(line: OrderItem) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(keys.order(ORDER.id), { ...ORDER, items: [line] });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useCounter(ORDER.id), { wrapper });
  const sent = () => client.getMutationCache().findAll({ mutationKey: keys.count(ORDER.id) }).length;
  const current = () => client.getQueryData<OrderDetail>(keys.order(ORDER.id))?.items[0];
  return { client, result, sent, current };
}

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
