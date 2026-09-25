/**
 * The landing page, in the Botanical / Organic Serif style: rice paper and grain, Playfair headlines
 * with italic emphasis, an arch framing the product, a thin vine between sections, staggered cards.
 * Every preview is a real DockIQ component rendering sample data, labelled as such.
 */
import { ArrowRight, Leaf, ShieldCheck, Thermometer, UserRound } from 'lucide-react';
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
      <ArrowRight size={18} aria-hidden="true" />
    </Link>
  );
}

/** A fine, meandering line between sections — a vine, not a divider. */
function Vine({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 1200 80"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`block h-16 w-full text-sage ${flip ? '-scale-x-100' : ''}`}
    >
      <path
        d="M0 40 C 150 5, 300 75, 450 40 S 750 5, 900 40 S 1100 70, 1200 30"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path d="M452 40 c 8 -14 22 -18 30 -14 c -6 10 -18 16 -30 14z" fill="currentColor" opacity="0.5" />
      <path d="M902 40 c 8 14 22 18 30 14 c -6 -10 -18 -16 -30 -14z" fill="currentColor" opacity="0.5" />
    </svg>
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
    <figure className="card w-full overflow-hidden text-left shadow-float">
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
              <span className="min-w-0 flex-1">
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
    <div className="card p-7 sm:p-9">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="heading text-xl">
          Frozen seafood, <em>dock five</em>
        </p>
        <span className="label">Sample data</span>
      </div>
      <dl className="mt-4">
        {DERIVATION.map(([factor, value]) => (
          <div
            key={factor}
            className="flex items-baseline justify-between gap-4 border-b border-hairline py-3.5"
          >
            <dt className="text-lg">{factor}</dt>
            <dd className="num text-xl">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
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

const ROLES: { icon: typeof Leaf; who: string; line: ReactNode; detail: string }[] = [
  {
    icon: UserRound,
    who: 'The operator',
    line: (
      <>
        A tablet at the door, <em>and a calm answer.</em>
      </>
    ),
    detail:
      'Scan a case and a wrong product stops the load before it ships. Report a problem by voice or photo and get the procedure for this product and this customer.',
  },
  {
    icon: ShieldCheck,
    who: 'The supervisor',
    line: (
      <>
        Their own queue, <em>worst first.</em>
      </>
    ),
    detail:
      'Every escalation with what the operator already tried, and one tap to say “on my way” so nobody waits in silence.',
  },
  {
    icon: Thermometer,
    who: 'Quality',
    line: (
      <>
        Every cold-chain break, <em>as it happens.</em>
      </>
    ),
    detail: 'Temperature, product and lot issues from every zone, the moment they are raised.',
  },
];

const NAV_LINKS: [string, string][] = [
  ['#scoring', 'Scoring'],
  ['#load-plans', 'Load plans'],
  ['#roles', 'Roles'],
];

export default function Landing() {
  const root = useReveal();
  return (
    <div ref={root} className="min-h-dvh text-ink">
      <header className="material sticky top-0 z-20 border-b border-hairline">
        <nav
          aria-label="Site"
          className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-5 sm:px-8"
        >
          <Link to="/" className="display flex items-center gap-2.5 text-2xl">
            <Leaf size={22} aria-hidden="true" className="text-sage-ink" />
            Dock<em>IQ</em>
          </Link>
          <div className="hidden items-center gap-9 md:flex">
            {NAV_LINKS.map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="text-base text-ink-soft transition-colors duration-300 hover:text-accent-ink"
              >
                {label}
              </a>
            ))}
          </div>
          <Link to="/login" className="btn btn-primary min-h-11 px-5">
            Sign in
          </Link>
        </nav>
      </header>

      <main>
        {/* Hero: words on the left, the product framed in an arch on the right */}
        <section className="mx-auto grid max-w-7xl items-center gap-16 px-5 pt-16 pb-12 sm:px-8 lg:grid-cols-2 lg:pt-24">
          <div className="enter in">
            <p className="eyebrow">Dock-door intelligence for cold storage</p>
            <h1 className="display mt-5 text-5xl sm:text-6xl">
              Every dock door, <em>calmly</em> triaged.
            </h1>
            <p className="mt-7 max-w-xl text-xl text-ink-soft">
              Operators get the right procedure in seconds. Supervisors see the worst problem first. Quality
              hears about cold-chain breaks as they happen.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Primary />
              <a href="#scoring" className="btn btn-secondary">
                How it scores
              </a>
            </div>
          </div>
          <div className="enter relative mx-auto w-full max-w-lg">
            <div aria-hidden="true" className="arch aspect-4/5 w-full bg-accent-soft" />
            <div className="absolute inset-x-0 bottom-10 px-4 sm:-left-10 sm:px-0">
              <div className="-rotate-1">
                <QueuePreview />
              </div>
            </div>
          </div>
        </section>

        <Vine />

        {/* In numbers */}
        <section aria-label="In numbers" className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
          <dl className="grid grid-cols-2 gap-y-12 md:grid-cols-4">
            {FACTS.map(([value, label]) => (
              <div key={label} className="enter px-2 text-center">
                <dt className="sr-only">{label}</dt>
                <dd>
                  <span className="num block text-6xl">{value}</span>
                  <span className="mt-2 block text-lg text-ink-mute italic">{label}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Scoring */}
        <section id="scoring" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
          <div className="grid items-center gap-16 lg:grid-cols-2">
            <div className="enter">
              <p className="eyebrow">Explainable, not magic</p>
              <h2 className="display mt-4 text-4xl sm:text-5xl">
                A formula <em>you can read.</em>
              </h2>
              <p className="mt-7 text-xl text-ink-soft">
                Severity is a weighted score, not a model&apos;s guess. Issue type, product risk and customer
                tier multiply; temperature, shortage, allergens and trailer dwell add. Every issue shows its
                working.
              </p>
              <p className="mt-4 text-xl text-ink-soft">
                An injury is always critical. No score can talk it down.
              </p>
            </div>
            <div className="enter">
              <Derivation />
            </div>
          </div>
        </section>

        <Vine flip />

        {/* Load plans */}
        <section id="load-plans" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
          <div className="enter mx-auto max-w-3xl text-center">
            <p className="eyebrow">For each customer</p>
            <h2 className="display mt-4 text-4xl sm:text-5xl">
              The load, <em>drawn</em> before it is lifted.
            </h2>
            <p className="mt-7 text-xl text-ink-soft">
              Stack height, heavy on the bottom, slip sheets, pinwheel or straight. DockIQ lays out every
              pallet of the order by that customer&apos;s rules and walks the operator through it, step by
              step.
            </p>
          </div>
          <div className="enter mt-16 rounded-3xl bg-paper-sunk p-4 sm:p-8">
            <p className="label mb-4">Sample data · Crestline Markets, outbound</p>
            <LoadPlanView plan={SAMPLE_PLAN} />
          </div>
        </section>

        {/* Roles: staggered cards */}
        <section id="roles" className="mx-auto max-w-7xl px-5 pt-8 pb-32 sm:px-8">
          <h2 className="enter display text-center text-4xl sm:text-5xl">
            Three people, <em>one floor.</em>
          </h2>
          <div className="mt-16 grid gap-8 md:grid-cols-3 md:gap-10">
            {ROLES.map((role, index) => (
              <article
                key={role.who}
                className={`enter card lift p-8 ${index % 2 === 1 ? 'md:translate-y-12' : ''}`}
              >
                <span className="grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-sage-ink">
                  <role.icon size={26} aria-hidden="true" />
                </span>
                <p className="eyebrow mt-6">{role.who}</p>
                <h3 className="heading mt-2 text-2xl">{role.line}</h3>
                <p className="mt-4 text-base text-ink-mute">{role.detail}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Closing: a deep-forest band */}
        <section className="bg-night px-5 py-28 text-center text-white sm:px-8">
          <div className="enter mx-auto max-w-3xl">
            <h2 className="display text-4xl sm:text-5xl">
              Walk the floor, <em className="text-night-mute">at your own pace.</em>
            </h2>
            <p className="mt-6 text-xl text-night-mute">
              Sign in as an operator, a supervisor or Quality. Every company, product and person is fictional.
            </p>
            <Link to="/login" className="btn mt-10 bg-white text-night hover:bg-paper-sunk">
              {CTA}
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-4 text-sm text-ink-mute">
          <p>© 2026 DockIQ. Prototype on fictional data.</p>
          <p>Prepared by Rishabh Gupta</p>
        </div>
      </footer>
    </div>
  );
}
