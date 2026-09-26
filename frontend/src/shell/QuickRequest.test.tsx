import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { api } from '../api/client';
import { keys } from '../api/hooks';
import type { QuickRequest as Request } from '../api/types';
import { minutesAgo, renderAs } from '../test/fixtures';
import { QuickRequest } from './QuickRequest';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ok = (data: unknown) => ({ data, response: { ok: true, status: 200 } }) as never;

function request(overrides: Partial<Request> = {}): Request {
  return {
    id: 5,
    dock_door_id: null,
    operator_id: 1,
    request_type: 'Pallet jack',
    details: null,
    status: 'pending',
    created_at: minutesAgo(4),
    fulfilled_at: null,
    cancelled_at: null,
    operator_name: 'Mike Johnson',
    door_number: 1,
    ...overrides,
  };
}

function open(mine: Request[] = []) {
  renderAs('operator', <QuickRequest placement="rail" />, {
    seed: (client) => {
      client.setQueryData(keys.myRequests, mine);
      client.setQueryData([...keys.orders, 'in_progress'], []);
    },
  });
}

describe('Quick request', () => {
  it('says Sent with a tick, and Undo within five seconds withdraws it', async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api, 'POST').mockResolvedValue(ok({ id: 9, status: 'pending' }));
    const put = vi.spyOn(api, 'PUT').mockResolvedValue(ok({ status: 'cancelled' }));
    vi.spyOn(api, 'GET').mockReturnValue(new Promise(() => undefined) as never);
    open();
    await user.click(screen.getByRole('button', { name: 'Quick request' }));
    await user.click(screen.getByRole('button', { name: 'Pallet jack' }));
    expect(post).toHaveBeenCalledTimes(1);

    expect(await screen.findByText('Sent')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Undo/ }));
    expect(put).toHaveBeenCalledWith('/api/requests/{request_id}/cancel', {
      params: { path: { request_id: 9 } },
    });
    expect(await screen.findByText('Withdrawn')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Undo/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(document.querySelector('dialog')?.open).toBe(false); // Done closes the sheet
  });

  it('offers Cancel on each pending request of mine, and only on those', async () => {
    const user = userEvent.setup();
    const put = vi.spyOn(api, 'PUT').mockResolvedValue(ok({ status: 'cancelled' }));
    vi.spyOn(api, 'GET').mockReturnValue(new Promise(() => undefined) as never);
    open([
      request(),
      request({ id: 6, request_type: 'Cleanup Needed', status: 'fulfilled', fulfilled_at: minutesAgo(1) }),
      request({
        id: 7,
        request_type: 'Dock Plate Adjustment',
        status: 'cancelled',
        cancelled_at: minutesAgo(2),
      }),
    ]);
    await user.click(screen.getByRole('button', { name: /Quick request/ }));
    const mine = within(screen.getByRole('region', { name: 'My requests' }));
    expect(mine.getByText('Withdrawn')).toBeInTheDocument();
    expect(mine.getAllByRole('button', { name: /^Cancel the/ })).toHaveLength(1);
    await user.click(mine.getByRole('button', { name: 'Cancel the Pallet jack request' }));
    expect(put).toHaveBeenCalledWith('/api/requests/{request_id}/cancel', {
      params: { path: { request_id: 5 } },
    });
  });
});
