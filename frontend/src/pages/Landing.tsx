/**
 * The landing page, in the owner's GSAP reference: the green announcement bar, a carved two-line
 * headline with soft shapes drifting through it, a bracketed note beside the gradient-stroked CTA, a
 * statement that lights word by word as it scrolls, a highlighter montage, then the tool rows — each
 * with its shape, its category word in its own hue, and a real DockIQ component rendering sample
 * data. A cream terminator closes the page.
 */
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  ClipboardList,
  LayoutGrid,
  MessageSquare,
  Radio,
  Repeat2,
  Warehouse,
} from 'lucide-react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';

import type { Severity } from '../api/types';
import { LoadPlanView } from '../components/LoadPlanView';
import { SeverityBadge } from '../components/Severity';
import { SAMPLE_PLAN } from './landing/samplePlan';
import {
  Clover,
  ColdDrop,
  Diamond,
  DockDoor,
  Dome,
  DoorGrid,
  Hourglass,
  PalletStack,
  Probe,
  Ring,
  Spark,
  Squiggle,
} from './landing/Shapes';

gsap.registerPlugin(useGSAP, SplitText);

/**
 * The hero, built as gsap.com builds its own: each letter rises out of its own mask, the shapes
 * arrive out of a blur between them. Once, on load; with reduced motion the finished headline shows.
 */
function useHeroBuild() {
  const hero = useRef<HTMLElement>(null);
  // Split only once the faces are in, so each letter's box is its real width.
  const [fontsReady, setFontsReady] = useState(() => document.fonts.status === 'loaded');
  useEffect(() => {
    if (fontsReady) return undefined;
    let live = true;
    void document.fonts.ready.then(() => {
      if (live) setFontsReady(true);
    });
    return () => {
      live = false;
    };
  }, [fontsReady]);
  useGSAP(
    () => {
      const title = hero.current?.querySelector('h1');
      if (!title || !fontsReady) return;
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        title.setAttribute('data-split', '');
        const split = SplitText.create(title, {
          type: 'words,chars',
          mask: 'chars',
          charsClass: 'hero-char',
          aria: 'auto',
        });
        gsap.from(split.chars, {
          yPercent: 110,
          rotate: 8,
          duration: 1.1,
          ease: 'expo.out',
          stagger: 0.028,
        });
        gsap.from('.shape', {
          autoAlpha: 0,
          filter: 'blur(12px)',
          duration: 1.2,
          ease: 'power3.out',
          stagger: 0.14,
          delay: 0.5,
        });
        return () => {
          split.revert();
          title.removeAttribute('data-split');
        };
      });
      return () => mm.revert();
    },
    { scope: hero, dependencies: [fontsReady] },
  );
  return hero;
}

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
      <ArrowRight size={17} aria-hidden="true" />
    </Link>
  );
}

function Explore({ children }: { children: ReactNode }) {
  return (
    <Link to="/login" className="btn btn-secondary">
      {children}
      <ArrowUpRight size={17} aria-hidden="true" />
    </Link>
  );
}

