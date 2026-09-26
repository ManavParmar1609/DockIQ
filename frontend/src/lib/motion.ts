/**
 * Whether to skip motion. True when the person asked for reduced motion, and wherever the question
 * cannot be asked (no `matchMedia`, as in tests): no motion is the safe default.
 */
export function prefersStill(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Scroll an element into view, smoothly unless motion is reduced; a no-op where scrolling is absent. */
export function bringIntoView(element: Element | null | undefined, block: ScrollLogicalPosition = 'nearest') {
  if (!element || typeof element.scrollIntoView !== 'function') return;
  element.scrollIntoView({ block, behavior: prefersStill() ? 'auto' : 'smooth' });
}
