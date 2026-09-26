/**
 * A report is never lost to a dead Wi-Fi spot. When filing fails because the network (or the server)
 * is unreachable, the report — without its photos — is kept in localStorage with its `client_key`,
 * and sent again when the tablet is back online. The key makes the server file it once however often
 * it is retried (POST /api/issues is idempotent on `client_key`). A report the server refuses (a 4xx)
 * is taken off the queue and its reason kept for the worker to read.
 *
 * Entries belong to the person who filed them: a tablet handed to someone else never sends another
 * person's report under their name. The queue holds no React: `hooks.ts` reads it through
 * `useSyncExternalStore`.
 */
import { ApiError, api, unwrap } from './client';
import type { IssueCreate, IssueCreated } from './types';

export interface QueuedReport {
  key: string;
  userId: number;
  body: IssueCreate;
  queuedAt: string;
}

export interface RefusedReport {
  key: string;
  title: string;
  reason: string;
}

export interface OfflineReportsState {
  /** Reports kept on this tablet, not yet accepted by the server. */
  waiting: number;
  /** Queued reports the server refused when they were finally sent. */
  refused: RefusedReport[];
}

const STORAGE_KEY = 'dockiq.offline-reports';
const EMPTY: OfflineReportsState = { waiting: 0, refused: [] };

export const QUEUED_MESSAGE =
  'No connection. Your report is saved on this tablet and sends by itself when the connection is back. Photos are not kept: add them to the issue once it is filed.';

/** The report could not reach the server and was queued. Shown like any other mutation error. */
export class QueuedOffline extends ApiError {
  constructor() {
    super(0, QUEUED_MESSAGE);
    this.name = 'QueuedOffline';
  }
}

function isQueued(value: unknown): value is QueuedReport {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  const body: unknown = entry.body;
  return (
    typeof entry.key === 'string' &&
    typeof entry.userId === 'number' &&
    typeof entry.queuedAt === 'string' &&
    typeof body === 'object' &&
    body !== null &&
    typeof (body as Record<string, unknown>).issue_type === 'string'
  );
}

function load(): QueuedReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isQueued) : [];
  } catch {
    return [];
  }
}

let queue = load();
let refused: (RefusedReport & { userId: number })[] = [];
const states = new Map<number, OfflineReportsState>();
const listeners = new Set<() => void>();
const sending = new Set<number>();

function changed() {
  states.clear();
  try {
    if (queue.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    /* storage full or blocked: the queue lives for this page load */
  }
  listeners.forEach((listener) => {
    listener();
  });
}

/** A fresh idempotency key for one report. */
export function newReportKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const hex = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${hex()}-${hex()}${hex()}${hex()}`;
}

function sameReport(a: IssueCreate, b: IssueCreate): boolean {
  const strip = (body: IssueCreate) => JSON.stringify({ ...body, client_key: null });
  return strip(a) === strip(b);
}

/** The key already queued for this very report, so pressing Send again never files it twice. */
function keyFor(userId: number, body: IssueCreate): string {
  return (
    queue.find((entry) => entry.userId === userId && sameReport(entry.body, body))?.key ?? newReportKey()
  );
}

function queueReport(userId: number, key: string, body: IssueCreate) {
  if (queue.some((entry) => entry.key === key)) return;
  queue = [...queue, { key, userId, body: { ...body, client_key: key }, queuedAt: new Date().toISOString() }];
  changed();
}

function forget(key: string) {
  const before = queue.length;
  queue = queue.filter((entry) => entry.key !== key);
  if (queue.length !== before) changed();
}

/** Unreachable: no network, or a server that is down or waking. Worth trying again later. */
export function isUnreachable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status >= 500);
}

function post(body: IssueCreate): Promise<IssueCreated> {
  return unwrap(api.POST('/api/issues', { body }));
}

/**
 * File a report. If the server cannot be reached it is queued for `userId` and `QueuedOffline` is
 * thrown; with no known user it simply fails. A report already queued keeps its key.
 */
export async function fileReport(body: IssueCreate, userId: number | null): Promise<IssueCreated> {
  const key = body.client_key ?? (userId === null ? newReportKey() : keyFor(userId, body));
  try {
    const created = await post({ ...body, client_key: key });
    forget(key);
    return created;
  } catch (error) {
    if (userId === null || !(error instanceof ApiError) || error.status !== 0) throw error;
    queueReport(userId, key, body);
    throw new QueuedOffline();
  }
}

/**
 * Send this person's queued reports, oldest first. Stops at the first one the server cannot be
 * reached for; a refused one is dropped and its reason kept. Returns how many were filed.
 */
export async function sendQueuedReports(userId: number): Promise<number> {
  if (sending.has(userId)) return 0;
  sending.add(userId);
  let filed = 0;
  try {
    for (const entry of queue.filter((item) => item.userId === userId)) {
      try {
        await post(entry.body);
        filed += 1;
        forget(entry.key);
      } catch (error) {
        if (isUnreachable(error)) break;
        refused = [
          ...refused,
          {
            key: entry.key,
            userId,
            title: entry.body.issue_subtype ?? entry.body.issue_type,
            reason: error instanceof Error ? error.message : 'Refused by the server',
          },
        ];
        forget(entry.key);
      }
    }
  } finally {
    sending.delete(userId);
  }
  return filed;
}

export function dismissRefused(key: string) {
  refused = refused.filter((entry) => entry.key !== key);
  changed();
}

export function offlineReportsState(userId: number): OfflineReportsState {
  const cached = states.get(userId);
  if (cached) return cached;
  const waiting = queue.filter((entry) => entry.userId === userId).length;
  const mine = refused.filter((entry) => entry.userId === userId);
  const state =
    waiting === 0 && mine.length === 0
      ? EMPTY
      : { waiting, refused: mine.map(({ key, title, reason }) => ({ key, title, reason })) };
  states.set(userId, state);
  return state;
}

export function subscribeReports(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests: forget everything, in memory and in storage. */
export function resetOfflineReports() {
  queue = [];
  refused = [];
  changed();
}
