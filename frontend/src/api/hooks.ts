/**
 * Server state. One query per read, one mutation per write; every mutation invalidates exactly the
 * data it changes, and the realtime channel (realtime.ts) invalidates what other people change.
 */
import { QueryClient, useMutation, useQuery, useQueryClient, type Query } from '@tanstack/react-query';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { ApiError, api, unwrap } from './client';
import {
  applyWrite,
  bindCountQueue,
  countQueueState,
  drainCounts,
  enqueueCount,
  queuedWrites,
  subscribeCounts,
  withQueuedWrites,
  type CountRunner,
  type CountWrite,
} from './countQueue';
import {
  dismissRefused,
  fileReport,
  offlineReportsState,
  sendQueuedReports,
  subscribeReports,
} from './offline';
import type {
  Analytics,
  Broadcast,
  Carrier,
  ChatMessage,
  ColdRoom,
  CrewProductivity,
  DemoAccount,
  Disposition,
  Dock,
  GateEvent,
  Handoff,
  HandoffDraft,
  InspectionCreate,
  InspectionResult,
  Issue,
  IssueCreate,
  IssueCreated,
  IssueStatus,
  LedgerEntry,
  LoadPlan,
  Me,
  Order,
  OrderDetail,
  Pallet,
  Photo,
  QuickRequest,
  ReceivingChecks,
  RoomCode,
  ScanResult,
  Severity,
  Shipment,
  SimScenario,
  SimSpeed,
  SimStatus,
  StockRow,
  Taxonomy,
  TemperatureCheck,
  TemperatureLog,
  WarehouseTask,
  WmsStatus,
  YardEntry,
} from './types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // A 4xx will not fix itself; only retry network and server errors.
      retry: (failures, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2,
    },
    mutations: { retry: false },
  },
});

export const keys = {
  taxonomy: ['taxonomy'] as const,
  demoAccounts: ['demo-accounts'] as const,
  docks: ['docks'] as const,
  orders: ['orders'] as const,
  order: (id: number) => ['orders', id] as const,
  loadPlan: (id: number) => ['orders', id, 'load-plan'] as const,
  temperatureLog: (id: number) => ['orders', id, 'temperature-checks'] as const,
  receivingChecks: (id: number) => ['orders', id, 'receiving-checks'] as const,
  /** A mutation key: an order's tap-counter writes. */
  count: (id: number) => ['count', id] as const,
  issues: ['issues'] as const,
  issueList: (filters: IssueFilters) => ['issues', 'list', filters] as const,
  issue: (id: number) => ['issues', id] as const,
  photos: (issueId: number) => ['issues', issueId, 'photos'] as const,
  requests: ['requests'] as const,
  myRequests: ['requests', 'mine'] as const,
  broadcasts: ['broadcasts'] as const,
  handoffs: ['handoffs'] as const,
  handoffDraft: ['handoffs', 'draft'] as const,
  analytics: ['analytics'] as const,
  analyticsRange: (range: DateRange) => ['analytics', range] as const,
  carriers: ['carriers'] as const,
  chat: ['chat'] as const,
  sim: ['sim'] as const,
  wms: ['wms'] as const,
  yard: ['wms', 'yard'] as const,
  inventory: (sku: string) => ['wms', 'inventory', sku] as const,
  stock: (room: string) => ['wms', 'stock', room] as const,
  tasks: ['wms', 'tasks'] as const,
  productivity: ['wms', 'productivity'] as const,
  ledger: (before: number | null, pallet: string | null = null) =>
    ['wms', 'transactions', before, pallet] as const,
  shipments: ['wms', 'shipments'] as const,
  gate: ['wms', 'gate'] as const,
  rooms: ['wms', 'rooms'] as const,
};

// ── Reference ──

/**
 * Is the API up? A free-tier host sleeps when idle and takes about a minute to wake, so this keeps
 * asking every 3 seconds for up to two minutes before giving up.
 */
export function useServerHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => unwrap(api.GET('/api/health')),
    retry: 40,
    retryDelay: 3_000,
    staleTime: 60_000,
  });
}

export function useTaxonomy() {
  return useQuery<Taxonomy>({
    queryKey: keys.taxonomy,
    queryFn: () => unwrap(api.GET('/api/taxonomy')),
    staleTime: Infinity,
  });
}

