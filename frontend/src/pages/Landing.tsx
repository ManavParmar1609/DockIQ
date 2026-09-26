/**
 * The landing page, in Grafbase's composition: the announcement strip, a white ruled nav, a 50/50
 * hero with a 90px display headline and the product preview panel, then full-width bands alternating
 * drafting gray and white. Every preview is a real DockIQ component rendering sample data, labelled.
 */
import {
  ArrowRight,
  BarChart3,
  ClipboardList,
  LayoutGrid,
  MessageSquare,
  Radio,
  Repeat2,
  Warehouse,
} from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';

import type { Severity } from '../api/types';
import { LoadPlanView } from '../components/LoadPlanView';
import { SeverityBadge } from '../components/Severity';
import { SAMPLE_PLAN } from './landing/samplePlan';

/** Adds `.in` to each `.enter` element as it scrolls into view. */
function useReveal() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const elements = root.current?.querySelectorAll('.enter') ?? [];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -60px 0px' },
    );
    elements.forEach((element) => {
      observer.observe(element);
    });
    return () => observer.disconnect();
  }, []);
  return root;
}

const CTA = 'Open the demo';

function Primary({ children = CTA }: { children?: ReactNode }) {
  return (
    <Link to="/login" className="btn btn-primary">
      {children}
      <ArrowRight size={16} aria-hidden="true" />
    </Link>
  );
}

function Wordmark() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <Warehouse size={20} aria-hidden="true" />
      <span>
        Dock<span className="wordmark-iq">IQ</span>
      </span>
    </span>
  );
}

const QUEUE: { severity: Severity; dock: number; what: string; who: string; wait: string }[] = [
  {
    severity: 'critical',
    dock: 5,
    what: 'Product temperature out of range',
    who: 'Lisa Chen · Bulkhaven Club',
    wait: '2m',
  },
  {
    severity: 'high',
    dock: 12,
    what: 'Crushed or collapsed pallet',
    who: 'Mike Johnson · Marlow Grocers',
    wait: '6m',
  },
  {
    severity: 'medium',
    dock: 7,
    what: 'Incorrect loading sequence',
    who: 'Jay Patel · Beacon Goods',
    wait: '9m',
  },
];

const PREVIEW_NAV: { icon: typeof Warehouse; label: string }[] = [
  { icon: LayoutGrid, label: 'Floor' },
  { icon: ClipboardList, label: 'Issue log' },
  { icon: BarChart3, label: 'Analytics' },
  { icon: Repeat2, label: 'Handoff' },
  { icon: Radio, label: 'Simulator' },
  { icon: MessageSquare, label: 'Assistant' },
];

