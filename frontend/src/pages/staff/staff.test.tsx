import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';

import { keys } from '../../api/hooks';
import type { HandoffDraft } from '../../api/types';
import { composeHandoff, sectionsFrom } from '../../lib/handoff';
import { issue, minutesAgo, renderAs } from '../../test/fixtures';
import IssueDetail from '../IssueDetail';
import IssueLog from './IssueLog';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
  };
});

const HELD = issue({
  id: 42,
  issue_type: 'Temperature Deviation',
  issue_subtype: 'Product temperature out of range',
  severity: 'critical',
  temp_reading: 14,
  temp_limit: 0,
  lot: 'L-2291',
  order_number: 'SO-1011',
  trailer_number: 'TR-4410',
  bol_number: 'BOL-77',
  held_pallets: ['LPN-000123', 'LPN-000124'],
  simulated: true,
  sim_time: '07:42',
  sim_shift: 1,
});

function renderIssue(role: 'operator' | 'supervisor' | 'quality', overrides = {}) {
  const data = { ...HELD, ...overrides };
  return renderAs(role, <IssueDetail />, {
    path: '/app/issues/42',
    route: '/app/issues/:issueId',
    seed: (client) => client.setQueryData(keys.issue(42), data),
  });
}

function panelTitled(name: string): HTMLElement {
  const section = screen.getByRole('heading', { name }).closest('section');
  if (!section) throw new Error(`No panel titled ${name}`);
  return section;
}

describe('Issue detail: product disposition belongs to Quality', () => {
  it('lets Quality choose a disposition, with notes required', async () => {
    const user = userEvent.setup();
    renderIssue('quality');
    const panel = within(panelTitled('Product disposition'));
    const record = panel.getByRole('button', { name: 'Record disposition' });
    expect(record).toBeDisabled();
    await user.click(panel.getByRole('radio', { name: 'Release' }));
    expect(record).toBeDisabled();
    await user.type(panel.getByLabelText(/Notes for the record/), 'Probed again: 1°F');
    expect(record).toBeEnabled();
  });

  it('shows supervisors the disposition read-only', () => {
    renderIssue('supervisor', {
      disposition: 'hold',
      disposition_by_name: 'Dana Whitfield',
      disposition_at: minutesAgo(3),
    });
    expect(panelTitled('Product disposition')).toHaveTextContent('Dana Whitfield');
    expect(screen.getByText('Quality decides the disposition.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record disposition' })).not.toBeInTheDocument();
  });

  it('never shows it to an operator, nor the supervisor-only instruction', () => {
    renderIssue('operator');
    expect(screen.queryByRole('heading', { name: 'Product disposition' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Go to the dock/)).not.toBeInTheDocument();
  });

  it('lets the reporting operator pick what they did, add a note, and confirm', async () => {
    const user = userEvent.setup();
    renderIssue('operator', {
      severity: 'medium',
      status: 'resolution_in_progress',
      escalated_at: null,
      held_pallets: [],
    });
    const confirm = screen.getByRole('button', { name: 'Yes — mark it resolved' });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Partial Accept' }));
    await user.type(screen.getByLabelText(/Note for the record/), 'Restacked two cases');
    expect(confirm).toBeEnabled();
    expect(screen.getByRole('button', { name: /No — escalate to my supervisor/ })).toBeInTheDocument();
  });

  it('keeps the record as reported: reading against limit, lot, BOL, held pallets, simulated time', () => {
    renderIssue('supervisor');
    expect(screen.getByText('Reading / limit').nextElementSibling).toHaveTextContent('14°F / 0°F');
    expect(screen.getByText('L-2291')).toBeInTheDocument();
    expect(screen.getByText('BOL-77')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pallet LPN-000123: its movements' })).toHaveAttribute(
      'href',
      '/app/sim?view=ledger&pallet=LPN-000123',
    );
    expect(screen.getByText(/Sim 07:42/)).toBeInTheDocument();
  });

  it('asks for the reason before accepting product on a critical issue', async () => {
    const user = userEvent.setup();
    renderIssue('supervisor');
    expect(screen.getByRole('button', { name: 'On my way' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Accept' }));
    const resolve = screen.getByRole('button', { name: 'Resolve issue' });
    expect(resolve).toBeDisabled();
    await user.type(screen.getByLabelText(/Notes for the record/), 'Reprobed within limit');
    expect(resolve).toBeEnabled();
    await user.click(screen.getByRole('radio', { name: 'Contact Carrier' }));
    expect(screen.getByRole('button', { name: 'Put on hold — awaiting the carrier' })).toBeInTheDocument();
  });
});

describe('Issue log', () => {
  it('reads its filters from the URL and writes changes back to it', async () => {
    const user = userEvent.setup();
    const filters = { limit: 500, severity: 'critical' as const, dock: 4, from: '2026-09-01' };
    renderAs('supervisor', <IssueLog />, {
      path: '/app/log?severity=critical&dock=4&from=2026-09-01&q=crushed',
      seed: (client) => client.setQueryData(keys.issueList(filters), [issue({ severity: 'critical' })]),
    });

    expect(screen.getByLabelText('Severity')).toHaveValue('critical');
    expect(screen.getByLabelText('From')).toHaveValue('2026-09-01');
    expect(screen.getByLabelText('Search')).toHaveValue('crushed');
    expect(screen.getByRole('row', { name: /Crushed cases/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cost' }));
    expect(screen.getByTestId('location').textContent).toContain('sort=cost');
    await user.selectOptions(screen.getByLabelText('Status'), 'on_hold');
    expect(screen.getByTestId('location').textContent).toContain('status=on_hold');
    expect(screen.getByTestId('location').textContent).toContain('severity=critical');
  });
});

describe('Handoff prefill', () => {
  const draft: HandoffDraft = {
    zone: 'Zone A',
    since: minutesAgo(600),
    open_criticals: [
      {
        id: 51,
        severity: 'critical',
        status: 'escalated',
        title: 'Temperature Deviation',
        door_number: 3,
        order_number: null,
        operator_name: 'Mike Johnson',
        created_at: minutesAgo(30),
      },
    ],
    decisions: [
      {
        id: 52,
        title: 'SKU Mismatch',
        decision: 'Contact Carrier',
        status: 'on_hold',
        notes: null,
        decided_by: 'Sarah Mitchell',
        decided_at: minutesAgo(20),
      },
    ],
    trailers: [],
    room_alarms: [],
    pending_requests: [],
    wms_online: false,
    notes: '',
  };

  it('fills each section from the floor and saves only those with text', () => {
    const sections = sectionsFrom(draft, 'Forklift 3 is out');
    expect(sections.find((section) => section.id === 'criticals')?.text).toBe(
      '#51 Temperature Deviation, Dock 3',
    );
    expect(sections.find((section) => section.id === 'decisions')?.text).toBe(
      '#52 SKU Mismatch: Contact Carrier (on hold)',
    );
    const notes = composeHandoff(sections);
    expect(notes).toContain('Open critical issues:\n#51');
    expect(notes).toContain(
      'Anything else:\nThe WMS is offline: work from the paper load sheet.\nForklift 3 is out',
    );
    expect(notes).not.toContain('Trailers:');
  });
});