export function useDemoAccounts() {
  return useQuery<DemoAccount[]>({
    queryKey: keys.demoAccounts,
    queryFn: () => unwrap(api.GET('/api/auth/demo-accounts')),
    staleTime: Infinity,
    retry: false,
  });
}

export function useDocks() {
  return useQuery<Dock[]>({ queryKey: keys.docks, queryFn: () => unwrap(api.GET('/api/docks')) });
}

export function useCarriers() {
  return useQuery<Carrier[]>({
    queryKey: keys.carriers,
    queryFn: () => unwrap(api.GET('/api/carriers')),
    staleTime: Infinity,
  });
}

// ── Orders ──

/** An operator's current assignment: their order still in progress, if any. */
export function useActiveOrder() {
  const orders = useQuery<Order[]>({
    queryKey: [...keys.orders, 'in_progress'],
    queryFn: () => unwrap(api.GET('/api/orders', { params: { query: { status: 'in_progress' } } })),
  });
  return { ...orders, data: orders.data?.[0] ?? null };
}

export function useOrder(id: number | undefined) {
  return useQuery<OrderDetail>({
    queryKey: keys.order(id ?? 0),
    // This tablet's unsent counts ride on top of the server's, so a refetch never undoes a tap.
    queryFn: async () =>
      withQueuedWrites(
        await unwrap(api.GET('/api/orders/{order_id}', { params: { path: { order_id: id ?? 0 } } })),
      ),
    enabled: id !== undefined,
  });
}

export function useLoadPlan(id: number | undefined) {
  return useQuery<LoadPlan>({
    queryKey: keys.loadPlan(id ?? 0),
    queryFn: () =>
      unwrap(api.GET('/api/orders/{order_id}/load-plan', { params: { path: { order_id: id ?? 0 } } })),
    enabled: id !== undefined,
  });
}

/**
 * False for an order whose tap counter still has writes queued: a refetch now would overwrite the
 * queued taps with a stale count, and the counter refetches it itself once the last tap settles.
 */
export function isSettledQuery(client: QueryClient, query: Query): boolean {
  const [root, id] = query.queryKey;
  return !(
    root === keys.orders[0] &&
    typeof id === 'number' &&
    (client.isMutating({ mutationKey: keys.count(id) }) > 0 || queuedWrites(id) > 0)
  );
}

/** Refetch the orders (active assignment, details, completion blockers), sparing one mid-count. */
export function invalidateOrders(client: QueryClient) {
  return client.invalidateQueries({
    queryKey: keys.orders,
    predicate: (query) => isSettledQuery(client, query),
  });
}

/** Sends one queued count write as a `keys.count` mutation, so `isMutating` sees it. */
function countRunner(client: QueryClient): CountRunner {
  return {
    send: (orderId, write) =>
      client
        .getMutationCache()
        .build(client, {
          mutationKey: keys.count(orderId),
          scope: { id: `count-${String(orderId)}` },
          // The queue decides when to retry; a request made offline fails at once instead of pausing.
          networkMode: 'always',
          mutationFn: (): Promise<unknown> =>
            write.kind === 'count'
              ? unwrap(
                  api.PUT('/api/orders/{order_id}/items', {
                    params: { path: { order_id: orderId } },
                    body: { product_id: write.product_id, actual_quantity: write.actual_quantity },
                  }),
                )
              : unwrap(
                  api.PUT('/api/orders/{order_id}/load-step', {
                    params: { path: { order_id: orderId } },
                    body: { step: write.step, count: write.count },
                  }),
                ),
        })
        .execute(undefined),
    resync: (orderId) => void client.invalidateQueries({ queryKey: keys.order(orderId), exact: true }),
  };
}

/** Apply a write to the cached order at once, then queue it for the server. */
function queueWrite(client: QueryClient, orderId: number, detail: OrderDetail, write: CountWrite) {
  // Cancel an in-flight refetch first, so a stale server count cannot land on top of this tap.
  void client.cancelQueries({ queryKey: keys.order(orderId), exact: true });
  client.setQueryData<OrderDetail>(keys.order(orderId), applyWrite(detail, write));
  bindCountQueue(countRunner(client));
  enqueueCount(orderId, write);
}

