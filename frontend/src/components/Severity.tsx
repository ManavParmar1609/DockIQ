/**
 * Severity is never conveyed by colour alone: every level has a label, a shape and a fill weight.
 * Only CRITICAL uses the hazard red. Confidence is a separate channel (ConfidenceMeter) and never
 * borrows this palette.
 */
import type { Severity } from '../api/types';

const LEVEL: Record<Severity, { label: string; badge: string; mark: string }> = {
  critical: { label: 'Critical', badge: 'bg-hazard text-light border-hazard', mark: 'text-light' },
  high: { label: 'High', badge: 'bg-ink text-light border-ink', mark: 'text-light' },
  medium: { label: 'Medium', badge: 'bg-light text-ink border-ink', mark: 'text-ink' },
  low: {
    label: 'Low',
    badge: 'bg-transparent text-ink-soft border-hairline border-dashed',
    mark: 'text-ink-soft',
  },
};

/** The shape channel: ▲ critical, ◆ high, ■ medium, ○ low. */
export function SeverityMark({ severity, size = 14 }: { severity: Severity; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
      {severity === 'critical' && <path d="M7 0.8 13.6 13H0.4Z" fill="currentColor" />}
      {severity === 'high' && <path d="M7 0 14 7 7 14 0 7Z" fill="currentColor" />}
      {severity === 'medium' && <rect x="1.5" y="1.5" width="11" height="11" fill="currentColor" />}
      {severity === 'low' && (
        <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
      )}
    </svg>
  );
}

export function SeverityBadge({ severity, size = 'md' }: { severity: Severity; size?: 'sm' | 'md' | 'lg' }) {
  const level = LEVEL[severity];
  const scale = {
    sm: 'gap-1.5 px-2 min-h-7 text-sm',
    md: 'gap-2 px-2.5 min-h-9 text-base',
    lg: 'gap-2.5 px-3.5 min-h-12 text-xl',
  }[size];
  return (
    <span className={`heading inline-flex items-center border-2 ${scale} ${level.badge}`}>
      <span className={level.mark}>
        <SeverityMark severity={severity} size={size === 'lg' ? 18 : 13} />
      </span>
      {level.label}
    </span>
  );
}

export function severityLabel(severity: Severity): string {
  return LEVEL[severity].label;
}

const CONFIDENCE_FILLED = { low: 1, medium: 2, high: 3 } as const;

/** Its own visual channel: a three-cell meter in ink, labelled. Never red, never severity colours. */
export function ConfidenceMeter({ confidence }: { confidence: 'low' | 'medium' | 'high' }) {
  const filled = CONFIDENCE_FILLED[confidence];
  return (
    <span className="inline-flex items-center gap-2" aria-label={`Match confidence ${confidence}`}>
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3].map((cell) => (
          <span
            key={cell}
            className={`h-4 w-2.5 border-2 border-ink ${cell <= filled ? 'bg-ink' : 'bg-transparent'}`}
          />
        ))}
      </span>
      <span className="label text-ink">Match · {confidence}</span>
    </span>
  );
}
