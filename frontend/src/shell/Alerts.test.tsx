import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { keys } from '../api/hooks';
import type { Issue, QuickRequest, Role } from '../api/types';
import { issue, minutesAgo } from '../test/fixtures';
import { alertFor, pendingAlerts, requestAlert, useAlerts } from './Alerts';

const REQUEST: QuickRequest = {
  id: 31,
  dock_door_id: 4,
  operator_id: 2,
  request_type: 'Pallet jack',
  details: 'Left fork bent',
  status: 'pending',
  created_at: minutesAgo(1),
  fulfilled_at: null,
  operator_name: 'Maria Lopez',
  door_number: 4,
};

function hook(role: Role, open: Issue[]) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(keys.issueList({ status: 'active' }), open);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useAlerts(role), { wrapper });
}

beforeEach(() => {
  sessionStorage.clear();
});

describe('alerts are rebuilt from what is still open', () => {
  const waiting = issue({ id: 1, severity: 'critical', status: 'escalated' });
  const taken = issue({
    id: 2,
    severity: 'high',
    acknowledged_at: minutesAgo(2),
    acknowledged_by_name: 'Sam',
  });
  const working = issue({ id: 3, severity: 'medium', status: 'resolution_in_progress', escalated_at: null });

  it('gives a supervisor every escalated issue nobody has taken', () => {
    const alerts = pendingAlerts([waiting, taken, working], 'supervisor');
    expect(alerts.map((alert) => alert.key)).toEqual(['issue-1']);
    expect(alerts[0]).toMatchObject({ kicker: 'Escalated to you', sticky: true });
  });

  it('gives Quality what is held and undecided, worded as a review', () => {
    const held = issue({ id: 1, severity: 'critical', held_pallets: ['LPN-1'] });
    const disposed = issue({ id: 4, severity: 'critical', held_pallets: ['LPN-2'], disposition: 'hold' });
    const alerts = pendingAlerts([held, disposed, taken], 'quality');
    expect(alerts.map((alert) => alert.key)).toEqual(['issue-1']);
    expect(alerts[0]?.kicker).toBe('For your review');
  });

  it('names the room and the reading for a cold-room excursion, and keeps it until dismissed', () => {
    const room = issue({ id: 5, room: 'Freezer F1', temp_reading: 12, temp_limit: 0, severity: 'critical' });
    expect(pendingAlerts([room], 'supervisor')[0]).toMatchObject({
      title: 'Freezer F1 at 12°F',
      detail: 'Limit 0°F',
      sticky: true,
    });
  });

  it('shows the rebuilt alerts on load, and a dismissal survives a reload', () => {
    const first = hook('supervisor', [waiting, taken]);
    expect(first.result.current.alerts.map((alert) => alert.key)).toEqual(['issue-1']);
    expect(first.result.current.urgent).toBe(1);
    expect(first.result.current.unseen).toBe(1);
    act(() => first.result.current.dismiss('issue-1'));
    expect(first.result.current.alerts).toEqual([]);
    // Dismissed alerts stay in the inbox.
    expect(first.result.current.inbox.map((alert) => alert.key)).toEqual(['issue-1']);

    const again = hook('supervisor', [waiting, taken]);
    expect(again.result.current.alerts).toEqual([]);
  });

  it('shows several waiting issues as one card, while the tab title counts each critical', () => {
    const second = issue({ id: 8, severity: 'critical', status: 'escalated' });
    const third = issue({ id: 9, severity: 'high', status: 'escalated' });
    const { result } = hook('supervisor', [waiting, second, third]);
    expect(result.current.alerts).toHaveLength(1);
    expect(result.current.alerts[0]).toMatchObject({
      title: '3 escalated issues nobody has taken',
      detail: '2 critical · open your alerts for the list',
      severity: 'critical',
      sticky: false,
    });
    expect(result.current.urgent).toBe(2);
    expect(result.current.inbox).toHaveLength(3);
  });

  it('withdraws an alert once someone has taken the issue', () => {
    const { result } = hook('supervisor', [waiting]);
    expect(result.current.alerts).toHaveLength(1);
    const next = hook('supervisor', [{ ...waiting, acknowledged_at: minutesAgo(0) }]);
    expect(next.result.current.alerts).toEqual([]);
  });
});

describe('request alerts', () => {
  it('tells the supervisor what was asked, by whom and where', () => {
    const alert = requestAlert(
      { type: 'new_request', request_id: 31, request_type: 'Pallet jack', status: 'pending' },
      'supervisor',
      REQUEST,
    );
    expect(alert).toMatchObject({
      kicker: 'New request',
      title: 'Pallet jack from Maria Lopez at Dock 4',
      detail: 'Left fork bent',
    });
  });

  it('tells the operator their request was fulfilled, and nobody else', () => {
    const fulfilled = {
      type: 'new_request',
      request_id: 31,
      request_type: 'Pallet jack',
      status: 'fulfilled',
    } as const;
    expect(requestAlert(fulfilled, 'operator')?.title).toBe('Your Pallet jack request was fulfilled');
    expect(requestAlert(fulfilled, 'supervisor')).toBeNull();
    expect(requestAlert({ ...fulfilled, status: 'pending' }, 'operator')).toBeNull();
  });

  it('reaches the operator through the live channel and the inbox', () => {
    const { result } = hook('operator', []);
    act(() =>
      result.current.onEvent({
        type: 'new_request',
        request_id: 31,
        request_type: 'Pallet jack',
        status: 'fulfilled',
      }),
    );
    expect(result.current.alerts[0]?.title).toBe('Your Pallet jack request was fulfilled');
    expect(result.current.inbox).toHaveLength(1);
  });
});

describe('decisions reach the operator', () => {
  it('says a pending decision leaves the issue open', () => {
    const alert = alertFor(
      { type: 'issue_resolved', issue_id: 9, method: 'on_hold', resolution: 'Contact Carrier' },
      'operator',
    );
    expect(alert).toMatchObject({ kicker: 'Supervisor decided · on hold', title: 'Contact Carrier' });
    expect(alert?.detail).toContain('stays open');
  });
});