/**
 * An order's unsent count writes (`api/countQueue.ts`): how many, why they are stuck, and a way to
 * send them now. Mounting it replays anything left from before a reload.
 */
export function useCountQueue(orderId: number) {
  const client = useQueryClient();
  useEffect(() => {
    bindCountQueue(countRunner(client));
    void drainCounts(orderId);
  }, [client, orderId]);
  const state = useSyncExternalStore(subscribeCounts, () => countQueueState(orderId));
  return { ...state, retry: () => void drainCounts(orderId) };
}

/**
 * Case counting from the tap counters. Each tap reads and writes the cache synchronously, so rapid
 * taps never compute from a stale count; the writes are queued (offline-safe), sent one at a time in
 * order, and the server's truth is re-fetched once the queue empties.
 */
export function useCounter(orderId: number) {
  const client = useQueryClient();
  const queue = useCountQueue(orderId);

  const adjust = (productId: number, next: (current: number) => number) => {
    const detail = client.getQueryData<OrderDetail>(keys.order(orderId));
    const item = detail?.items.find((line) => line.product_id === productId);
    if (!detail || !item) return;
    const value = next(item.actual_quantity);
    // An unchanged value still counts once when the line was never verified: "Set 0" is a count.
    if (value === item.actual_quantity && item.verified) return;
    queueWrite(client, orderId, detail, { kind: 'count', product_id: productId, actual_quantity: value });
  };

  return { adjust, error: queue.refused };
}

/**
 * The load guide's step, kept on the server. Stepping on or back by one counts or uncounts the pallet
 * stepped over on its order line, so the Scan & count totals move with the guide; a jump only moves
 * the place. Queued with the tap counts, so the two never race.
 */
export function useLoadStepSync(orderId: number) {
  const client = useQueryClient();
  return (step: number, count: boolean) => {
    const detail = client.getQueryData<OrderDetail>(keys.order(orderId));
    if (!detail) return;
    const current = detail.load_step ?? 1;
    if (step === current) return;
    const plan = client.getQueryData<LoadPlan>(keys.loadPlan(orderId));
    const sequence = step > current ? current : step;
    const pallet =
      count && Math.abs(step - current) === 1
        ? plan?.pallets.find((candidate) => candidate.load_sequence === sequence)
        : undefined;
    queueWrite(client, orderId, detail, {
      kind: 'step',
      step,
      count: pallet !== undefined,
      sku: pallet?.sku ?? null,
      cases: pallet?.cases ?? 0,
    });
  };
}

export function useScan(orderId: number) {
  const client = useQueryClient();
  return useMutation<ScanResult, Error, string>({
    mutationFn: (code) =>
      unwrap(
        api.POST('/api/orders/{order_id}/scan', { params: { path: { order_id: orderId } }, body: { code } }),
      ),
    onSuccess: (result) => {
      if (result.result === 'match') void client.invalidateQueries({ queryKey: keys.order(orderId) });
    },
  });
}

export function useTemperatureCheck(orderId: number) {
  const client = useQueryClient();
  return useMutation<TemperatureCheck, Error, number>({
    mutationFn: (reading) =>
      unwrap(
        api.POST('/api/orders/{order_id}/temperature-check', {
          params: { path: { order_id: orderId } },
          body: { reading },
        }),
      ),
    onSuccess: (result) => {
      // Logged: the probe log, the receiving evidence and the sign-off blockers changed.
      void client.invalidateQueries({ queryKey: keys.temperatureLog(orderId) });
      void client.invalidateQueries({ queryKey: keys.receivingChecks(orderId) });
      void invalidateOrders(client);
      // A critical probe filed (or joined) a Temperature Deviation.
      if (result.issue_id != null) void client.invalidateQueries({ queryKey: keys.issues });
    },
  });
}

/** The order's probe readings, oldest first: the HACCP log (business-rules §11.1). */
export function useTemperatureLog(orderId: number) {
  return useQuery<TemperatureLog[]>({
    queryKey: keys.temperatureLog(orderId),
    queryFn: () =>
      unwrap(
        api.GET('/api/orders/{order_id}/temperature-checks', { params: { path: { order_id: orderId } } }),
      ),
  });
}

