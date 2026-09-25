/**
 * The product page, in the manner of apple.com: a black hero, light feature sections, a bento of
 * roles, a black close. Every preview is a real DockIQ component rendering sample data, labelled as
 * such — no mocked-up screenshots, no invented metrics.
 */
import { ChevronRight, Warehouse } from 'lucide-react';
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
    <Link to="/login" className="btn btn-primary px-7">
      {children}
    </Link>
  );
}

/** Apple's "Learn more >" link. */
function More({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-0.5 text-base font-medium text-night-link hover:underline"
    >
      {children}
      <ChevronRight size={18} aria-hidden="true" />
    </a>
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
    <figure className="mx-auto w-full max-w-2xl overflow-hidden rounded-2xl bg-surface text-ink shadow-float">
      <figcaption className="flex items-center justify-between px-5 pt-4 pb-2">
        <span className="heading text-lg">Priority queue</span>
        <span className="label">Sample data</span>
      </figcaption>
      <ol className="px-3 pb-3">
        {QUEUE.map((row) => {
          const critical = row.severity === 'critical';
          return (
            <li
              key={row.dock}
              className={`my-1 flex items-center gap-3 rounded-lg p-2 ${critical ? 'bg-hazard-soft' : ''}`}
            >
              <span
                className={`grid h-14 w-12 shrink-0 place-content-center rounded-md text-center ${critical ? 'bg-hazard text-white' : 'bg-paper-sunk'}`}
              >
                <span className="num text-2xl leading-none">{row.dock}</span>
              </span>
              <span className="min-w-0 flex-1 text-left">
                <SeverityBadge severity={row.severity} size="sm" />
                <span className="mt-1 block truncate text-base font-semibold">{row.what}</span>
                <span className="block truncate text-sm text-ink-mute">{row.who}</span>
              </span>
              <span className="telemetry shrink-0 text-lg">{row.wait}</span>
            </li>
          );
        })}
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
    <div className="rounded-2xl bg-surface p-6 text-ink shadow-card sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="heading text-xl">Frozen seafood, dock 5</p>
        <span className="label">Sample data</span>
      </div>
      <dl className="mt-3">
        {DERIVATION.map(([factor, value]) => (
          <div
            key={factor}
            className="flex items-baseline justify-between gap-4 border-b border-hairline py-3"
          >
            <dt className="text-lg">{factor}</dt>
            <dd className="telemetry text-xl">{value}</dd>
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

const FACTS: [string, string][] = [
  ['12', 'issue types'],
  ['87', 'situations an operator can name'],
  ['41', 'procedures with a cited source'],
  ['1', 'formula, the same every time'],
];

const NAV_LINKS: [string, string][] = [
  ['#scoring', 'Scoring'],
  ['#load-plans', 'Load plans'],
  ['#roles', 'Roles'],
];

export default function Landing() {
  const root = useReveal();
  return (
    <div ref={root} className="min-h-dvh bg-paper text-ink">
      {/* Global nav: a translucent dark bar, as on apple.com */}
      <header className="sticky top-0 z-20 border-b border-night-rule bg-night/80 text-white backdrop-blur-xl backdrop-saturate-150">
        <nav
          aria-label="Site"
          className="mx-auto flex h-13 max-w-5xl items-center justify-between gap-6 px-4 sm:px-6"
        >
          <Link to="/" className="flex items-center gap-2 text-base font-semibold">
            <Warehouse size={20} aria-hidden="true" /> DockIQ
          </Link>
          <div className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="text-sm text-night-mute transition-colors hover:text-white"
              >
                {label}
              </a>
            ))}
          </div>
          <Link
            to="/login"
            className="inline-flex items-center rounded-full bg-accent px-4 text-sm font-semibold text-white"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="overflow-hidden bg-night px-4 pt-20 pb-24 text-center text-white sm:px-6 sm:pt-28">
          <div className="enter in mx-auto max-w-4xl">
            <p className="text-lg font-semibold text-night-mute">DockIQ</p>
            <h1 className="display mt-2 text-5xl sm:text-6xl">Every dock door. Triaged.</h1>
            <p className="mx-auto mt-6 max-w-2xl text-xl text-night-mute sm:text-2xl">
              Operators get the right procedure in seconds. Supervisors see the worst problem first. Quality
              hears about cold-chain breaks as they happen.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
              <Primary />
              <More href="#scoring">How it scores</More>
            </div>
          </div>
          <div className="enter mx-auto mt-16 max-w-5xl">
            <QueuePreview />
          </div>
        </section>

        {/* Facts */}
        <section aria-label="In numbers" className="bg-night px-4 pb-24 text-white sm:px-6">
          <dl className="mx-auto grid max-w-5xl grid-cols-2 gap-y-12 border-t border-night-rule pt-16 lg:grid-cols-4">
            {FACTS.map(([value, label]) => (
              <div key={label} className="enter px-2 text-center">
                <dt className="sr-only">{label}</dt>
                <dd>
                  <span className="num block text-6xl">{value}</span>
                  <span className="mt-2 block text-lg text-night-mute">{label}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Scoring */}
        <section id="scoring" className="px-4 py-24 sm:px-6 sm:py-32">
          <div className="mx-auto grid max-w-5xl items-center gap-12 lg:grid-cols-2">
            <div className="enter">
              <h2 className="display text-4xl sm:text-5xl">A formula you can read.</h2>
              <p className="mt-6 text-xl text-ink-mute">
                Severity is a weighted score, not a model&apos;s guess. Issue type, product risk and customer
                tier multiply; temperature, shortage, allergens and trailer dwell add. Every issue shows its
                working.
              </p>
              <p className="mt-4 text-xl text-ink-mute">
                An injury is always critical. No score can talk it down.
              </p>
            </div>
            <div className="enter">
              <Derivation />
            </div>
          </div>
        </section>

        {/* Load plans */}
        <section id="load-plans" className="bg-surface px-4 py-24 sm:px-6 sm:py-32">
          <div className="mx-auto max-w-5xl">
            <div className="enter mx-auto max-w-3xl text-center">
              <h2 className="display text-4xl sm:text-5xl">The load, drawn for each customer.</h2>
              <p className="mt-6 text-xl text-ink-mute">
                Stack height, heavy on the bottom, slip sheets, pinwheel or straight. DockIQ lays out every
                pallet of the order by that customer&apos;s rules and walks the operator through it, step by
                step.
              </p>
            </div>
            <div className="enter mt-14 rounded-2xl bg-paper p-4 sm:p-6">
              <p className="label mb-4">Sample data · Crestline Markets, outbound</p>
              <LoadPlanView plan={SAMPLE_PLAN} />
            </div>
          </div>
        </section>

        {/* Roles: a bento grid */}
        <section id="roles" className="px-4 py-24 sm:px-6 sm:py-32">
          <div className="mx-auto max-w-5xl">
            <h2 className="enter display text-center text-4xl sm:text-5xl">Three people. One floor.</h2>
            <div className="mt-14 grid gap-4 lg:grid-cols-3 lg:grid-rows-2">
              <article className="enter card p-8 lg:col-span-2 lg:row-span-2 sm:p-10">
                <p className="text-base font-semibold text-accent-ink">The operator</p>
                <h3 className="display mt-2 text-3xl">A tablet at the dock door.</h3>
                <p className="mt-4 max-w-xl text-lg text-ink-mute">
                  Scan a case and a wrong product stops the load before it ships. Report a problem with photos
                  or by voice, and get the procedure that fits this product and this customer.
                </p>
                <ul className="mt-8 grid gap-3 text-base font-semibold sm:grid-cols-2">
                  {[
                    'Barcode scan with mismatch stop',
                    'Trailer inspection by the load’s limits',
                    'Photo and voice reports',
                    'Load plan per customer',
                  ].map((item) => (
                    <li key={item} className="rounded-lg bg-paper px-4 py-3">
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
              <article className="enter card p-8">
                <p className="text-base font-semibold text-accent-ink">The supervisor</p>
                <p className="heading mt-2 text-xl">Their own team&apos;s queue, critical first.</p>
                <p className="mt-2 text-base text-ink-mute">
                  With what the operator already tried, and one tap to say “on my way”.
                </p>
              </article>
              <article className="enter card p-8">
                <p className="text-base font-semibold text-accent-ink">Quality</p>
                <p className="heading mt-2 text-xl">Every cold-chain break, as it happens.</p>
                <p className="mt-2 text-base text-ink-mute">
                  Temperature, product and lot issues across all zones, the moment they are raised.
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* Closing */}
        <section className="bg-night px-4 py-24 text-center text-white sm:px-6 sm:py-32">
          <div className="enter mx-auto max-w-3xl">
            <h2 className="display text-4xl sm:text-5xl">Walk the floor.</h2>
            <p className="mt-5 text-xl text-night-mute">
              Sign in as an operator, a supervisor or Quality. Every company, product and person is fictional.
            </p>
            <div className="mt-9">
              <Primary />
            </div>
          </div>
        </section>
      </main>

      <footer className="px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap justify-between gap-4 border-t border-hairline pt-6 text-sm text-ink-mute">
          <p>© 2026 DockIQ. Prototype on fictional data.</p>
          <p>Prepared by Rishabh Gupta</p>
        </div>
      </footer>
    </div>
  );
}
