/**
 * The /ws channel: authenticated, reconnecting, and wired into the query cache so a screen updates
 * the moment someone else changes what it shows. The eight event types are the complete vocabulary —
 * see docs/requirements/functional-specs.md §3.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { session, wsUrl } from './client';
import { invalidateOrders, isSettledQuery, keys } from './hooks';
import type { Issue } from './types';

export type RealtimeEvent =
  | { type: 'new_issue'; issue: Issue }
  | { type: 'issue_escalated'; issue: Issue }
  | { type: 'issue_resolved'; issue_id: number; method: string; resolution: string | null }
  | { type: 'issue_acknowledged'; issue_id: number; supervisor_name: string; door_number: number | null }
  | { type: 'order_complete'; order_id: number }
  | {
      type: 'new_request';
      request_id: number;
      request_type: string;
      status?: 'pending' | 'fulfilled' | 'cancelled';
    }
  | { type: 'broadcast'; id: number; message: string }
  | { type: 'floor_update' };

const EVENT_TYPES = new Set<RealtimeEvent['type']>([
  'new_issue',
  'issue_escalated',
  'issue_resolved',
  'issue_acknowledged',
  'order_complete',
  'new_request',
  'broadcast',
  'floor_update',
]);

/**
 * What the indicator may honestly say: `live` only while the socket is open and the device is online;
 * `offline` when the device has no network; `reconnecting` while a dropped socket retries.
 */
export type Connection = 'connecting' | 'live' | 'reconnecting' | 'offline';

type SocketState = 'connecting' | 'open' | 'closed';

export function connectionOf(socket: SocketState, online: boolean, connectedBefore: boolean): Connection {
  if (!online) return 'offline';
  if (socket === 'open') return 'live';
  return connectedBefore || socket === 'closed' ? 'reconnecting' : 'connecting';
}

function deviceOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

function parse(data: unknown): RealtimeEvent | null {
  if (typeof data !== 'string') return null;
  try {
    const value: unknown = JSON.parse(data);
    if (
      value &&
      typeof value === 'object' &&
      EVENT_TYPES.has((value as { type: RealtimeEvent['type'] }).type)
    ) {
      return value as RealtimeEvent;
    }
  } catch {
    /* a malformed frame is dropped, never fatal */
  }
  return null;
}

/** Connect while mounted. `onEvent` receives every valid event after the cache is invalidated. */
export function useRealtime(onEvent: (event: RealtimeEvent) => void): Connection {
  const client = useQueryClient();
  const [socketState, setSocketState] = useState<SocketState>('connecting');
  const [online, setOnline] = useState(deviceOnline);
  const [everConnected, setEverConnected] = useState(false);
  const handler = useRef(onEvent);

  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let attempt = 0;
    let closed = false;
    let connectedBefore = false;

    const invalidate = (event: RealtimeEvent) => {
      switch (event.type) {
        case 'new_issue':
        case 'issue_escalated':
          void client.invalidateQueries({ queryKey: keys.issues });
          void client.invalidateQueries({ queryKey: keys.docks });
          void client.invalidateQueries({ queryKey: keys.analytics });
          // An open issue can block an order's sign-off (completion_blockers).
          void invalidateOrders(client);
          break;
        case 'issue_acknowledged':
          void client.invalidateQueries({ queryKey: keys.issues });
          break;
        case 'issue_resolved':
          // A decision can block an order (Full Reject, a re-inspection) as well as close the issue.
          void client.invalidateQueries({ queryKey: keys.issues });
          void client.invalidateQueries({ queryKey: keys.docks });
          void client.invalidateQueries({ queryKey: keys.analytics });
          void invalidateOrders(client);
          break;
        case 'order_complete':
          void client.invalidateQueries({ queryKey: keys.orders });
          void client.invalidateQueries({ queryKey: keys.docks });
          break;
        case 'new_request':
          // The supervisor's queue and the operator's own list (`keys.myRequests` sits under it).
          void client.invalidateQueries({ queryKey: keys.requests });
          break;
        case 'broadcast':
          void client.invalidateQueries({ queryKey: keys.broadcasts });
          break;
        case 'floor_update':
          // Trailers moved (usually the simulator): refetch what the floor shows, through your own scope.
          void client.invalidateQueries({ queryKey: keys.docks });
          void invalidateOrders(client);
          void client.invalidateQueries({ queryKey: keys.sim });
          void client.invalidateQueries({ queryKey: keys.wms });
          break;
      }
    };

    const connect = () => {
      const token = session.token();
      if (!token || closed) return;
      window.clearTimeout(retry);
      setSocketState('connecting');
      socket = new WebSocket(wsUrl(), ['dockiq', token]);
      socket.onopen = () => {
        attempt = 0;
        setSocketState('open');
        setEverConnected(true);
        // Events sent while the socket was down are lost: catch up on everything after a reconnect.
        if (connectedBefore)
          void client.invalidateQueries({ predicate: (query) => isSettledQuery(client, query) });
        connectedBefore = true;
      };
      socket.onmessage = (message) => {
        const event = parse(message.data);
        if (!event) return;
        invalidate(event);
        handler.current(event);
      };
      socket.onclose = () => {
        setSocketState('closed');
        if (closed) return;
        // Back off 1s, 2s, 4s … capped at 30s; a sleeping free-tier API can take a few seconds to wake.
        const delay = Math.min(30_000, 1000 * 2 ** attempt);
        attempt += 1;
        retry = window.setTimeout(connect, delay);
      };
    };

    // Back on the network: retry now rather than wait out the backoff.
    const onOnline = () => {
      setOnline(true);
      if (socket?.readyState !== WebSocket.OPEN && socket?.readyState !== WebSocket.CONNECTING) {
        attempt = 0;
        connect();
      }
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    connect();
    return () => {
      closed = true;
      window.clearTimeout(retry);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      socket?.close();
    };
  }, [client]);

  return connectionOf(socketState, online, everConnected);
}
