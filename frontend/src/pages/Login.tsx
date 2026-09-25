import { AlertTriangle, ArrowLeft, ChevronRight, LoaderCircle, Warehouse } from 'lucide-react';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';

import { errorMessage } from '../api/client';
import { useDemoAccounts, useServerHealth } from '../api/hooks';
import type { DemoAccount, Role } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { SimulatedTag } from '../components/ui';
import { ROLE_LABEL } from '../shell/nav';

const ROLE_ORDER: Role[] = ['operator', 'supervisor', 'quality'];
const WAKE_NOTICE_AFTER_MS = 1500;

/** On a free-tier host the API sleeps when idle; say so instead of looking broken. */
function ServerStatus() {
  const health = useServerHealth();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), WAKE_NOTICE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (health.isError) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-lg bg-hazard-soft p-3 text-base text-hazard-deep"
      >
        <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
        The server did not answer. Check your connection and reload the page.
      </p>
    );
  }
  if (health.isPending && slow) {
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-lg bg-paper-sunk p-3 text-base text-ink-soft"
      >
        <LoaderCircle size={18} aria-hidden="true" className="mt-0.5 shrink-0 motion-safe:animate-spin" />
        Waking the demo server. The free tier sleeps when idle, so this can take up to a minute.
      </p>
    );
  }
  return null;
}

function DemoAccounts({ onPick }: { onPick: (employeeId: string) => void }) {
  const accounts = useDemoAccounts();
  if (!accounts.data || accounts.data.length === 0) return null;
  const byRole = ROLE_ORDER.map((role) => ({
    role,
    people: accounts.data.filter((account: DemoAccount) => account.role === role),
  }));
  return (
    <section aria-labelledby="demo-heading" className="mt-12">
      <h2 id="demo-heading" className="heading text-xl">
        Demo accounts
      </h2>
      <p className="mt-1 text-base text-ink-mute">
        Fictional people. Tap one to fill in the employee ID.
        {import.meta.env.DEV && (
          <>
            {' '}
            Local password: <span className="telemetry text-ink">dockiq-demo</span>
          </>
        )}
      </p>
      <div className="mt-5 flex flex-col gap-6">
        {byRole.map(({ role, people }) => (
          <div key={role}>
            <p className="mb-2 px-4 text-sm font-semibold text-ink-mute">{ROLE_LABEL[role]}</p>
            <ul className="card overflow-hidden">
              {people.map((person) => (
                <li key={person.employee_id} className="border-b border-hairline last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onPick(person.employee_id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-paper active:bg-paper-sunk"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold">{person.name}</span>
                      <span className="block text-sm text-ink-mute">
                        {person.zone ??
                          (person.supervisor_name ? `Team ${person.supervisor_name}` : 'Facility-wide')}
                      </span>
                    </span>
                    <span className="telemetry shrink-0 text-sm text-ink-mute">{person.employee_id}</span>
                    <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-ink-mute" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/app" replace />;
  const from = (location.state as { from?: string } | null)?.from ?? '/app';

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await login(employeeId.trim(), password);
      await navigate(from, { replace: true });
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh px-4 pt-6 pb-16 sm:px-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1 rounded-full px-2 text-base font-medium text-accent-ink hover:bg-paper-sunk"
      >
        <ArrowLeft size={18} aria-hidden="true" /> About DockIQ
      </Link>

      <main className="mx-auto mt-6 max-w-md sm:mt-12">
        <div className="reveal flex flex-col items-center text-center">
          <span
            className="grid h-20 w-20 place-items-center rounded-2xl bg-accent text-on-accent shadow-float"
            aria-hidden="true"
          >
            <Warehouse size={42} strokeWidth={2} />
          </span>
          <h1 className="display mt-6 text-3xl">Sign in to DockIQ</h1>
          <p className="mt-2 text-base text-ink-mute">Dock-door operations for cold storage.</p>
        </div>

        <form onSubmit={(event) => void submit(event)} className="mt-8" noValidate>
          {/* Grouped fields, as in iOS Settings: one card, a hairline between rows. */}
          <div className="card overflow-hidden">
            <label className="flex items-center gap-3 border-b border-hairline px-4">
              <span className="w-28 shrink-0 text-base font-medium">Employee ID</span>
              <input
                id="employee-id"
                className="telemetry min-h-13 w-full bg-transparent text-base uppercase outline-none placeholder:text-ink-mute placeholder:normal-case"
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
                placeholder="OP-001"
                autoComplete="username"
                autoCapitalize="characters"
                aria-label="Employee ID"
                required
              />
            </label>
            <label className="flex items-center gap-3 px-4">
              <span className="w-28 shrink-0 text-base font-medium">Password</span>
              <input
                id="password"
                type="password"
                className="min-h-13 w-full bg-transparent text-base outline-none placeholder:text-ink-mute"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Required"
                autoComplete="current-password"
                aria-label="Password"
                required
              />
            </label>
          </div>

          {problem && (
            <p
              role="alert"
              className="mt-4 flex items-center gap-2 rounded-lg bg-hazard-soft px-3 py-2.5 font-semibold text-hazard-deep"
            >
              <AlertTriangle size={18} aria-hidden="true" className="shrink-0" />
              {problem}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary mt-5 w-full"
            disabled={busy || !employeeId || !password}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="mt-4 flex flex-col items-center gap-3">
            <ServerStatus />
            <SimulatedTag />
          </div>
        </form>

        <DemoAccounts onPick={setEmployeeId} />

        <p className="mt-10 text-center text-sm text-ink-mute">
          Every company, product and person in this demo is fictional.
        </p>
      </main>
    </div>
  );
}
