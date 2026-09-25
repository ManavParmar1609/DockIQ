import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiError, api, session, unwrap } from '../api/client';
import type { Me } from '../api/types';

interface AuthState {
  user: Me | null;
  /** True until the stored token (if any) has been checked against the API. */
  checking: boolean;
  /** The check itself failed (network or server), so the token is neither good nor bad yet. */
  checkError: Error | null;
  recheck: () => void;
  login: (employeeId: string, password: string) => Promise<Me>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [hasToken, setHasToken] = useState(() => session.token() !== null);

  const me = useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => unwrap(api.GET('/api/auth/me')),
    enabled: hasToken,
    staleTime: Infinity,
    // Only a 401 means signed out (the client clears the token on it); a network blip or a waking
    // server is retried rather than sending the user back to the login screen.
    retry: (failures, error) => !(error instanceof ApiError && error.status === 401) && failures < 3,
  });

  const { refetch } = me;
  const recheck = useCallback(() => void refetch(), [refetch]);

  const logout = useCallback(() => {
    session.clear();
    setHasToken(false);
    client.clear();
  }, [client]);

  // Any 401 anywhere (expired or revoked token) signs the user out.
  useEffect(() => session.onUnauthorized(logout), [logout]);

  const login = useCallback(
    async (employeeId: string, password: string) => {
      const result = await unwrap(
        api.POST('/api/auth/login', {
          body: { username: employeeId, password },
          bodySerializer: (body) => new URLSearchParams(body as Record<string, string>),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
      );
      session.set(result.access_token);
      client.clear();
      client.setQueryData(['me'], result.user);
      setHasToken(true);
      return result.user;
    },
    [client],
  );

  const value = useMemo<AuthState>(
    () => ({
      user: hasToken ? (me.data ?? null) : null,
      checking: hasToken && (me.isPending || (me.isError && me.isFetching)),
      checkError: hasToken && me.data === undefined && !me.isFetching ? me.error : null,
      recheck,
      login,
      logout,
    }),
    [hasToken, me.data, me.isPending, me.isError, me.isFetching, me.error, recheck, login, logout],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** For screens that only render once signed in. */
export function useUser(): Me {
  const { user } = useAuth();
  if (!user) throw new Error('useUser called without a signed-in user');
  return user;
}
