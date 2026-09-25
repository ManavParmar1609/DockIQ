/**
 * Server state. One query per read, one mutation per write; every mutation invalidates exactly the
 * data it changes, and the realtime channel (realtime.ts) invalidates what other people change.
 */
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, api, unwrap } from './client';
import type {
  Analytics,
  Broadcast,
  ChatMessage,
  ChatReply,
  DemoAccount,
  Dock,
  Handoff,
  InspectionCreate,
  InspectionResult,
  Issue,
  IssueCreate,
  IssueCreated,
  IssueStatus,
  LoadPlan,
  Order,
  OrderDetail,
  Pallet,
  Photo,
  QuickRequest,
  ScanResult,
  Severity,
  SimScenario,
  SimSpeed,
  SimStatus,
  Taxonomy,
  TemperatureCheck,
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
  issues: ['issues'] as const,
  issueList: (filters: IssueFilters) => ['issues', 'list', filters] as const,
  issue: (id: number) => ['issues', id] as const,
  photos: (issueId: number) => ['issues', issueId, 'photos'] as const,
  requests: ['requests'] as const,
  broadcasts: ['broadcasts'] as const,
  handoffs: ['handoffs'] as const,
  analytics: ['analytics'] as const,
  chat: ['chat'] as const,
  sim: ['sim'] as const,
  wms: ['wms'] as const,
  yard: ['wms', 'yard'] as const,
  inventory: (sku: string) => ['wms', 'inventory', sku] as const,
};

// ── Reference ──

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

// ── Orders ──

export function useOrders() {
  return useQuery<Order[]>({ queryKey: keys.orders, queryFn: () => unwrap(api.GET('/api/orders')) });
}

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
    queryFn: () => unwrap(api.GET('/api/orders/{order_id}', { params: { path: { order_id: id ?? 0 } } })),
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
 * Case counting from the tap counters. Each tap reads and writes the cache synchronously, so rapid
 * taps never compute from a stale count; the requests run one at a time, in order, and the server's
 * truth is re-fetched once the last tap settles.
 */
export function useCounter(orderId: number) {
  const client = useQueryClient();
  const mutationKey = ['count', orderId] as const;
  const mutation = useMutation({
    mutationKey,
    scope: { id: `count-${orderId}` },
    mutationFn: (vars: { product_id: number; actual_quantity: number }) =>
      unwrap(
        api.PUT('/api/orders/{order_id}/items', { params: { path: { order_id: orderId } }, body: vars }),
      ),
    onSettled: () => {
      if (client.isMutating({ mutationKey }) <= 1)
        void client.invalidateQueries({ queryKey: keys.order(orderId) });
    },
  });

  const adjust = (productId: number, next: (current: number) => number) => {
    const detail = client.getQueryData<OrderDetail>(keys.order(orderId));
    const item = detail?.items.find((line) => line.product_id === productId);
    if (!detail || !item) return;
    const value = next(item.actual_quantity);
    if (value === item.actual_quantity) return;
    void client.cancelQueries({ queryKey: keys.order(orderId) });
    client.setQueryData<OrderDetail>(keys.order(orderId), {
      ...detail,
      items: detail.items.map((line) =>
        line.product_id === productId ? { ...line, actual_quantity: value, verified: true } : line,
      ),
    });
    mutation.mutate({ product_id: productId, actual_quantity: value });
  };

  return { adjust, error: mutation.error };
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
  return useMutation<TemperatureCheck, Error, number>({
    mutationFn: (reading) =>
      unwrap(
        api.POST('/api/orders/{order_id}/temperature-check', {
          params: { path: { order_id: orderId } },
          body: { reading },
        }),
      ),
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
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.docks }),
  });
}

// ── Issues ──

export interface IssueFilters {
  status?: IssueStatus | 'active';
  severity?: Severity;
  limit?: number;
}

export function useIssues(filters: IssueFilters = {}) {
  return useQuery<Issue[]>({
    queryKey: keys.issueList(filters),
    queryFn: () => unwrap(api.GET('/api/issues', { params: { query: filters } })),
  });
}

export function useIssue(id: number) {
  return useQuery<Issue>({
    queryKey: keys.issue(id),
    queryFn: () => unwrap(api.GET('/api/issues/{issue_id}', { params: { path: { issue_id: id } } })),
  });
}

function useIssueInvalidation() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: keys.issues });
    void client.invalidateQueries({ queryKey: keys.docks });
    void client.invalidateQueries({ queryKey: keys.analytics });
  };
}

export function useReportIssue() {
  const invalidate = useIssueInvalidation();
  return useMutation<IssueCreated, Error, IssueCreate>({
    mutationFn: (body) => unwrap(api.POST('/api/issues', { body })),
    onSuccess: invalidate,
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

export function useRequests(status?: 'pending' | 'fulfilled') {
  return useQuery<QuickRequest[]>({
    queryKey: [...keys.requests, status ?? 'all'],
    queryFn: () => unwrap(api.GET('/api/requests', { params: { query: status ? { status } : {} } })),
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

export function useSendChat() {
  const client = useQueryClient();
  return useMutation<
    ChatReply,
    Error,
    { message: string; company_id?: number | null; product_category?: string | null }
  >({
    mutationFn: (body) => unwrap(api.POST('/api/chat', { body })),
    onSettled: () => void client.invalidateQueries({ queryKey: keys.chat }),
  });
}

export function useAnalytics() {
  return useQuery<Analytics>({
    queryKey: keys.analytics,
    queryFn: () => unwrap(api.GET('/api/analytics/summary')),
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
