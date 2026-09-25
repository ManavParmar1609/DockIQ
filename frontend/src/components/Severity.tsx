/**
 * Severity is never conveyed by colour alone: every level has a label, a shape and a colour. Only
 * CRITICAL is a solid red capsule; high and medium are tinted, low is gray. Confidence is a separate
 * channel (ConfidenceMeter, signal bars in ink) and never borrows this palette.
 */
import type { Severity } from '../api/types';

const LEVEL: Record<Severity, { label: string; badge: string }> = {
  critical: { label: 'Critical', badge: 'bg-hazard text-white' },
  high: { label: 'High', badge: 'bg-orange-soft text-orange' },
  medium: { label: 'Medium', badge: 'bg-amber-soft text-amber' },
  low: { label: 'Low', badge: 'bg-paper-sunk text-ink-mute' },
};

const TINT: Record<Severity, string> = {
  critical: 'text-hazard-bright',
  high: 'text-orange-bright',
  medium: 'text-amber-bright',
  low: 'text-ink-mute',
};

/**
 * The shape channel: ▲ critical, ◆ high, ■ medium, ○ low. Inside a badge it takes the badge's colour;
 * standing alone in a list, `tinted` gives it the severity hue as well — always beside a label.
 */
export function SeverityMark({
  severity,
  size = 14,
  tinted = false,
}: {
  severity: Severity;
  size?: number;
  tinted?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      aria-hidden="true"
      className={`shrink-0 ${tinted ? TINT[severity] : ''}`}
    >
      {severity === 'critical' && (
        <path d="M7 1.2 13.3 12.6H0.7Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
      )}
      {severity === 'high' && <path d="M7 0.6 13.4 7 7 13.4 0.6 7Z" fill="currentColor" />}
      {severity === 'medium' && <rect x="1.5" y="1.5" width="11" height="11" rx="2.5" fill="currentColor" />}
      {severity === 'low' && (
        <circle cx="7" cy="7" r="5.25" fill="none" stroke="currentColor" strokeWidth="2" />
      )}
    </svg>
  );
}

export function SeverityBadge({ severity, size = 'md' }: { severity: Severity; size?: 'sm' | 'md' | 'lg' }) {
  const level = LEVEL[severity];
  const scale = {
    sm: 'gap-1.5 px-2.5 min-h-7 text-xs',
    md: 'gap-1.5 px-3 min-h-8 text-sm',
    lg: 'gap-2 px-4 min-h-11 text-lg',
  }[size];
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold tracking-tight whitespace-nowrap ${scale} ${level.badge}`}
    >
      <SeverityMark severity={severity} size={size === 'lg' ? 16 : 12} />
      {level.label}
    </span>
  );
}

export function severityLabel(severity: Severity): string {
  return LEVEL[severity].label;
}

const CONFIDENCE_FILLED = { low: 1, medium: 2, high: 3 } as const;
const BAR_HEIGHT = ['h-2', 'h-3', 'h-4'] as const;

/** Its own visual channel: signal bars in ink, labelled. Never red, never severity colours. */
export function ConfidenceMeter({ confidence }: { confidence: 'low' | 'medium' | 'high' }) {
  const filled = CONFIDENCE_FILLED[confidence];
  return (
    <span className="inline-flex items-center gap-2" aria-label={`Match confidence ${confidence}`}>
      <span className="flex items-end gap-0.5" aria-hidden="true">
        {BAR_HEIGHT.map((height, index) => (
          <span
            key={height}
            className={`w-1.5 rounded-sm ${height} ${index < filled ? 'bg-ink' : 'bg-paper-deep'}`}
          />
        ))}
      </span>
      <span className="text-sm font-medium text-ink-soft">Match: {confidence}</span>
    </span>
  );
}