/** The product preview panel: the supervisor's floor, sidebar and all, in sample data. */
function ProductPreview() {
  return (
    <figure className="overflow-hidden rounded-xl border border-hairline bg-surface text-left shadow-float">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Warehouse size={16} aria-hidden="true" /> DockIQ · Zone A
        </span>
        <span className="label">Sample data</span>
      </div>
      <div className="flex">
        <ul className="hidden shrink-0 border-r border-hairline p-2 sm:block" aria-hidden="true">
          {PREVIEW_NAV.map(({ icon: Icon, label }, index) => (
            <li
              key={label}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${index === 0 ? 'bg-paper-sunk font-medium text-ink' : 'text-ink-soft'}`}
            >
              <Icon size={15} /> {label}
            </li>
          ))}
        </ul>
        <div className="min-w-0 flex-1 p-3">
          <p className="px-1 pb-2 text-sm font-semibold">Priority queue</p>
          <ol className="flex flex-col gap-1.5">
            {QUEUE.map((row) => {
              const critical = row.severity === 'critical';
              return (
                <li key={row.dock} className="flex items-center gap-3 rounded-lg border border-hairline p-2">
                  <span
                    className={`grid h-12 w-11 shrink-0 place-content-center rounded-md text-center ${critical ? 'bg-hazard text-white' : 'bg-paper-sunk'}`}
                  >
                    <span className="num text-xl leading-none">{row.dock}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <SeverityBadge severity={row.severity} size="sm" />
                    <span className="mt-1 block truncate text-sm font-semibold">{row.what}</span>
                    <span className="block truncate text-sm text-ink-mute">{row.who}</span>
                  </span>
                  <span className="telemetry shrink-0 text-sm">{row.wait}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </figure>
  );
}

const DERIVATION: [string, string][] = [
  ['Temperature Deviation', '5'],
  ['Frozen product', '× 3.0'],
  ['Tier 1 customer', '× 1.5'],
  ['28°F over a 0°F limit', '+ 5'],
];

function Derivation() {
  return (
    <div className="card p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="heading text-xl">Frozen seafood, dock five</p>
        <span className="label">Sample data</span>
      </div>
      <dl className="mt-4">
        {DERIVATION.map(([factor, value]) => (
          <div
            key={factor}
            className="flex items-baseline justify-between gap-4 border-b border-hairline py-3"
          >
            <dt className="text-base text-ink-soft">{factor}</dt>
            <dd className="telemetry text-base">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <p className="num text-5xl">27.5</p>
        <SeverityBadge severity="critical" size="lg" />
      </div>
    </div>
  );
}

const ROLES: { who: string; line: string; detail: string }[] = [
  {
    who: 'The operator',
    line: 'A tablet at the door, and a calm answer.',
    detail:
      'Scan a case and a wrong product stops the load before it ships. Report a problem by voice or photo, get the procedure for this product and customer, and close it yourself when you can.',
  },
  {
    who: 'The supervisor',
    line: 'Their own queue, worst first.',
    detail:
      'Every escalation with what the operator already tried, and one tap to say “on my way” so nobody waits in silence.',
  },
  {
    who: 'Quality',
    line: 'Every cold-chain break, as it happens.',
    detail:
      'Temperature, product and lot issues from every zone, the moment they are raised — with the pallets already on hold.',
  },
];

const NAV_LINKS: [string, string][] = [
  ['#load-plans', 'Load plans'],
  ['#scoring', 'Scoring'],
  ['#roles', 'Roles'],
];

export default function Landing() {
  const root = useReveal();
  return (
    <div ref={root} className="min-h-dvh bg-paper text-ink">
      <p className="signal-strip px-4 py-2.5 text-center text-sm font-medium">
        DockIQ is a prototype on simulated data — every company, trailer, person and pallet is fictional.{' '}
        <Link to="/login" className="inline-flex items-center gap-1 underline">
          Open the demo <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </p>

      <header className="sticky top-0 z-20 border-b border-hairline bg-surface">
        <nav
          aria-label="Site"
          className="mx-auto flex h-16 max-w-page items-center justify-between gap-6 px-6"
        >
          <Link to="/" className="flex items-center text-lg">
            <Wordmark />
          </Link>
          <div className="hidden items-center gap-6 md:flex">
            {NAV_LINKS.map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="flex items-center text-sm font-medium text-ink hover:text-ink-soft"
              >
                {label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Link to="/login" className="btn btn-pill hidden sm:inline-flex">
              Sign in
            </Link>
            <Primary>Get started</Primary>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero: a 50/50 split — the claim and the actions, then the product preview panel */}
        <section className="mx-auto grid max-w-page items-center gap-12 px-6 py-20 lg:grid-cols-2">
          <div className="enter in">
            <h1 className="display text-5xl leading-none sm:text-6xl">Every dock door, triaged.</h1>
            <p className="mt-6 max-w-lg text-lg text-ink-soft">
              Operators get the right procedure in seconds, supervisors see the worst problem first, and
              Quality hears about cold-chain breaks as they happen.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Primary />
              <a href="#scoring" className="btn btn-secondary">
                How it scores
              </a>
            </div>
          </div>
          <div className="enter in">
            <ProductPreview />
          </div>
        </section>

        {/* Load plans — a white band */}
        <section id="load-plans" className="border-y border-hairline bg-surface py-20">
          <div className="mx-auto max-w-page px-6">
            <div className="enter max-w-2xl">
              <h2 className="section-heading text-3xl">The load, drawn before it is lifted.</h2>
              <p className="mt-4 text-lg text-ink-soft">
                Stack height, heavy on the bottom, slip sheets, pinwheel or straight. DockIQ lays out every
                pallet of the order by that customer&apos;s rules and walks the operator through it, from the
                dock door.
              </p>
            </div>
            <div className="enter mt-10 rounded-xl border border-hairline bg-paper p-3 shadow-float sm:p-6">
              <p className="label mb-4">Sample data · Crestline Markets, outbound</p>
              <LoadPlanView plan={SAMPLE_PLAN} persist={false} />
            </div>
          </div>
        </section>

        {/* Scoring — the drafting-gray band */}
        <section id="scoring" className="py-20">
          <div className="mx-auto grid max-w-page items-center gap-12 px-6 lg:grid-cols-2">
            <div className="enter">
              <h2 className="section-heading text-3xl">A formula you can read.</h2>
              <p className="mt-4 text-lg text-ink-soft">
                Severity is a weighted score, not a model&apos;s guess. Issue type, product risk and customer
                tier multiply; temperature, shortage, allergens and trailer dwell add. Every issue shows its
                working, and an injury is always critical.
              </p>
            </div>
            <div className="enter">
              <Derivation />
            </div>
          </div>
        </section>

        {/* Roles — a white band with three feature cards */}
        <section id="roles" className="border-y border-hairline bg-surface py-20">
          <div className="mx-auto max-w-page px-6">
            <h2 className="enter section-heading text-3xl">Three people, one floor.</h2>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {ROLES.map((role) => (
                <article key={role.who} className="enter card p-7">
                  <p className="label">{role.who}</p>
                  <h3 className="heading mt-2 text-xl">{role.line}</h3>
                  <p className="mt-3 text-base text-ink-soft">{role.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Close — the drafting-gray band */}
        <section className="py-20">
          <div className="enter mx-auto flex max-w-page flex-wrap items-end justify-between gap-8 px-6">
            <div className="max-w-2xl">
              <h2 className="section-heading text-3xl">Walk the floor at your own pace.</h2>
              <p className="mt-4 text-lg text-ink-soft">
                Sign in as an operator, a supervisor or Quality. Every company, product and person is
                fictional.
              </p>
            </div>
            <Primary />
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline bg-surface">
        <div className="mx-auto grid max-w-page gap-10 px-6 py-12 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Wordmark />
            <p className="mt-3 text-sm text-ink-soft">© 2026 DockIQ. Prototype on fictional data.</p>
          </div>
          <div>
            <p className="text-sm font-semibold">Product</p>
            <ul className="mt-3 flex flex-col">
              {NAV_LINKS.map(([href, label]) => (
                <li key={href}>
                  <a href={href} className="flex items-center text-sm text-ink hover:text-ink-soft">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Demo</p>
            <ul className="mt-3 flex flex-col">
              <li>
                <Link to="/login" className="flex items-center text-sm text-ink hover:text-ink-soft">
                  Sign in
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
