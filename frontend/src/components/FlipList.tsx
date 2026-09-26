import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { Flip } from 'gsap/Flip';
import { Component, createRef, type ReactNode } from 'react';

import { prefersStill } from '../lib/motion';

gsap.registerPlugin(Flip, CustomEase);
// The --ease-out token in app.css, so GSAP and CSS motion share one curve.
const EASE_OUT = CustomEase.create('dockiq-out', '0.23,1,0.32,1');

interface Snapshot {
  state: Flip.FlipState;
  keys: Set<string>;
}

interface Props {
  /** The rows' keys in order, joined: a change is what triggers the motion. */
  order: string;
  className?: string;
  children: ReactNode;
}

function rowsOf(list: HTMLOListElement | null): HTMLElement[] {
  return Array.from(list?.children ?? []).filter((row): row is HTMLElement => row instanceof HTMLElement);
}

/**
 * An `<ol>` whose rows glide to their new places when the order changes (GSAP Flip, transform only)
 * and whose new rows drop in from above. Each row carries `data-key`; a row marked `data-still` (a
 * critical one) takes its new place instantly and arrives without a fade, so nothing on a critical row
 * ever moves. Reduced motion: every change is instant.
 *
 * A class, because `getSnapshotBeforeUpdate` is the one moment React offers the old layout.
 */
export class FlipList extends Component<Props> {
  private list = createRef<HTMLOListElement>();
  private running: gsap.core.Animation[] = [];

  private finish() {
    for (const animation of this.running) animation.progress(1).kill();
    this.running = [];
  }

  override getSnapshotBeforeUpdate(previous: Props): Snapshot | null {
    if (previous.order === this.props.order || prefersStill()) return null;
    this.finish();
    const rows = rowsOf(this.list.current);
    const moving = rows.filter((row) => row.dataset.still === undefined);
    return {
      state: Flip.getState(moving),
      keys: new Set(rows.map((row) => row.dataset.key ?? '')),
    };
  }

  override componentDidUpdate(_previous: Props, _state: unknown, snapshot: Snapshot | null) {
    if (!snapshot) return;
    const rows = rowsOf(this.list.current).filter((row) => row.dataset.still === undefined);
    const known = (row: HTMLElement) => snapshot.keys.has(row.dataset.key ?? '');
    const moving = rows.filter(known);
    const entering = rows.filter((row) => !known(row));
    if (moving.length > 0) {
      this.running.push(
        Flip.from(snapshot.state, {
          targets: moving,
          duration: 0.24,
          ease: EASE_OUT,
          simple: true,
          scale: true,
        }),
      );
    }
    if (entering.length > 0) {
      this.running.push(
        gsap.fromTo(
          entering,
          { y: -8, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.22, ease: EASE_OUT, clearProps: 'transform,opacity' },
        ),
      );
    }
  }

  override componentWillUnmount() {
    for (const animation of this.running) animation.kill();
    this.running = [];
  }

  override render() {
    return (
      <ol ref={this.list} className={this.props.className}>
        {this.props.children}
      </ol>
    );
  }
}
