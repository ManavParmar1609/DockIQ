/**
 * The only gateway to the backend. Every request is typed from the API's OpenAPI schema
 * (`schema.gen.ts`, regenerated with `npm run gen:api`), carries the bearer token, and fails with an
 * `ApiError` — never a silent `undefined`.
 */
import createClient, { type Middleware } from 'openapi-fetch';

import type { paths } from './schema.gen';

const ORIGIN = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const TOKEN_KEY = 'dockiq.token';

/** The WebSocket lives on the API host: https://api.example → wss://api.example/ws. */
export function wsUrl(): string {
  const origin = ORIGIN || window.location.origin;
  return `${origin.replace(/^http/, 'ws')}/ws`;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ── Token: sessionStorage, so it ends with the tab. ──

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

let token = readToken();

export const session = {
  token: (): string | null => token,
  set(next: string): void {
    token = next;
    try {
      sessionStorage.setItem(TOKEN_KEY, next);
    } catch {
      /* private mode: the token lives for this page load only */
    }
  },
  clear(): void {
    token = null;
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nothing stored */
    }
  },
  /** Called when any request comes back 401: the token expired or was revoked. */
  onUnauthorized(listener: Listener): () => void {
    unauthorizedListeners.add(listener);
    return () => unauthorizedListeners.delete(listener);
  },
};

const auth: Middleware = {
  onRequest({ request }) {
    if (token) request.headers.set('Authorization', `Bearer ${token}`);
    return request;
  },
  onResponse({ response, request }) {
    const isLogin = new URL(request.url, window.location.origin).pathname.endsWith('/api/auth/login');
    if (response.status === 401 && !isLogin && token) {
      session.clear();
      unauthorizedListeners.forEach((listener) => {
        listener();
      });
    }
    return response;
  },
};

export const api = createClient<paths>({ baseUrl: ORIGIN });
api.use(auth);

// ── Result unwrapping ──

interface FastApiError {
  detail?: string | { msg: string }[];
}

function messageFrom(error: unknown, status: number): string {
  const detail = (error as FastApiError | undefined)?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0]) return detail[0].msg;
  if (status === 0 || status >= 500)
    return 'The server could not be reached. Check the connection and retry.';
  return `Request failed (${status})`;
}

interface FetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** Resolve to the response body or throw an `ApiError` carrying the server's message. */
export async function unwrap<T>(request: Promise<FetchResult<T>>): Promise<T> {
  let result: FetchResult<T>;
  try {
    result = await request;
  } catch {
    throw new ApiError(0, 'The server could not be reached. Check the connection and retry.');
  }
  if (result.error !== undefined || !result.response.ok || result.data === undefined) {
    throw new ApiError(result.response.status, messageFrom(result.error, result.response.status));
  }
  return result.data;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

// ── Server-sent events: the assistant streams its work ──

/**
 * POST a JSON body and hand each `data:` event to `onEvent` as it arrives. openapi-fetch buffers
 * whole responses, so the assistant stream uses fetch directly — still here, the one gateway.
 */
export async function postEventStream(
  path: '/api/chat/stream',
  body: unknown,
  onEvent: (event: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) return;
    throw new ApiError(0, 'The server could not be reached. Check the connection and retry.', {
      cause: error,
    });
  }
  if (response.status === 401 && token) {
    session.clear();
    unauthorizedListeners.forEach((listener) => {
      listener();
    });
  }
  if (!response.ok || !response.body) {
    let detail: unknown;
    try {
      detail = await response.json();
    } catch {
      detail = undefined;
    }
    throw new ApiError(response.status, messageFrom(detail, response.status));
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          onEvent(JSON.parse(line.slice(6)));
        } catch {
          /* a malformed frame is dropped, never fatal */
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}
