import { ArrowRight } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';

import { errorMessage } from '../api/client';
import { useDemoAccounts } from '../api/hooks';
import type { DemoAccount, Role } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { FieldLabel, SimulatedTag } from '../components/ui';
import { ROLE_LABEL } from '../shell/nav';

const ROLE_ORDER: Role[] = ['operator', 'supervisor', 'quality'];

function DemoAccounts({ onPick }: { onPick: (employeeId: string) => void }) {
  const accounts = useDemoAccounts();
  if (!accounts.data || accounts.data.length === 0) return null;
  const byRole = ROLE_ORDER.map((role) => ({
    role,
    people: accounts.data.filter((account: DemoAccount) => account.role === role),
  }));
  return (
    <section aria-labelledby="demo-heading" className="mt-10 border-t-2 border-ink pt-6">
      <h2 id="demo-heading" className="heading text-xl">
        Demo accounts
      </h2>
      <p className="mt-1 text-ink-soft">
        Fictional people. Tap one to fill the employee ID.
        {import.meta.env.DEV && (
          <>
            {' '}
            Local password: <span className="telemetry text-ink">dockiq-demo</span>
          </>
        )}
      </p>
      <div className="mt-4 flex flex-col gap-5">
        {byRole.map(({ role, people }) => (
          <div key={role}>
            <p className="label mb-2">{ROLE_LABEL[role]}</p>
            <ul className="grid gap-0.5 border-2 border-ink bg-ink sm:grid-cols-2">
              {people.map((person) => (
                <li key={person.employee_id}>
                  <button
                    type="button"
                    onClick={() => onPick(person.employee_id)}
                    className="flex h-full w-full items-center justify-between gap-3 bg-light px-3 py-2 text-left hover:bg-paper-sunk"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold">{person.name}</span>
                      <span className="block text-sm text-ink-mute">
                        {person.zone ??
                          (person.supervisor_name ? `Team ${person.supervisor_name}` : 'Facility-wide')}
                      </span>
                    </span>
                    <span className="telemetry shrink-0 text-sm">{person.employee_id}</span>
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
    <div className="min-h-dvh lg:grid lg:grid-cols-2">
      <div className="flex flex-col justify-between border-b-2 border-ink bg-ink p-6 text-light lg:border-b-0 lg:border-r-2 lg:p-12">
        <Link to="/" className="label self-start text-light">
          ← DockIQ
        </Link>
        <div className="my-10 lg:my-0">
          <p className="label text-light">Dock-door operations</p>
          <h1 className="display mt-3 text-5xl sm:text-6xl">Sign in to the floor.</h1>
          <p className="mt-6 max-w-md text-lg">
            Operators report and resolve issues at the dock. Supervisors see their team&apos;s queue. Quality
            sees every temperature and product-integrity issue as it happens.
          </p>
        </div>
        <p className="label text-light">Every company, product and person in this demo is fictional.</p>
      </div>

      <div className="p-6 lg:p-12">
        <form onSubmit={(event) => void submit(event)} className="max-w-md" noValidate>
          <h2 className="display text-4xl">Sign in</h2>
          <div className="mt-8">
            <FieldLabel htmlFor="employee-id">Employee ID</FieldLabel>
            <input
              id="employee-id"
              className="field telemetry text-lg uppercase"
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
              placeholder="OP-001"
              autoComplete="username"
              autoCapitalize="characters"
              required
            />
          </div>
          <div className="mt-5">
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <input
              id="password"
              type="password"
              className="field text-lg"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {problem && (
            <p
              role="alert"
              className="mt-4 border-2 border-hazard bg-light px-3 py-2 font-semibold text-hazard-deep"
            >
              {problem}
            </p>
          )}
          <button
            type="submit"
            className="btn btn-primary mt-6 w-full text-lg"
            disabled={busy || !employeeId || !password}
          >
            {busy ? 'Signing in…' : 'Sign in'}
            <ArrowRight size={20} aria-hidden="true" />
          </button>
          <div className="mt-4">
            <SimulatedTag />
          </div>
        </form>
        <DemoAccounts onPick={setEmployeeId} />
      </div>
    </div>
  );
}
