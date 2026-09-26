import { screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { keys } from '../../api/hooks';
import type { Analytics as Summary } from '../../api/types';
import { renderAs } from '../../test/fixtures';
import Analytics from './Analytics';

beforeAll(() => {
  // Recharts measures its container; jsdom has no layout.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const SUMMARY: Summary = {
  scope: 'quality',
  total_issues: 12,
  self_resolved: 4,
  escalated: 6,
  self_resolution_rate: 33.3,
  total_cost_impact: 900,
  avg_resolution_minutes: 42,
  open_issues: 5,
  open_critical: 2,
  open_cost_impact: 300,
  cold_chain_breaches: 3,
  cold_chain_open: 1,
  by_type: [{ issue_type: 'Temperature Deviation', count: 3, cost_impact: 600 }],
  by_severity: [{ severity: 'critical', count: 3, open: 2, avg_resolution_minutes: null }],
  by_type_severity: [{ issue_type: 'Temperature Deviation', severity: 'critical', count: 2 }],
  by_dock: [{ door_number: 4, count: 3, open: 1 }],
  by_operator: [],
  by_company: [],
  by_carrier: [{ name: 'Polar Freight', carrier_id: 7, count: 3 }],
  over_time: [],
  repeat_at_doors: [],
  repeat_with_carriers: [],
  quality: {
    avg_minutes_to_disposition: 95,
    disposed: 6,
    by_disposition: [
      { disposition: 'destroy', count: 2 },
      { disposition: 'release', count: 4 },
    ],
    pallets_on_hold: 5,
    issues_on_hold: 2,
    excursions_by_room: [{ room: 'F', count: 1 }],
  },
};

function renderAnalytics() {
  return renderAs('quality', <Analytics />, {
    path: '/app/analytics?range=all',
    seed: (client) => client.setQueryData(keys.analyticsRange({}), SUMMARY),
  });
}

describe('Analytics drill-down', () => {
  it('opens the issue log behind each figure, with the log’s own filters', () => {
    renderAnalytics();
    expect(screen.getByRole('link', { name: 'Open critical: open in the issue log' })).toHaveAttribute(
      'href',
      '/app/log?status=active&severity=critical',
    );
    expect(
      screen.getByRole('link', { name: 'Temperature Deviation, Critical: 2 — open in the issue log' }),
    ).toHaveAttribute('href', '/app/log?type=Temperature+Deviation&severity=critical');
    expect(screen.getByRole('link', { name: 'Polar Freight: open in the issue log' })).toHaveAttribute(
      'href',
      '/app/log?carrier=7',
    );
    expect(screen.getByRole('link', { name: 'Dock 4' })).toHaveAttribute('href', '/app/log?dock=4');
  });

  it('shows Quality its disposition figures, each opening its issues', () => {
    renderAnalytics();
    const held = screen.getByRole('link', { name: 'Pallets on hold: open in the issue log' });
    expect(held).toHaveAttribute('href', '/app/log?disposition=hold');
    expect(within(held).getByText('5')).toBeInTheDocument();
    // The stat and its bar in the split both open the destroyed issues.
    const destroyed = screen.getAllByRole('link', { name: 'Destroyed: open in the issue log' });
    expect(destroyed[0]).toHaveTextContent('of 6 decided');
    for (const link of destroyed) expect(link).toHaveAttribute('href', '/app/log?disposition=destroy');
    expect(screen.getByRole('link', { name: 'Released: open in the issue log' })).toHaveAttribute(
      'href',
      '/app/log?disposition=release',
    );
    expect(screen.getByRole('link', { name: 'Room F: open in the issue log' })).toHaveAttribute(
      'href',
      '/app/log?type=Temperature+Deviation&q=Room+F',
    );
  });
});