/** The receiving checks' answers for an inbound order, with who and when (business-rules §11.3). */
export function useReceivingChecks(orderId: number) {
  return useQuery<ReceivingChecks>({
    queryKey: keys.receivingChecks(orderId),
    queryFn: () =>
      unwrap(api.GET('/api/orders/{order_id}/receiving-checks', { params: { path: { order_id: orderId } } })),
  });
}

export function useSaveReceivingChecks(orderId: number) {
  const client = useQueryClient();
  return useMutation<ReceivingChecks, Error, Record<string, boolean>>({
    mutationFn: (answers) =>
      unwrap(
        api.PUT('/api/orders/{order_id}/receiving-checks', {
          params: { path: { order_id: orderId } },
          body: { answers },
        }),
      ),
    onSuccess: (saved) => {
      client.setQueryData(keys.receivingChecks(orderId), saved);
      // An answered check can clear a sign-off blocker.
      void invalidateOrders(client);
    },
  });
}

export function useCompleteOrder(orderId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { seal_number?: string | null; notes?: string | null }) =>
      unwrap(
        api.POST('/api/orders/{order_id}/complete', { params: { path: { order_id: orderId } }, body: vars }),
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.orders });
      void client.invalidateQueries({ queryKey: keys.docks });
      void client.invalidateQueries({ queryKey: keys.issues });
    },
  });
}

export function useInspection() {
  const client = useQueryClient();
  return useMutation<InspectionResult, Error, InspectionCreate>({
    mutationFn: (body) => unwrap(api.POST('/api/inspections', { body })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.docks });
      void invalidateOrders(client);
    },
  });
}

// ── Issues ──

export interface IssueFilters {
  status?: IssueStatus | 'active';
  severity?: Severity;
  /** A door number. */
  dock?: number;
  carrier_id?: number;
  /** An issue type from the taxonomy. */
  issue_type?: string;
  /** Quality's disposition of the held product. */
  disposition?: Disposition;
  /** Filed on or after / on or before this day (UTC, "2026-09-25"). */
  from?: string;
  to?: string;
  limit?: number;
}

export function useIssues(filters: IssueFilters = {}, enabled = true) {
  return useQuery<Issue[]>({
    queryKey: keys.issueList(filters),
    queryFn: () => unwrap(api.GET('/api/issues', { params: { query: filters } })),
    enabled,
  });
}

/** The issue log as CSV, with the log's filters and the viewer's scope, for a download. */
export function useExportIssues() {
  return useMutation<Blob, Error, IssueFilters>({
    mutationFn: (filters) =>
      unwrap(api.GET('/api/issues/export.csv', { params: { query: filters }, parseAs: 'blob' })),
  });
}

export function useIssue(id: number, enabled = true) {
  return useQuery<Issue>({
    queryKey: keys.issue(id),
    queryFn: () => unwrap(api.GET('/api/issues/{issue_id}', { params: { path: { issue_id: id } } })),
    enabled,
  });
}

function useIssueInvalidation() {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: keys.issues });
    void client.invalidateQueries({ queryKey: keys.docks });
    void client.invalidateQueries({ queryKey: keys.analytics });
    // An open issue can block an order's sign-off (completion_blockers).
    void invalidateOrders(client);
  }, [client]);
}

/**
 * File a report. With no connection it is kept on this tablet and sent later (`api/offline.ts`): the
 * mutation then fails with `QueuedOffline`, whose message says so. Every report carries a
 * `client_key`, so a retry is never filed twice.
 */
export function useReportIssue() {
  const client = useQueryClient();
  const invalidate = useIssueInvalidation();
  return useMutation<IssueCreated, Error, IssueCreate>({
    // Offline, a paused mutation would hang: fail at once so the report is queued.
    networkMode: 'always',
    mutationFn: (body) => fileReport(body, client.getQueryData<Me>(['me'])?.id ?? null),
    onSuccess: invalidate,
  });
}

const OFFLINE_RETRY_MS = 30_000;

/**
 * This person's reports waiting on the tablet. Mounting it sends them: now, whenever the browser
 * says it is back online, and every 30 seconds while any wait (a sleeping server is not "offline").
 */
