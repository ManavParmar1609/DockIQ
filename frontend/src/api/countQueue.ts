/**
 * Counts are never lost silently. Every tap-counter write and every load-guide step for an order goes
 * through this queue, which is kept in localStorage so a reload or a dead battery does not lose it.
 * Writes are sent one at a time, in order. One that fails because the network or the server is down
 * stays at the head of the queue and is replayed on reconnect (and on a backing-off timer); one the
 * server refuses (a 4xx) is dropped, its reason shown, and the order re-read from the server.
 *
 * The queue holds no React: `hooks.ts` binds it to the QueryClient and reads it through
 * `useSyncExternalStore`.
 */
import { ApiError } from './client';
import type { OrderDetail } from './types';

export type CountWrite =
  | { kind: 'count'; product_id: number; actual_quantity: number }
  /** A load-guide step; with `count`, the pallet (`sku`, `cases`) stepped over is counted or uncounted. */
  | { kind: 'step'; step: number; count: boolean; sku: string | null; cases: number };

export interface CountQueueState {
  /** Writes not yet accepted by the server, including the one in flight. */
  pending: number;
  /** Why the head of the queue could not be sent: it will be retried. */
  stalled: Error | null;
  /** A write the server refused: it was dropped and the order re-read. */
  refused: Error | null;
}

export interface CountRunner {
  send: (orderId: number, write: CountWrite) => Promise<unknown>;
  /** The queue emptied, or a write was refused: re-read the order from the server. */
  resync: (orderId: number) => void;
}

const STORAGE_KEY = 'dockiq.count-queue';
const RETRY_MS = [2_000, 5_000, 10_000, 30_000];
const OFFLINE = 'No connection: they are kept on this tablet and sent in order when it is back.';
const EMPTY: CountQueueState = { pending: 0, stalled: null, refused: null };

function isWrite(value: unknown): value is CountWrite {
  if (typeof value !== 'object' || value === null) return false;
  const write = value as Record<string, unknown>;
  return (
    (write.kind === 'count' &&
      typeof write.product_id === 'number' &&
      typeof write.actual_quantity === 'number') ||
    (write.kind === 'step' && typeof write.step === 'number' && typeof write.count === 'boolean')
  );
}

function load(): Map<number, CountWrite[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entries: [number, CountWrite[]][] = [];
    for (const [key, list] of Object.entries(parsed)) {
      const writes = Array.isArray(list) ? list.filter(isWrite) : [];
      if (writes.length > 0) entries.push([Number(key), writes]);
    }
    return new Map(entries);
  } catch {
    return new Map();
  }
}

let queues = load();
let states = new Map<number, CountQueueState>();
const errors = new Map<number, { stalled: Error | null; refused: Error | null }>();
const sending = new Set<number>();
const attempts = new Map<number, number>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
let runner: CountRunner | null = null;

function save() {
  try {
    const live = [...queues].filter(([, list]) => list.length > 0);
    if (live.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(live)));
  } catch {
    /* private mode or full: the queue still lives for this page load */
  }
}

function publish(orderId: number) {
  const error = errors.get(orderId);
  const pending = queues.get(orderId)?.length ?? 0;
  states = new Map(states).set(orderId, {
    pending,
    stalled: error?.stalled ?? null,
    refused: error?.refused ?? null,
  });
  listeners.forEach((listener) => {
    listener();
  });
}

function setError(orderId: number, patch: Partial<{ stalled: Error | null; refused: Error | null }>) {
  errors.set(orderId, { stalled: null, refused: null, ...errors.get(orderId), ...patch });
}

/** A 4xx will not fix itself — except an expired sign-in, a timeout or a rate limit. */
function refused(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    ![401, 408, 429].includes(error.status)
  );
}

function schedule(orderId: number) {
  const tries = attempts.get(orderId) ?? 0;
  attempts.set(orderId, tries + 1);
  clearTimeout(timers.get(orderId));
  const delay = RETRY_MS[Math.min(tries, RETRY_MS.length - 1)] ?? 30_000;
  timers.set(
    orderId,
    setTimeout(() => void drainCounts(orderId), delay),
  );
}

