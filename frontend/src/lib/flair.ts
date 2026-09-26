/**
 * The button flair's origin: records where a pointer entered, pressed or left a `.btn`, as
 * `--fx`/`--fy` on that button, so its fill grows from (and shrinks toward) that point. One passive
 * listener for the whole document; purely presentational.
 */
function place(event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLElement>('.btn');
  if (!button) return;
  const box = button.getBoundingClientRect();
  button.style.setProperty('--fx', `${String(event.clientX - box.left)}px`);
  button.style.setProperty('--fy', `${String(event.clientY - box.top)}px`);
}

export function installFlair(): () => void {
  const options = { passive: true, capture: true } as const;
  document.addEventListener('pointerover', place, options);
  document.addEventListener('pointerdown', place, options);
  document.addEventListener('pointerout', place, options);
  return () => {
    document.removeEventListener('pointerover', place, options);
    document.removeEventListener('pointerdown', place, options);
    document.removeEventListener('pointerout', place, options);
  };
}
