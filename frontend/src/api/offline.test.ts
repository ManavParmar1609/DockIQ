import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from './client';
import {
  QueuedOffline,
  dismissRefused,
  fileReport,
  offlineReportsState,
  resetOfflineReports,
  sendQueuedReports,
} from './offline';
import type { IssueCreate } from './types';

const REPORT: IssueCreate = {
  issue_type: 'Equipment Failure',
  issue_subtype: 'Dock leveler not working',
  description: 'leveler stuck',
};
const CREATED = {
  id: 7,
  status: 'resolution_in_progress',
  severity: 'medium',
  severity_score: 8,
  severity_reason: '',
  ai_resolution: {},
  estimated_cost_impact: 0,
  recurring_patterns: [],
};

const ok = (data: unknown) => ({ data, response: { ok: true, status: 200 } }) as never;
const refusal = (status: number, detail: string) =>
  ({ error: { detail }, response: { ok: false, status } }) as never;
const unreachable = () => Promise.reject(new TypeError('Failed to fetch'));

function sentKeys(post: { mock: { calls: unknown[][] } }): (string | null | undefined)[] {
  return post.mock.calls.map((call) => (call[1] as { body: IssueCreate }).body.client_key);
}

beforeEach(() => {
  localStorage.clear();
  resetOfflineReports();
});

afterEach(() => {
  resetOfflineReports();
  vi.restoreAllMocks();
});

describe('the offline report queue', () => {
  it('keeps a report the network could not take, and files it once when it is back', async () => {
    const post = vi.spyOn(api, 'POST').mockImplementation(unreachable);

    await expect(fileReport(REPORT, 1)).rejects.toBeInstanceOf(QueuedOffline);
    // Pressing Send again queues nothing new and reuses the same key.
    await expect(fileReport(REPORT, 1)).rejects.toBeInstanceOf(QueuedOffline);
    expect(offlineReportsState(1).waiting).toBe(1);
    expect(offlineReportsState(2).waiting).toBe(0); // someone else's report is never theirs to send
    expect(localStorage.getItem('dockiq.offline-reports')).toContain('Dock leveler not working');
    const [first, second] = sentKeys(post);
    expect(first).toBeTruthy();
    expect(second).toBe(first);

    post.mockResolvedValue(ok(CREATED));
    expect(await sendQueuedReports(1)).toBe(1);
    expect(sentKeys(post).at(-1)).toBe(first); // the retry carries the key: the server files it once
    expect(offlineReportsState(1).waiting).toBe(0);
    expect(localStorage.getItem('dockiq.offline-reports')).toBeNull();
  });

  it('files straight away when the network is up, with a key', async () => {
    const post = vi.spyOn(api, 'POST').mockResolvedValue(ok(CREATED));
    await expect(fileReport(REPORT, 1)).resolves.toMatchObject({ id: 7 });
    expect(sentKeys(post)[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(offlineReportsState(1).waiting).toBe(0);
  });

  it('does not queue a report the server refuses', async () => {
    vi.spyOn(api, 'POST').mockResolvedValue(refusal(422, 'Choose the order first'));
    await expect(fileReport(REPORT, 1)).rejects.toThrow('Choose the order first');
    expect(offlineReportsState(1).waiting).toBe(0);
  });

  it('stops at an unreachable server and keeps the rest; a refusal is dropped with its reason', async () => {
    const post = vi.spyOn(api, 'POST').mockImplementation(unreachable);
    await expect(fileReport(REPORT, 1)).rejects.toBeInstanceOf(QueuedOffline);
    await expect(fileReport({ ...REPORT, description: 'second' }, 1)).rejects.toBeInstanceOf(QueuedOffline);

    expect(await sendQueuedReports(1)).toBe(0);
    expect(offlineReportsState(1).waiting).toBe(2);

    post
      .mockResolvedValueOnce(refusal(409, 'That report key is already in use'))
      .mockResolvedValueOnce(ok(CREATED));
    expect(await sendQueuedReports(1)).toBe(1);
    const state = offlineReportsState(1);
    expect(state.waiting).toBe(0);
    expect(state.refused).toEqual([
      expect.objectContaining({
        title: 'Dock leveler not working',
        reason: 'That report key is already in use',
      }),
    ]);
    dismissRefused(state.refused[0]?.key ?? '');
    expect(offlineReportsState(1).refused).toEqual([]);
  });
});
