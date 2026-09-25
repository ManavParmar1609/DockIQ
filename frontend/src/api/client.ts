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

  constructor(status: number, message: string) {
    super(message);
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
