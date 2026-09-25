/**
 * The /ws channel: authenticated, reconnecting, and wired into the query cache so a screen updates
 * the moment someone else changes what it shows. The six event types are the complete vocabulary —
 * see docs/requirements/functional-specs.md §3.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { session, wsUrl } from './client';
import { keys } from './hooks';
import type { Issue } from './types';

export type RealtimeEvent =
  | { type: 'new_issue'; issue: Issue }
  | { type: 'issue_escalated'; issue: Issue }
  | { type: 'issue_resolved'; issue_id: number; method: string }
  | { type: 'order_complete'; order_id: number }
  | { type: 'new_request'; request_id: number; request_type: string }
  | { type: 'broadcast'; id: number; message: string };

const EVENT_TYPES = new Set<RealtimeEvent['type']>([
  'new_issue',
  'issue_escalated',
  'issue_resolved',
  'order_complete',
  'new_request',
  'broadcast',
]);

export type Connection = 'connecting' | 'live' | 'offline';

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
  const [connection, setConnection] = useState<Connection>('connecting');
  const handler = useRef(onEvent);

  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let attempt = 0;
    let closed = false;

    const invalidate = (event: RealtimeEvent) => {
      switch (event.type) {
        case 'new_issue':
        case 'issue_escalated':
          void client.invalidateQueries({ queryKey: keys.issues });
          void client.invalidateQueries({ queryKey: keys.docks });
          void client.invalidateQueries({ queryKey: keys.analytics });
          break;
        case 'issue_resolved':
          void client.invalidateQueries({ queryKey: keys.issues });
          void client.invalidateQueries({ queryKey: keys.docks });
          break;
        case 'order_complete':
          void client.invalidateQueries({ queryKey: keys.orders });
          void client.invalidateQueries({ queryKey: keys.docks });
          break;
        case 'new_request':
          void client.invalidateQueries({ queryKey: keys.requests });
          break;
        case 'broadcast':
          void client.invalidateQueries({ queryKey: keys.broadcasts });
          break;
      }
    };

    const connect = () => {
      const token = session.token();
      if (!token || closed) return;
      setConnection('connecting');
      socket = new WebSocket(wsUrl(), ['dockiq', token]);
      socket.onopen = () => {
        attempt = 0;
        setConnection('live');
      };
      socket.onmessage = (message) => {
        const event = parse(message.data);
        if (!event) return;
        invalidate(event);
        handler.current(event);
      };
      socket.onclose = () => {
        setConnection('offline');
        if (closed) return;
        // Back off 1s, 2s, 4s … capped at 30s; a sleeping free-tier API can take a few seconds to wake.
        const delay = Math.min(30_000, 1000 * 2 ** attempt);
        attempt += 1;
        retry = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(retry);
      socket?.close();
    };
  }, [client]);

  return connection;
}
