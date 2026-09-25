/**
 * The marketing surface: dark, desk-viewed (rules §2.2). Every preview here is a real DockIQ
 * component rendering sample data, labelled as such — no mocked-up screenshots, no invented metrics.
 */
import { ArrowRight } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';

import type { Severity } from '../api/types';
import { LoadPlanView } from '../components/LoadPlanView';
import { SeverityBadge } from '../components/Severity';
import { SAMPLE_PLAN } from './landing/samplePlan';

const CTA = 'Open the demo';

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

function Primary({ children = CTA }: { children?: ReactNode }) {
  return (
    <Link to="/login" className="btn btn-hazard text-lg">
      {children}
      <ArrowRight size={20} aria-hidden="true" />
    </Link>
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

function QueuePreview() {
  return (
    <figure className="border-2 border-paper bg-paper text-ink">
      <figcaption className="flex items-center justify-between border-b-2 border-ink px-4 py-2">
        <span className="heading text-lg">Priority queue</span>
        <span className="label">Sample data</span>
      </figcaption>
      <ol>
        {QUEUE.map((row) => (
          <li
            key={row.dock}
            className={`flex border-b-2 border-ink last:border-b-0 ${row.severity === 'critical' ? 'bg-light' : ''}`}
          >
            {row.severity === 'critical' && <span className="hazard-tape w-3 shrink-0" aria-hidden="true" />}
            <span className="grid w-16 shrink-0 place-items-center border-r-2 border-ink">
              <span className="display text-3xl">{row.dock}</span>
            </span>
            <span className="min-w-0 flex-1 p-3">
              <SeverityBadge severity={row.severity} size="sm" />
              <span className="mt-1.5 block truncate font-bold">{row.what}</span>
              <span className="block truncate text-sm text-ink-soft">{row.who}</span>
            </span>
            <span className="telemetry grid w-16 shrink-0 place-items-center border-l-2 border-ink text-lg">
              {row.wait}
            </span>
          </li>
        ))}
      </ol>
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
    <div className="border-2 border-paper bg-paper p-6 text-ink sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-ink pb-4">
        <p className="heading text-xl">Frozen seafood, Dock 5</p>
        <span className="label">Sample data</span>
      </div>
      <dl className="mt-2">
        {DERIVATION.map(([factor, value]) => (
          <div
            key={factor}
            className="flex items-baseline justify-between gap-4 border-b border-hairline py-3"
          >
            <dt className="text-lg">{factor}</dt>
            <dd className="telemetry text-2xl">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <p className="telemetry text-5xl">27.5</p>
        <SeverityBadge severity="critical" size="lg" />
      </div>
    </div>
  );
}

const FACTS: [string, string][] = [
  ['12', 'issue types'],
  ['87', 'situations an operator can name'],
  ['41', 'procedures with a cited source'],
  ['1', 'formula, the same every time'],
];

export default function Landing() {
  const root = useReveal();
  return (
    <div ref={root} className="min-h-dvh bg-night text-paper">
      <header className="sticky top-0 z-20 border-b-2 border-night-rule bg-night">
        <nav
          aria-label="Site"
          className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6"
        >
          <Link to="/" className="display text-2xl">
            DockIQ
          </Link>
          <div className="hidden items-center gap-7 md:flex">
            <a href="#scoring" className="font-semibold text-night-mute hover:text-paper">
              Scoring
            </a>
            <a href="#load-plans" className="font-semibold text-night-mute hover:text-paper">
              Load plans
            </a>
            <a href="#roles" className="font-semibold text-night-mute hover:text-paper">
              Roles
            </a>
          </div>
          <Link to="/login" className="btn border-paper bg-paper text-ink">
            {CTA}
          </Link>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-5 lg:pt-20">
          <div className="enter in lg:col-span-3">
            <h1 className="display text-5xl lg:text-6xl">Every dock door, triaged.</h1>
            <p className="mt-6 max-w-xl text-xl text-night-mute">
              Operators get the right procedure in seconds. Supervisors see the worst problem first. Quality
              hears about cold-chain breaks as they happen.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Primary />
              <a href="#scoring" className="btn border-paper bg-transparent text-paper">
                How it scores
              </a>
            </div>
          </div>
          <div className="enter lg:col-span-2">
            <QueuePreview />
          </div>
        </section>

        {/* Facts */}
        <section aria-label="In numbers" className="border-y-2 border-night-rule">
          <dl className="mx-auto grid max-w-7xl grid-cols-2 lg:grid-cols-4">
            {FACTS.map(([value, label], index) => (
              <div
                key={label}
                className={`enter px-4 py-10 sm:px-6 ${index > 0 ? 'lg:border-l-2 lg:border-night-rule' : ''} ${index % 2 === 1 ? 'border-l-2 border-night-rule lg:border-l-2' : ''}`}
              >
                <dt className="sr-only">{label}</dt>
                <dd>
                  <span className="display block text-6xl">{value}</span>
                  <span className="mt-2 block text-lg text-night-mute">{label}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Scoring */}
        <section id="scoring" className="mx-auto grid max-w-7xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-5">
          <div className="enter lg:col-span-2">
            <h2 className="display text-4xl sm:text-5xl">A formula you can read.</h2>
            <p className="mt-6 text-xl text-night-mute">
              Severity is a weighted score, not a model&apos;s guess. Issue type, product risk and customer
              tier multiply; temperature, shortage, allergens and trailer dwell add. Every issue shows its
              working.
            </p>
            <p className="mt-4 text-xl text-night-mute">
              An injury is always critical. No score can talk it down.
            </p>
          </div>
          <div className="enter lg:col-span-3">
            <Derivation />
          </div>
        </section>

        {/* Load plans */}
        <section id="load-plans" className="border-t-2 border-night-rule bg-night-raised">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
            <div className="enter max-w-3xl">
              <h2 className="display text-4xl sm:text-5xl">The load, drawn for each customer.</h2>
              <p className="mt-6 text-xl text-night-mute">
                Stack height, heavy-on-the-bottom, slip sheets, pinwheel or straight. DockIQ lays out every
                pallet of the order by that customer&apos;s rules and walks the operator through it, step by
                step.
              </p>
            </div>
            <div className="enter mt-12 border-2 border-paper bg-paper p-4 text-ink sm:p-6">
              <p className="label mb-4">Sample data · Crestline Markets, outbound</p>
              <LoadPlanView plan={SAMPLE_PLAN} />
            </div>
          </div>
        </section>

        {/* Roles */}
        <section id="roles" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <h2 className="enter display max-w-3xl text-4xl sm:text-5xl">Three people, one floor.</h2>
          <div className="mt-12 grid gap-0.5 border-2 border-night-rule bg-night-rule lg:grid-cols-3 lg:grid-rows-2">
            <article className="enter bg-paper p-8 text-ink lg:col-span-2 lg:row-span-2">
              <h3 className="display text-3xl">The operator</h3>
              <p className="mt-4 max-w-xl text-xl text-ink-soft">
                A tablet at the dock door. Scan a case and a wrong product stops the load before it ships.
                Report a problem with photos or by voice, and get the procedure that fits this product and
                this customer.
              </p>
              <ul className="mt-8 grid gap-3 text-lg font-semibold sm:grid-cols-2">
                <li>Barcode scan with mismatch stop</li>
                <li>Trailer inspection by the load&apos;s limits</li>
                <li>Photo and voice reports</li>
                <li>Load plan per customer</li>
              </ul>
            </article>
            <article className="enter bg-night p-8">
              <h3 className="heading text-2xl">The supervisor</h3>
              <p className="mt-3 text-lg text-night-mute">
                Their own team&apos;s queue, critical first, with what the operator already tried.
              </p>
            </article>
            <article className="enter bg-night p-8">
              <h3 className="heading text-2xl">Quality</h3>
              <p className="mt-3 text-lg text-night-mute">
                Every temperature, product and lot issue across all zones, the moment it is raised.
              </p>
            </article>
          </div>
        </section>

        {/* Closing */}
        <section className="border-t-2 border-night-rule">
          <div className="enter mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-8 px-4 py-24 sm:px-6">
            <div>
              <h2 className="display text-4xl sm:text-5xl">Walk the floor.</h2>
              <p className="mt-4 max-w-xl text-xl text-night-mute">
                Sign in as an operator, a supervisor or Quality. Every company, product and person is
                fictional.
              </p>
            </div>
            <Primary />
          </div>
        </section>
      </main>

      <footer className="border-t-2 border-night-rule">
        <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-4 px-4 py-8 text-night-mute sm:px-6">
          <p>© 2026 DockIQ. Prototype on fictional data.</p>
          <p>Prepared by Rishabh Gupta</p>
        </div>
      </footer>
    </div>
  );
}
