/**
 * Scan tones, synthesised with Web Audio (no files to load): a rising two-note chirp for a match, a
 * low double buzz for a mismatch, one flat mid tone for a code nobody knows. A vibration pattern goes
 * with each where the device supports it. Muting is a per-device convenience, kept in localStorage.
 */
export type ScanTone = 'match' | 'mismatch' | 'unknown';

const MUTE_KEY = 'dockiq.sound.muted';

type Note = { freq: number; start: number; length: number; type: OscillatorType };

const TONES: Record<ScanTone, { notes: Note[]; vibrate: number[] }> = {
  match: {
    notes: [
      { freq: 880, start: 0, length: 0.07, type: 'sine' },
      { freq: 1320, start: 0.08, length: 0.09, type: 'sine' },
    ],
    vibrate: [30],
  },
  mismatch: {
    notes: [
      { freq: 180, start: 0, length: 0.16, type: 'square' },
      { freq: 150, start: 0.2, length: 0.2, type: 'square' },
    ],
    vibrate: [120, 60, 180],
  },
  unknown: {
    notes: [{ freq: 520, start: 0, length: 0.14, type: 'triangle' }],
    vibrate: [60],
  },
};

let context: AudioContext | null = null;

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* muting lasts for this page load only */
  }
}

export function playScanTone(tone: ScanTone): void {
  const { notes, vibrate } = TONES[tone];
  if ('vibrate' in navigator) navigator.vibrate(vibrate);
  if (isMuted()) return;
  const Ctor = window.AudioContext as typeof AudioContext | undefined;
  if (!Ctor) return;
  try {
    context ??= new Ctor();
    const now = context.currentTime;
    for (const note of notes) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = note.type;
      osc.frequency.value = note.freq;
      // A short attack and release, so the tone clicks neither in nor out.
      gain.gain.setValueAtTime(0, now + note.start);
      gain.gain.linearRampToValueAtTime(0.18, now + note.start + 0.01);
      gain.gain.linearRampToValueAtTime(0, now + note.start + note.length);
      osc.connect(gain).connect(context.destination);
      osc.start(now + note.start);
      osc.stop(now + note.start + note.length + 0.02);
    }
  } catch {
    /* audio blocked or unavailable: the on-screen result still says what happened */
  }
}
