/** Shared test data and a signed-in render for the staff screens. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';

import { session } from '../api/client';
import { keys } from '../api/hooks';
import type { Issue, Me, Role, Taxonomy } from '../api/types';
import { AuthProvider } from '../auth/AuthProvider';
import { LocationProbe } from './LocationProbe';

export const NOW = new Date().toISOString();

export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 7,
    order_id: 11,
    dock_door_id: 4,
    operator_id: 2,
    supervisor_id: null,
    issue_type: 'Damaged Pallet',
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
    ...overrides,
  };
}

const PEOPLE: Record<Role, Me> = {
  operator: {
    id: 2,
    name: 'Maria Lopez',
    role: 'operator',
    employee_id: 'OP-002',
    shift: 'day',
    zone: 'Zone A',
    experience_level: null,
    supervisor_id: 9,
    supervisor_name: 'Sarah Mitchell',
  },
  supervisor: {
    id: 9,
    name: 'Sarah Mitchell',
    role: 'supervisor',
    employee_id: 'SUP-001',
    shift: 'day',
    zone: 'Zone A',
    experience_level: null,
    supervisor_id: null,
    supervisor_name: null,
  },
  quality: {
    id: 12,
    name: 'Dana Whitfield',
    role: 'quality',
    employee_id: 'QA-001',
    shift: 'day',
    zone: null,
    experience_level: null,
    supervisor_id: null,
    supervisor_name: null,
  },
};

export const TAXONOMY: Taxonomy = {
  issue_types: [],
  operator_resolutions: ['Partial Accept'],
  supervisor_decisions: ['Accept', 'Full Reject', 'Contact Carrier', 'Request Re-inspection'],
  request_types: ['Pallet jack'],
  accept_decisions: ['Accept'],
  pending_decisions: ['Contact Carrier', 'Request Re-inspection'],
  noted_decisions: ['Full Reject'],
  decision_targets: { critical: 15, high: 60, medium: 240, low: 480 },
  pending_actions: {
    'Contact Carrier': 'Awaiting the carrier',
    'Request Re-inspection': 'Awaiting a re-inspection',
  },
  cold_chain_issue_types: ['Temperature Deviation'],
  receiving_checks: [],
};

/**
 * Render `ui` at `path` (matched by `route`) as a signed-in `role`, with the query cache prepared by
 * `seed`. Nothing reaches the network: queries without seeded data fail fast.
 */
export function renderAs(
  role: Role,
  ui: ReactNode,
  {
    path = '/',
    route = '*',
    seed,
  }: { path?: string; route?: string; seed?: (client: QueryClient) => void } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } },
  });
  session.set('test-token');
  client.setQueryData(['me'], PEOPLE[role]);
  client.setQueryData(keys.taxonomy, TAXONOMY);
  seed?.(client);
  const result = render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path={route}
              element={
                <>
                  {ui}
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...result, client };
}