export function useOfflineReports(userId: number) {
  const invalidate = useIssueInvalidation();
  const state = useSyncExternalStore(subscribeReports, () => offlineReportsState(userId));
  const send = useCallback(() => {
    void sendQueuedReports(userId).then((filed) => {
      if (filed > 0) invalidate();
    });
  }, [userId, invalidate]);
  useEffect(() => {
    send();
    window.addEventListener('online', send);
    return () => window.removeEventListener('online', send);
  }, [send]);
  useEffect(() => {
    if (state.waiting === 0) return;
    const timer = window.setInterval(send, OFFLINE_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [state.waiting, send]);
  return { ...state, retry: send, dismiss: dismissRefused };
}

/** The operator withdraws their own pending quick request. */
export function useCancelRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      unwrap(api.PUT('/api/requests/{request_id}/cancel', { params: { path: { request_id: id } } })),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.requests }),
  });
}

export function useSelfResolve() {
  const invalidate = useIssueInvalidation();
  return useMutation({
    mutationFn: (vars: { id: number; resolution_type: string; resolution_notes?: string }) =>
      unwrap(
        api.PUT('/api/issues/{issue_id}/self-resolve', {
          params: { path: { issue_id: vars.id } },
          body: { resolution_type: vars.resolution_type, resolution_notes: vars.resolution_notes ?? '' },
        }),
      ),
    onSuccess: invalidate,
  });
}

/** "On my way": the supervisor takes the issue; the operator is told who is coming. */
export function useAcknowledge() {
  const invalidate = useIssueInvalidation();
  return useMutation({
    mutationFn: (id: number) =>
      unwrap(api.PUT('/api/issues/{issue_id}/acknowledge', { params: { path: { issue_id: id } } })),
    onSuccess: invalidate,
  });
}

export function useEscalate() {
  const invalidate = useIssueInvalidation();
  return useMutation({
    mutationFn: (id: number) =>
      unwrap(api.PUT('/api/issues/{issue_id}/escalate', { params: { path: { issue_id: id } } })),
    onSuccess: invalidate,
  });
}

export function useSupervisorResolve() {
  const invalidate = useIssueInvalidation();
  return useMutation({
    mutationFn: (vars: { id: number; resolution_type: string; supervisor_notes: string }) =>
      unwrap(
        api.PUT('/api/issues/{issue_id}/supervisor-resolve', {
          params: { path: { issue_id: vars.id } },
          body: { resolution_type: vars.resolution_type, supervisor_notes: vars.supervisor_notes },
        }),
      ),
    onSuccess: invalidate,
  });
}

/** Quality decides what happens to the product held for an issue (business-rules §7.3). */
export function useSetDisposition() {
  const client = useQueryClient();
  return useMutation<Issue, Error, { id: number; disposition: Disposition; notes: string }>({
    mutationFn: ({ id, disposition, notes }) =>
      unwrap(
        api.PUT('/api/issues/{issue_id}/disposition', {
          params: { path: { issue_id: id } },
          body: { disposition, notes },
        }),
      ),
    onSuccess: (issue) => {
      client.setQueryData(keys.issue(issue.id), issue);
      void client.invalidateQueries({ queryKey: keys.issues });
      // Held plates moved: the stock and the ledger changed.
      void client.invalidateQueries({ queryKey: keys.wms });
    },
  });
}

export function usePhotos(issueId: number, enabled = true) {
  return useQuery<Photo[]>({
    queryKey: keys.photos(issueId),
    queryFn: () =>
      unwrap(api.GET('/api/issues/{issue_id}/photos', { params: { path: { issue_id: issueId } } })),
    enabled,
  });
}

export function useUploadPhoto() {
  const client = useQueryClient();
  return useMutation<Photo, Error, { issueId: number; file: Blob }>({
    mutationFn: ({ issueId, file }) =>
      unwrap(
        api.POST('/api/issues/{issue_id}/photos', {
          params: { path: { issue_id: issueId } },
          body: { file: file as unknown as string },
          bodySerializer: (body) => {
            const form = new FormData();
            form.append('file', body.file as unknown as Blob, 'photo.jpg');
            return form;
          },
        }),
      ),
    onSuccess: (_photo, { issueId }) => {
      void client.invalidateQueries({ queryKey: keys.photos(issueId) });
      void client.invalidateQueries({ queryKey: keys.issue(issueId) });
    },
  });
}

/** Photos need the bearer token, so an <img src> cannot fetch them directly. The caller owns the
 * object URL (create and revoke it), so nothing leaks. */