export function bindCountQueue(next: CountRunner) {
  runner = next;
}

export function subscribeCounts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function countQueueState(orderId: number): CountQueueState {
  return states.get(orderId) ?? EMPTY;
}

export function queuedWrites(orderId: number): number {
  return queues.get(orderId)?.length ?? 0;
}

/** Queue a write and start sending. A count replaces the queued count for the same line before it. */
export function enqueueCount(orderId: number, write: CountWrite) {
  const list = [...(queues.get(orderId) ?? [])];
  const last = list.at(-1);
  const lastInFlight = sending.has(orderId) && list.length === 1;
  if (
    write.kind === 'count' &&
    last?.kind === 'count' &&
    last.product_id === write.product_id &&
    !lastInFlight
  ) {
    list[list.length - 1] = write;
  } else {
    list.push(write);
  }
  queues = new Map(queues).set(orderId, list);
  setError(orderId, { refused: null });
  save();
  publish(orderId);
  void drainCounts(orderId);
}

function shift(orderId: number) {
  queues = new Map(queues).set(orderId, (queues.get(orderId) ?? []).slice(1));
  save();
}

/** Send an order's queued writes in order, until the queue is empty or the connection fails. */
export async function drainCounts(orderId: number): Promise<void> {
  const current = runner;
  if (!current || sending.has(orderId) || queuedWrites(orderId) === 0) return;
  clearTimeout(timers.get(orderId));
  sending.add(orderId);
  let resync = false;
  try {
    for (;;) {
      const head = queues.get(orderId)?.[0];
      if (!head) break;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setError(orderId, { stalled: new ApiError(0, OFFLINE) });
        schedule(orderId);
        return;
      }
      try {
        await current.send(orderId, head);
        attempts.delete(orderId);
        setError(orderId, { stalled: null });
      } catch (error) {
        if (!refused(error)) {
          setError(orderId, { stalled: error instanceof Error ? error : new ApiError(0, OFFLINE) });
          schedule(orderId);
          return;
        }
        setError(orderId, { refused: error instanceof Error ? error : null });
        resync = true;
      }
      shift(orderId);
      publish(orderId);
    }
    resync = true;
  } finally {
    sending.delete(orderId);
    publish(orderId);
    if (resync) current.resync(orderId);
  }
}

// Replay every order's queue the moment the connection is back.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    for (const orderId of queues.keys()) void drainCounts(orderId);
  });
}

/** A write applied to an order, exactly as the server applies it (business-rules §10, the load guide). */
export function applyWrite(detail: OrderDetail, write: CountWrite): OrderDetail {
  if (write.kind === 'count') {
    return {
      ...detail,
      items: detail.items.map((line) =>
        line.product_id === write.product_id
          ? { ...line, actual_quantity: write.actual_quantity, verified: true }
          : line,
      ),
    };
  }
  const current = detail.load_step ?? 1;
  const counting = write.count && write.sku !== null && Math.abs(write.step - current) === 1;
  const change = write.step > current ? write.cases : -write.cases;
  return {
    ...detail,
    load_step: write.step,
    items: counting
      ? detail.items.map((line) => {
          if (line.sku !== write.sku) return line;
          const actual = Math.min(line.expected_quantity, Math.max(0, line.actual_quantity + change));
          return { ...line, actual_quantity: actual, verified: actual > 0 };
        })
      : detail.items,
  };
}

/** The server's order with this tablet's unsent writes laid over it, so a refetch never undoes a tap. */
export function withQueuedWrites(detail: OrderDetail): OrderDetail {
  return (queues.get(detail.id) ?? []).reduce(applyWrite, detail);
}

/** Tests only: forget every queue. */
export function resetCountQueue() {
  timers.forEach((timer) => {
    clearTimeout(timer);
  });
  timers.clear();
  attempts.clear();
  errors.clear();
  sending.clear();
  queues = new Map();
  states = new Map();
  runner = null;
  save();
}
