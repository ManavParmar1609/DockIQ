import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';

import type { Role } from './api/types';
import { useAuth } from './auth/AuthProvider';
import { NotFound, RouteError } from './pages/Errors';
import { AppShell } from './shell/AppShell';

/** A screen for some roles only; anyone else is sent to their own home. */
function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

function gated(roles: Role[], load: () => Promise<{ default: () => ReactNode }>): RouteObject['lazy'] {
  return async () => {
    const { default: Page } = await load();
    return {
      Component: () => (
        <RoleGate roles={roles}>
          <Page />
        </RoleGate>
      ),
    };
  };
}

const ALL: Role[] = ['operator', 'supervisor', 'quality'];
const OPERATOR: Role[] = ['operator'];
const SUPERVISOR: Role[] = ['supervisor'];
const STAFF: Role[] = ['supervisor', 'quality'];

export const router = createBrowserRouter([
  {
    path: '/',
    ErrorBoundary: RouteError,
    lazy: async () => ({ Component: (await import('./pages/Landing')).default }),
  },
  {
    path: '/login',
    ErrorBoundary: RouteError,
    lazy: async () => ({ Component: (await import('./pages/Login')).default }),
  },
  {
    path: '/app',
    Component: AppShell,
    ErrorBoundary: RouteError,
    children: [
      { index: true, lazy: gated(ALL, () => import('./pages/Home')) },
      // Operator
      { path: 'order', lazy: gated(OPERATOR, () => import('./pages/operator/OrderWork')) },
      { path: 'inspection', lazy: gated(OPERATOR, () => import('./pages/operator/Inspection')) },
      { path: 'report', lazy: gated(OPERATOR, () => import('./pages/operator/ReportIssue')) },
      { path: 'issues', lazy: gated(OPERATOR, () => import('./pages/operator/MyIssues')) },
      // Everyone
      { path: 'issues/:issueId', lazy: gated(ALL, () => import('./pages/IssueDetail')) },
      { path: 'chat', lazy: gated(ALL, () => import('./pages/Chat')) },
      // Supervisor and quality
      { path: 'log', lazy: gated(STAFF, () => import('./pages/staff/IssueLog')) },
      { path: 'analytics', lazy: gated(STAFF, () => import('./pages/staff/Analytics')) },
      { path: 'handoff', lazy: gated(SUPERVISOR, () => import('./pages/staff/Handoff')) },
      { path: 'sim', lazy: gated(STAFF, () => import('./pages/staff/Simulator')) },
      { path: '*', Component: NotFound },
    ],
  },
  { path: '*', Component: NotFound },
]);