export function usePhotoBlob(photoId: number) {
  return useQuery<Blob>({
    queryKey: ['photo-blob', photoId],
    queryFn: () =>
      unwrap(api.GET('/api/photos/{photo_id}', { params: { path: { photo_id: photoId } }, parseAs: 'blob' })),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });
}

// ── Floor ──

export function requestsQuery(status?: 'pending' | 'fulfilled') {
  return {
    queryKey: [...keys.requests, status ?? 'all'] as const,
    queryFn: () => unwrap(api.GET('/api/requests', { params: { query: status ? { status } : {} } })),
  };
}

export function useRequests(status?: 'pending' | 'fulfilled') {
  return useQuery<QuickRequest[]>(requestsQuery(status));
}

/** The requests you made, newest first; `new_request` events keep it live. */
export function useMyRequests() {
  return useQuery<QuickRequest[]>({
    queryKey: keys.myRequests,
    queryFn: () => unwrap(api.GET('/api/requests/mine')),
  });
}

export function useCreateRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { request_type: string; dock_door_id?: number | null; details?: string }) =>
      unwrap(api.POST('/api/requests', { body })),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.requests }),
  });
}

export function useFulfillRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      unwrap(api.PUT('/api/requests/{request_id}/fulfill', { params: { path: { request_id: id } } })),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.requests }),
  });
}

export function useBroadcasts() {
  return useQuery<Broadcast[]>({
    queryKey: keys.broadcasts,
    queryFn: () => unwrap(api.GET('/api/broadcasts')),
  });
}

export function useSendBroadcast() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => unwrap(api.POST('/api/broadcasts', { body: { message } })),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.broadcasts }),
  });
}

export function useHandoffs() {
  return useQuery<Handoff[]>({
    queryKey: keys.handoffs,
    queryFn: () => unwrap(api.GET('/api/shift-handoffs')),
  });
}

/** A handoff pre-filled from the shift so far (supervisor only). Saves nothing. */
export function useHandoffDraft(enabled = true) {
  return useQuery<HandoffDraft>({
    queryKey: keys.handoffDraft,
    queryFn: () => unwrap(api.GET('/api/shift-handoffs/draft')),
    enabled,
    staleTime: Infinity,
  });
}

/** The incoming supervisor opened the handoff: the read receipt. */
export function useMarkHandoffRead() {
  const client = useQueryClient();
  return useMutation<Handoff, Error, number>({
    mutationFn: (id) =>
      unwrap(api.PUT('/api/shift-handoffs/{handoff_id}/read', { params: { path: { handoff_id: id } } })),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.handoffs, exact: true }),
  });
}

export function useSubmitHandoff() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { shift: string; notes: string }) => unwrap(api.POST('/api/shift-handoffs', { body })),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.handoffs }),
  });
}

// ── Chat and analytics ──

export function useChatHistory() {
  return useQuery<ChatMessage[]>({
    queryKey: keys.chat,
    queryFn: () => unwrap(api.GET('/api/chat/history')),
  });
}

export interface DateRange {
  from?: string;
  to?: string;
}

export function useAnalytics(range: DateRange = {}) {
  return useQuery<Analytics>({
    queryKey: keys.analyticsRange(range),
    queryFn: () => unwrap(api.GET('/api/analytics/summary', { params: { query: range } })),
  });
}

// ── Simulation and WMS (business-rules §12) ──

export function useSimStatus() {
  return useQuery<SimStatus>({
    queryKey: keys.sim,
    queryFn: () => unwrap(api.GET('/api/sim/status')),
    // The clock moves by itself while playing; poll so it reads live between floor_update events.
    refetchInterval: (query) => (query.state.data?.running ? 2_000 : false),
    staleTime: 0,
  });
}

type SimControl =
  | { action: 'play' | 'pause' | 'next-shift' }
  | { action: 'speed'; speed: SimSpeed }
  | { action: 'step'; minutes: number }
  | { action: 'reset'; seed?: number | null };

function simRequest(control: SimControl) {
  switch (control.action) {
    case 'play':
      return api.POST('/api/sim/play');
    case 'pause':
      return api.POST('/api/sim/pause');
    case 'next-shift':
      return api.POST('/api/sim/next-shift');
    case 'speed':
      return api.POST('/api/sim/speed', { body: { speed: control.speed } });
    case 'step':
      return api.POST('/api/sim/step', { body: { minutes: control.minutes } });
    case 'reset':
      return api.POST('/api/sim/reset', { body: { seed: control.seed ?? null } });
  }
}

