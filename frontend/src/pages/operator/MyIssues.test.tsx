import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api/client';
import { keys } from '../../api/hooks';
import type { Issue } from '../../api/types';
import { issue, renderAs } from '../../test/fixtures';
import MyIssues from './MyIssues';

// The server decides who may close what (business-rules §7.5); these flags are what it answers.
const ESCALATED = issue({
  id: 21,
  issue_subtype: 'Crushed cases',
  severity: 'high',
  status: 'escalated',
  can_self_resolve: true,
  self_resolve_needs_note: true,
});
const AT_THE_DOCK = issue({
  id: 22,
  issue_subtype: 'Label will not scan',
  severity: 'low',
  status: 'resolution_in_progress',
  escalated_at: null,
  can_self_resolve: true,
  self_resolve_needs_note: false,
});
const CRITICAL = issue({
  id: 23,
  issue_subtype: 'Product temperature out of range',
  severity: 'critical',
  status: 'escalated',
});
const ON_HOLD = issue({
  id: 24,
  issue_subtype: 'Seal number does not match',
  severity: 'medium',
  status: 'on_hold',
  resolution_type: 'Contact Carrier',
  pending_action: 'Awaiting the carrier',
});

function renderList(issues: Issue[]) {
  return renderAs('operator', <MyIssues />, {
    seed: (client) => client.setQueryData(keys.issueList({ limit: 200 }), issues),
  });
}

function card(subtype: string): HTMLElement {
  const item = screen.getByText(subtype).closest('li');
  if (!item) throw new Error(`No card for ${subtype}`);
  return item;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('My issues: resolve it yourself, inline', () => {
  it('offers it on an escalated issue that is not critical, and asks for a note first', async () => {
    const user = userEvent.setup();
    const put = vi.spyOn(api, 'PUT').mockReturnValue(new Promise(() => undefined));
    renderList([ESCALATED]);
    const escalated = within(card('Crushed cases'));

    await user.click(escalated.getByRole('button', { name: /Resolve it yourself/ }));
    const confirm = escalated.getByRole('button', { name: /Confirm — mark it resolved/ });
    expect(escalated.getByText('Required: the issue is with your supervisor')).toBeInTheDocument();

    await user.click(escalated.getByRole('radio', { name: 'Partial Accept' }));
    expect(confirm).toBeDisabled(); // the note is still empty
    await user.type(escalated.getByLabelText(/Note for the record/), 'Restacked onto a new pallet');
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    const call = (put.mock.calls as unknown as unknown[][])[0] ?? [];
    expect(call[0]).toBe('/api/issues/{issue_id}/self-resolve');
    expect(call[1]).toMatchObject({
      params: { path: { issue_id: 21 } },
      body: { resolution_type: 'Partial Accept', resolution_notes: 'Restacked onto a new pallet' },
    });
  });

  it('needs no note on an issue still being resolved at the dock, and can be cancelled', async () => {
    const user = userEvent.setup();
    renderList([AT_THE_DOCK]);
    const atDock = within(card('Label will not scan'));

    await user.click(atDock.getByRole('button', { name: /Resolve it yourself/ }));
    expect(atDock.getByText('Optional')).toBeInTheDocument();
    await user.click(atDock.getByRole('radio', { name: 'Partial Accept' }));
    expect(atDock.getByRole('button', { name: /Confirm — mark it resolved/ })).toBeEnabled();

    await user.click(atDock.getByRole('button', { name: 'Cancel' }));
    expect(atDock.queryByRole('radio', { name: 'Partial Accept' })).not.toBeInTheDocument();
    expect(atDock.getByRole('button', { name: /Resolve it yourself/ })).toBeInTheDocument();
  });

  it('is not offered on a critical issue, which says who decides, nor on one on hold', () => {
    renderList([CRITICAL, ON_HOLD]);
    const critical = within(card('Product temperature out of range'));
    expect(critical.getByText('Your supervisor decides — critical')).toBeInTheDocument();
    expect(critical.queryByRole('button', { name: /Resolve it yourself/ })).not.toBeInTheDocument();

    const held = within(card('Seal number does not match'));
    expect(held.getByText('Awaiting the carrier')).toBeInTheDocument();
    expect(held.queryByRole('button', { name: /Resolve it yourself/ })).not.toBeInTheDocument();
  });
});
