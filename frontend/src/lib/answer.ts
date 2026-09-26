/** The assistant's answer text, split into blocks. Pure: no markup survives as markup. */

export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'note'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'steps'; start: number; items: string[] };

const HEADING = /^#{1,4}\s+(.+)$/;
const BOLD_LINE = /^\*\*([^*]+)\*\*:?$/;
const ITALIC_LINE = /^[*_]([^*_]+)[*_]$/;
const BULLET = /^\s*[-*•]\s+(.+)$/;
const STEP = /^\s*(\d+)[.)]\s+(.+)$/;

export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  const last = () => blocks.at(-1);
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      blocks.push({ kind: 'paragraph', lines: [] });
      continue;
    }
    const heading = HEADING.exec(line) ?? BOLD_LINE.exec(line);
    const bullet = BULLET.exec(line);
    const step = STEP.exec(line);
    const italic = ITALIC_LINE.exec(line);
    const previous = last();
    if (heading?.[1]) {
      blocks.push({ kind: 'heading', text: heading[1].replace(/:$/, '') });
    } else if (step?.[1] && step[2]) {
      if (previous?.kind === 'steps') previous.items.push(step[2]);
      else blocks.push({ kind: 'steps', start: Number(step[1]), items: [step[2]] });
    } else if (bullet?.[1]) {
      if (previous?.kind === 'bullets') previous.items.push(bullet[1]);
      else blocks.push({ kind: 'bullets', items: [bullet[1]] });
    } else if (italic?.[1]) {
      blocks.push({ kind: 'note', text: italic[1] });
    } else if (previous?.kind === 'paragraph') {
      previous.lines.push(line);
    } else {
      blocks.push({ kind: 'paragraph', lines: [line] });
    }
  }
  return blocks.filter((block) => block.kind !== 'paragraph' || block.lines.length > 0);
}