/** Every control returns the new status, written straight into the cache. */
export function useSimControl() {
  const client = useQueryClient();
  return useMutation<SimStatus, Error, SimControl>({
    mutationFn: (control) => unwrap(simRequest(control)),
    onSuccess: (status) => {
      client.setQueryData(keys.sim, status);
      void client.invalidateQueries({ queryKey: keys.wms });
    },
  });
}

export function useInjectScenario() {
  const client = useQueryClient();
  return useMutation<{ message: string }, Error, SimScenario>({
    mutationFn: (scenario) => unwrap(api.POST('/api/sim/inject', { body: { scenario } })),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.sim });
      void client.invalidateQueries({ queryKey: keys.wms });
    },
  });
}

export function useWmsStatus() {
  return useQuery<WmsStatus>({
    queryKey: [...keys.wms, 'status'],
    queryFn: () => unwrap(api.GET('/api/wms/status')),
    refetchInterval: 20_000,
  });
}

/** `enabled` false while the WMS is known to be down: no point asking it. */
export function useYard(enabled = true) {
  return useQuery<YardEntry[]>({
    queryKey: keys.yard,
    enabled,
    queryFn: () => unwrap(api.GET('/api/wms/appointments')),
    refetchInterval: 10_000,
    retry: false, // a 503 is the WMS being down, not a blip
  });
}

/** Where a SKU is stored. A 503 means the WMS is offline — shown, not retried. */
export function useInventory(sku: string | null) {
  return useQuery<Pallet[]>({
    queryKey: keys.inventory(sku ?? ''),
    queryFn: () => unwrap(api.GET('/api/wms/inventory', { params: { query: { sku: sku ?? '' } } })),
    enabled: Boolean(sku),
    retry: false,
  });
}

// ── The warehouse behind the WMS. Refreshed by `floor_update`; a 503 is the WMS down, not retried. ──

export function useStock(room: RoomCode, enabled = true) {
  return useQuery<StockRow[]>({
    queryKey: keys.stock(room),
    enabled,
    queryFn: () => unwrap(api.GET('/api/wms/stock', { params: { query: { room, limit: 500 } } })),
    retry: false,
  });
}

export function useWarehouseTasks(enabled = true) {
  return useQuery<WarehouseTask[]>({
    queryKey: keys.tasks,
    enabled,
    queryFn: () => unwrap(api.GET('/api/wms/tasks', { params: { query: { limit: 80 } } })),
    retry: false,
  });
}

export function useCrewProductivity(enabled = true) {
  return useQuery<CrewProductivity[]>({
    queryKey: keys.productivity,
    enabled,
    queryFn: () => unwrap(api.GET('/api/wms/productivity')),
    retry: false,
  });
}

/** The movement ledger, newest first; `before` pages back (null = the latest); `pallet` narrows it. */
export function useLedger(before: number | null, enabled = true, pallet: string | null = null) {
  return useQuery<LedgerEntry[]>({
    queryKey: keys.ledger(before, pallet),
    enabled,
    queryFn: () =>
      unwrap(
        api.GET('/api/wms/transactions', {
          params: { query: { limit: 50, before_id: before, pallet_id: pallet } },
        }),
      ),
    retry: false,
  });
}

export function useShipments(enabled = true) {
  return useQuery<Shipment[]>({
    queryKey: keys.shipments,
    enabled,
    queryFn: () => unwrap(api.GET('/api/wms/shipments', { params: { query: { limit: 40 } } })),
    retry: false,
  });
}

export function useGateLog(enabled = true) {
  return useQuery<GateEvent[]>({
    queryKey: keys.gate,
    enabled,
    queryFn: () => unwrap(api.GET('/api/wms/gate', { params: { query: { limit: 40 } } })),
    retry: false,
  });
}

export function useColdRooms(enabled = true) {
  return useQuery<ColdRoom[]>({
    queryKey: keys.rooms,
    enabled,
    queryFn: () => unwrap(api.GET('/api/wms/rooms', { params: { query: { readings: 12 } } })),
    retry: false,
  });
}
