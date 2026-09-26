import { describe, expect, it } from 'vitest';

import { checkDigit, encodeEan13, toEan13 } from './ean13';
import { duration, elapsed, formatDate, formatTemp, greeting, initials, percent, timeAgo } from './format';
import { rovingIndex, rovingTabIndex } from './roving';
import { ISSUE_STATUS, bySeverityThenAge, parseSeverityReason } from './vocab';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

describe('timeAgo', () => {
  it('rolls up past minutes — the old UI printed "27914m ago"', () => {
    expect(timeAgo(ago(30_000), NOW)).toBe('just now');
    expect(timeAgo(ago(12 * MIN), NOW)).toBe('12m ago');
    expect(timeAgo(ago(3 * 60 * MIN), NOW)).toBe('3h ago');
    expect(timeAgo(ago(27914 * MIN), NOW)).toBe('19d ago');
  });
});

describe('elapsed', () => {
  it('formats a waiting clock', () => {
    expect(elapsed(ago(7 * MIN), NOW)).toBe('7m');
    expect(elapsed(ago(65 * MIN), NOW)).toBe('1h 05m');
    expect(elapsed(ago(51 * 60 * MIN), NOW)).toBe('2d 3h');
  });

  it('formats a count of minutes the same way', () => {
    expect(duration(16203)).toBe('11d 6h');
    expect(duration(-4)).toBe('0m');
  });
});

describe('format helpers', () => {
  it('never shows NaN% for an empty order', () => {
    expect(percent(0, 0)).toBe(0);
    expect(percent(5, 10)).toBe(50);
    expect(percent(12, 10)).toBe(100);
  });
  it('formats temperatures with a true minus sign', () => {
    expect(formatTemp(-5)).toBe('−5°F');
    expect(formatTemp(40)).toBe('40°F');
  });
  it('greets by hour and abbreviates names', () => {
    expect(greeting(9)).toBe('Good morning');
    expect(greeting(14)).toBe('Good afternoon');
    expect(greeting(20)).toBe('Good evening');
    expect(initials('Sarah Mitchell')).toBe('SM');
  });
});

describe('formatDate', () => {
  it('prints a calendar date without shifting it across a timezone', () => {
    expect(formatDate('2026-10-01')).toBe('1 Oct 2026');
    expect(formatDate('2027-01-31')).toBe('31 Jan 2027');
  });
});

describe('vocabulary', () => {
  it('has one label per issue status and knows which are open', () => {
    expect(Object.keys(ISSUE_STATUS)).toHaveLength(5);
    expect(ISSUE_STATUS.escalated.open).toBe(true);
    expect(ISSUE_STATUS.on_hold.open).toBe(true);
    expect(ISSUE_STATUS.self_resolved.open).toBe(false);
  });
  it('orders the queue critical first, then oldest', () => {
    const issues = [
      { severity: 'low' as const, created_at: '2026-09-25T10:00:00Z' },
      { severity: 'critical' as const, created_at: '2026-09-25T11:00:00Z' },
      { severity: 'critical' as const, created_at: '2026-09-25T09:00:00Z' },
    ];
    expect(
      [...issues].sort(bySeverityThenAge).map((i) => `${i.severity}@${i.created_at.slice(11, 13)}`),
    ).toEqual(['critical@09', 'critical@11', 'low@10']);
  });
  it('splits the engine reason into its factors', () => {
    const parsed = parseSeverityReason(
      "Score: 20.0 → CRITICAL. Factors: Issue type 'Damaged Pallet' (weight: 4); Allergen-sensitive product (+2)",
    );
    expect(parsed.summary).toBe('Score: 20.0 → CRITICAL');
    expect(parsed.factors).toEqual([
      "Issue type 'Damaged Pallet' (weight: 4)",
      'Allergen-sensitive product (+2)',
    ]);
  });
});

describe('EAN-13', () => {
  it('computes the check digit from GS1’s worked example', () => {
    expect(checkDigit('629104150021')).toBe(3);
  });
  it('accepts a demo GTIN-14 and rejects a bad check digit', () => {
    expect(toEan13('02860000000015')).toBe('2860000000015');
    expect(toEan13('2860000000016')).toBeNull();
  });
  it('encodes 95 modules with guard bars', () => {
    const bits = encodeEan13('2860000000015');
    expect(bits).toHaveLength(95);
    expect(bits.startsWith('101')).toBe(true);
    expect(bits.slice(45, 50)).toBe('01010');
    expect(bits.endsWith('101')).toBe(true);
  });
});

describe('rovingIndex', () => {
  it('moves with the arrows and wraps at both ends', () => {
    expect(rovingIndex('ArrowRight', 0, 3)).toBe(1);
    expect(rovingIndex('ArrowRight', 2, 3)).toBe(0);
    expect(rovingIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(rovingIndex('Home', 2, 3)).toBe(0);
    expect(rovingIndex('End', 0, 3)).toBe(2);
  });

  it('moves from the first item when nothing is selected yet', () => {
    expect(rovingIndex('ArrowDown', -1, 3)).toBe(1);
    expect(rovingIndex('ArrowUp', -1, 3)).toBe(2);
    expect(rovingTabIndex(0, -1)).toBe(0);
    expect(rovingTabIndex(1, -1)).toBe(-1);
  });

  it('leaves Up and Down alone in a horizontal tablist, and ignores other keys', () => {
    expect(rovingIndex('ArrowDown', 0, 3, false)).toBeNull();
    expect(rovingIndex('Enter', 0, 3)).toBeNull();
    expect(rovingIndex('ArrowRight', 0, 0)).toBeNull();
  });
});
