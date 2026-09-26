/**
 * The product's "explainable, not magic" claim made visible (rules §2.4.4): the score derivation,
 * the match confidence, and the cited SOP source — never just a verdict.
 */
import { BookOpen, Check, Repeat2 } from 'lucide-react';
import { useState } from 'react';

import type { AiResolution, RecurringPattern, Severity } from '../api/types';
import { formatMoney } from '../lib/format';
import { parseSeverityReason } from '../lib/vocab';
import { ConfidenceMeter, SeverityBadge } from './Severity';
import { Panel } from './ui';

export function SeverityDerivation({
  severity,
  score,
  reason,
  cost,
  index,
}: {
  severity: Severity;
  score: number | null | undefined;
  reason: string | null | undefined;
  cost?: number;
  index?: number;
}) {
  const { factors } = parseSeverityReason(reason);
  return (
    <Panel title="Severity — how it was scored" index={index}>
      <div className="flex flex-wrap items-center gap-4">
        <SeverityBadge severity={severity} size="lg" />
        {score !== null && score !== undefined && (
          <p className="telemetry text-3xl">
            {score.toFixed(1)} <span className="label">points</span>
          </p>
        )}
        {cost !== undefined && cost > 0 && (
          <p className="ml-auto text-right">
            <span className="label block">Est. cost impact</span>
            <span className="telemetry text-2xl">{formatMoney(cost)}</span>
          </p>
        )}
      </div>
      {factors.length > 0 && (
        <ol className="mt-4 divide-y divide-hairline border-t border-hairline">
          {factors.map((factor) => (
            <li key={factor} className="flex gap-3 py-2 text-base">
              <span>{factor}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-sm text-ink-mute">
        A fixed weighted formula — not a model. Bands: under 6 low · 6 medium · 12 high · 18 critical.
      </p>
    </Panel>
  );
}

export function RecurringPatterns({
  patterns,
}: {
  patterns: RecurringPattern[] | Record<string, unknown>[];
}) {
  if (patterns.length === 0) return null;
  return (
    <div className="rounded-lg bg-paper-sunk p-4">
      <p className="heading flex items-center gap-2 text-lg">
        <Repeat2 size={20} aria-hidden="true" /> Recurring pattern
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {patterns.map((pattern, index) => (
          <li key={index} className="text-base">
            {(pattern as RecurringPattern).message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The steps as a working checklist: the step to do now is bright, finished ones dim with a tick, the
 * rest wait. Ticks are a working aid on this screen only; nothing is recorded.
 */
function ProcedureSteps({ steps }: { steps: string[] }) {
  const [done, setDone] = useState<Set<number>>(() => new Set());
  const now = steps.findIndex((_, i) => !done.has(i));
  const toggle = (i: number) =>
    setDone((current) => {
      const next = new Set(current);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  return (
    <ol className="flex flex-col gap-1" aria-label="Procedure steps">
      {steps.map((step, i) => {
        const finished = done.has(i);
        const state = finished ? 'done' : i === now ? 'now' : 'next';
        return (
          <li key={step}>
            <button
              type="button"
              className={`proc-step proc-${state}`}
              aria-pressed={finished}
              onClick={() => toggle(i)}
            >
              <span className="proc-num telemetry" aria-hidden="true">
                {finished ? <Check size={16} strokeWidth={3} /> : i + 1}
              </span>
              <span className="pt-0.5 text-left">{step}</span>
              <span className="sr-only">{finished ? ', done' : i === now ? ', do this now' : ''}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function ProcedureCard({
  resolution,
  fallbackTitle,
  index,
  note,
}: {
  resolution: AiResolution;
  fallbackTitle: string;
  index?: number;
  note?: string;
}) {
  return (
    <Panel
      title={`Procedure — ${resolution.scenario ?? fallbackTitle}`}
      aside={<ConfidenceMeter confidence={resolution.confidence} />}
      index={index}
    >
      {!resolution.found && resolution.message && <p className="mb-3 font-semibold">{resolution.message}</p>}
      <ProcedureSteps steps={resolution.steps} />
      {resolution.source && (
        <p className="mt-4 flex items-center gap-2 border-t border-hairline pt-3 text-base">
          <BookOpen size={18} aria-hidden="true" />
          <span className="label">Source</span>
          <span className="font-semibold">{resolution.source}</span>
        </p>
      )}
      {note && <p className="mt-3 text-sm text-ink-mute">{note}</p>}
    </Panel>
  );
}