function Wordmark({ size = 'text-xl' }: { size?: string }) {
  return (
    <span className={`flex items-center gap-2 font-bold tracking-tight ${size}`}>
      <span className="mark-green grid h-8 w-8 place-items-center rounded-full" aria-hidden="true">
        <Warehouse size={16} strokeWidth={2.2} />
      </span>
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
    <figure className="overflow-hidden rounded-xl border border-rule bg-surface text-left shadow-float">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Warehouse size={16} aria-hidden="true" /> DockIQ · Zone A
        </span>
        <span className="pill sim-tag">Sample data</span>
      </div>
      <div className="flex">
        <ul className="hidden shrink-0 border-r border-hairline p-2 sm:block" aria-hidden="true">
          {PREVIEW_NAV.map(({ icon: Icon, label }, index) => (
            <li
              key={label}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${index === 0 ? 'bg-accent font-semibold text-on-accent' : 'text-ink-soft'}`}
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
        <p className="serif-title text-2xl">Frozen seafood, dock five</p>
        <span className="pill sim-tag">Sample data</span>
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

/** A sentence that lights word by word as it scrolls into place; `green` words light in green. */
function Statement({ words }: { words: { text: string; green?: boolean }[] }) {
  let index = 0;
  return (
    <p className="statement">
      {words.map((word, group) =>
        word.text.split(' ').map((part) => {
          const style = { '--w': index++ } as CSSProperties;
          return (
            <span
              key={`${String(group)}-${String(index)}`}
              className={`scroll-word ${word.green ? 'scroll-word-green' : ''}`}
              style={style}
            >
              {part}{' '}
            </span>
          );
        }),
      )}
    </p>
  );
}

type Tool = {
  id?: string;
  explore: string;
  file: string;
  hue: string;
  name: string;
  line: string;
  body: string;
  shape: ReactNode;
  proof?: ReactNode;
};

const TOOLS: Tool[] = [
  {
    id: 'load-plans',
    file: 'file-people',
    hue: 'text-pink',
    name: 'Load plans',
    explore: 'Explore load plans',
    line: 'The load, drawn before it is lifted.',
    body: 'Stack height, heavy on the bottom, slip sheets, pinwheel or straight. DockIQ lays out every pallet of the order by that customer’s rules and walks the operator through it, from the dock door.',
    shape: <PalletStack className="tool-shape" />,
    proof: (
      <div className="mt-8 rounded-xl border border-hairline bg-surface p-3 sm:p-6">
        <p className="mb-4 flex flex-wrap items-center gap-2">
          <span className="pill sim-tag">Sample data</span>
          <span className="label">Crestline Markets, outbound</span>
        </p>
        <LoadPlanView plan={SAMPLE_PLAN} persist={false} />
      </div>
    ),
  },
  {
    id: 'scoring',
    file: 'file-orange',
    hue: 'text-orangey',
    name: 'Scoring',
    explore: 'Explore scoring',
    line: 'A formula you can read.',
    body: 'Severity is a weighted score, not a model’s guess. Issue type, product risk and customer tier multiply; temperature, shortage, allergens and trailer dwell add. Every issue shows its working, and an injury is always critical.',
    shape: <Probe className="tool-shape" />,
    proof: (
      <div className="mt-8 max-w-xl">
        <Derivation />
      </div>
    ),
  },
  {
    id: 'roles',
    file: 'file-green',
    hue: 'text-accent-ink',
    name: 'The operator',
    explore: 'Sign in as an operator',
    line: 'A tablet at the door, and a calm answer.',
    body: 'Scan a case and a wrong product stops the load before it ships. Report a problem by voice or photo, get the procedure for this product and customer, and close it yourself when you can.',
    shape: <DockDoor className="tool-shape" />,
  },
  {
    file: 'file-product',
    hue: 'text-blue-ink',
    name: 'The supervisor',
    explore: 'Sign in as a supervisor',
    line: 'Their own queue, worst first.',
    body: 'Every escalation with what the operator already tried, and one tap to say “on my way” so nobody waits in silence.',
    shape: <DoorGrid className="tool-shape" />,
    proof: (
      <div className="mt-8 max-w-2xl">
        <ProductPreview />
      </div>
    ),
  },
  {
    file: 'file-systems',
    hue: 'text-lilac-ink',
    name: 'Quality',
    explore: 'Sign in as Quality',
    line: 'Every cold-chain break, as it happens.',
    body: 'Temperature, product and lot issues from every zone, the moment they are raised — with the pallets already on hold.',
    shape: <ColdDrop className="tool-shape" />,
  },
];

const NAV_LINKS: [string, string][] = [
  ['#load-plans', 'Load plans'],
  ['#scoring', 'Scoring'],
  ['#roles', 'Roles'],
];

export default function Landing() {
  const root = useReveal();
  const hero = useHeroBuild();
  return (
    <div ref={root} className="min-h-dvh overflow-x-clip bg-paper text-ink">
      <p className="signal-strip px-4 py-2.5 text-center text-sm font-medium">
        DockIQ is a prototype on simulated data — every company, trailer, person and pallet is fictional.{' '}
        <Link to="/login" className="inline-flex items-center gap-1 font-semibold underline">
          Open the demo <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </p>

      <header className="material sticky top-0 z-20 border-b border-hairline">
        <nav
          aria-label="Site"
          className="mx-auto flex h-16 max-w-page items-center justify-between gap-6 px-6"
        >
          <Link to="/" className="flex items-center">
            <Wordmark />
          </Link>
          <div className="hidden items-center gap-7 md:flex">
            {NAV_LINKS.map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="link-draw flex items-center text-base text-ink-soft hover:text-ink"
              >
                {label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="link-draw hidden items-center px-2 text-base text-ink-soft hover:text-ink sm:flex"
            >
              Sign in
            </Link>
            <Primary>Get started</Primary>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero: the carved two-line claim, shapes drifting through it, the note and the action */}
        <section ref={hero} className="relative mx-auto max-w-page px-6 pt-14 pb-20 sm:pt-20">
          <Clover className="shape hero-clover" />
          <Squiggle className="shape hero-squiggle" />
          <Spark className="shape hero-spark" />
          <h1 className="hero-display relative">
            <span className="hero-line" style={{ '--i': 0 } as CSSProperties}>
              Every dock
            </span>
            <span className="hero-line hero-indent" style={{ '--i': 1 } as CSSProperties}>
              door, triaged.
            </span>
          </h1>
          <div className="enter in mt-14 flex flex-wrap items-center justify-between gap-8">
            <p className="bracket max-w-md text-lg text-ink-soft">
              Operators get the right procedure in seconds; supervisors see the worst problem first.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Primary />
              <a href="#scoring" className="btn btn-secondary">
                How it scores
              </a>
            </div>
          </div>
        </section>

        {/* Why: the statement lights as it scrolls */}
        <section className="relative mx-auto max-w-page border-t border-rule px-6 py-24">
          <div className="grid gap-8 lg:grid-cols-4">
            <p className="bracket hidden self-start text-sm text-ink-soft lg:inline-flex">Why DockIQ</p>
            <div className="relative lg:col-span-3">
              <Statement
                words={[
                  { text: 'Operators get the right procedure' },
                  { text: 'in seconds,', green: true },
                  {
                    text: 'supervisors see the worst problem first, and Quality hears about cold-chain breaks as they happen.',
                  },
                ]}
              />
              <Ring className="shape why-ring" />
            </div>
          </div>
        </section>

        {/* The montage: highlighter blocks among the shapes */}
        <section className="relative mx-auto max-w-page px-6 pt-8 pb-28" aria-label="Score, route, close">
          <div className="enter relative min-h-96">
            <p className="montage display text-5xl sm:text-6xl">
              <span className="montage-word hl hl-pink" style={{ '--i': 0 } as CSSProperties}>
                Score it
              </span>
              <br />
              <span
                className="montage-word montage-offset hl hl-orange"
                style={{ '--i': 1 } as CSSProperties}
              >
                route it
              </span>
              <br />
              <span className="montage-word hl hl-green" style={{ '--i': 2 } as CSSProperties}>
                close it.
              </span>
            </p>
            <Dome className="shape montage-dome" />
            <Clover className="shape montage-clover" />
            <Diamond className="shape montage-diamond" />
            <Hourglass className="shape montage-hourglass" />
            <p className="relative mt-14 max-w-sm text-lg text-ink-soft">
              A crushed pallet, a seal that does not match, a probe reading over the limit: DockIQ has the
              procedure, and the right person gets the call.
            </p>
          </div>
        </section>

        {/* The tools: one row each, the shape, the word in its hue, the claim and the proof */}
        <section className="mx-auto max-w-page px-6 pb-24" aria-label="DockIQ at work">
          <div>
            {TOOLS.map((tool) => (
              <article key={tool.name} id={tool.id} className={`tool-row enter ${tool.file}`}>
                <div className="tool-shape-cell">{tool.shape}</div>
                <div className="min-w-0">
                  <h3 className={`display text-4xl sm:text-5xl ${tool.hue}`}>{tool.name}</h3>
                  <p className="serif-title mt-4 text-2xl sm:text-3xl">{tool.line}</p>
                  <p className="mt-4 max-w-2xl text-lg text-ink-soft">{tool.body}</p>
                  <div className="mt-6">
                    <Explore>{tool.explore}</Explore>
                  </div>
                  {tool.proof}
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Close */}
        <section className="relative mx-auto max-w-page px-6 pt-8 pb-28">
          <div className="enter flex flex-wrap items-end justify-between gap-10">
            <h2 className="display max-w-4xl text-5xl sm:text-6xl">Walk the floor at your own pace.</h2>
            <div className="flex flex-col items-start gap-4">
              <Primary />
              <p className="max-w-xs text-base text-ink-mute">
                Sign in as an operator, a supervisor or Quality. Every company, product and person is
                fictional.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="border-t border-rule bg-night-raised">
          <div className="mx-auto grid max-w-page grid-cols-2 gap-10 px-6 py-14 sm:grid-cols-4">
            <div>
              <p className="text-sm font-semibold text-accent-ink">DockIQ</p>
              <ul className="mt-3 flex flex-col">
                {NAV_LINKS.map(([href, label]) => (
                  <li key={href}>
                    <a
                      href={href}
                      className="link-draw inline-flex items-center text-base text-ink-soft hover:text-ink"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-pink">Operators</p>
              <p className="mt-3 text-base text-ink-soft">Load, receive, inspect, report</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-ink">Supervisors</p>
              <p className="mt-3 text-base text-ink-soft">Triage, decide, hand off</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-lilac-ink">Quality</p>
              <p className="mt-3 text-base text-ink-soft">Hold, release, trace</p>
            </div>
          </div>
        </div>
        <div className="footer-cream">
          <div className="mx-auto flex max-w-page flex-wrap items-end justify-between gap-8 px-6 py-14">
            <div>
              <p className="serif-title max-w-md text-3xl">
                A prototype on fictional data, built to be read.
              </p>
              <Link
                to="/login"
                className="link-draw mt-5 inline-flex items-center gap-1.5 text-base font-semibold"
              >
                Sign in to the demo <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
            <p className="text-sm">© 2026 DockIQ. Every company, trailer, person and pallet is fictional.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
