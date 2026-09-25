/** Arrow-key movement inside a tablist or radiogroup: the WAI-ARIA roving tabindex pattern. */
import type { KeyboardEvent } from 'react';

const STEP: Partial<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * The index a key moves to in a group of `count`, wrapping at the ends, or null for any other key.
 * `current` is -1 when nothing is selected yet. Tabs move on Left/Right only; radios on all arrows.
 */
export function rovingIndex(key: string, current: number, count: number, vertical = true): number | null {
  if (count === 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (!vertical && (key === 'ArrowUp' || key === 'ArrowDown')) return null;
  const step = STEP[key];
  if (step === undefined) return null;
  // With nothing selected, focus sits on the first item (see rovingTabIndex); move from there.
  return (Math.max(current, 0) + step + count) % count;
}

/** The one item in the group reachable with Tab: the selected one, else the first. */
export function rovingTabIndex(index: number, current: number): 0 | -1 {
  return index === Math.max(current, 0) ? 0 : -1;
}

/** Keydown for the group's container: select the neighbour and move focus to it. */
export function rovingKeyDown(
  role: 'tab' | 'radio',
  current: number,
  count: number,
  select: (index: number) => void,
) {
  return (event: KeyboardEvent<HTMLElement>) => {
    const next = rovingIndex(event.key, current, count, role === 'radio');
    if (next === null) return;
    event.preventDefault();
    select(next);
    event.currentTarget.querySelectorAll<HTMLElement>(`[role="${role}"]`)[next]?.focus();
  };
}
