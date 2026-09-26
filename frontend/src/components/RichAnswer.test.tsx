import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { parseAnswer } from '../lib/answer';
import { RichAnswer } from './RichAnswer';

describe('RichAnswer: the assistant formatted, never as HTML', () => {
  it('turns bullet and numbered lines into lists, keeping the first number', () => {
    expect(parseAnswer('Do this:\n- re-probe\n- log it\n\n3. third\n4. fourth')).toEqual([
      { kind: 'paragraph', lines: ['Do this:'] },
      { kind: 'bullets', items: ['re-probe', 'log it'] },
      { kind: 'steps', start: 3, items: ['third', 'fourth'] },
    ]);
  });

  it('reads a line that is only bold, or a markdown heading, as a heading; a line in italics as a note', () => {
    expect(parseAnswer('**Escalated to you:**\n## Next\n*Confidence is medium.*')).toEqual([
      { kind: 'heading', text: 'Escalated to you' },
      { kind: 'heading', text: 'Next' },
      { kind: 'note', text: 'Confidence is medium.' },
    ]);
  });

  it('sets bold, italic and the codes a person reads off', () => {
    render(<RichAnswer text="**Stop.** Order ORD-2026-4521 reads 3.0°F on #75, *re-probe*." />);
    expect(screen.getByText('Stop.').tagName).toBe('STRONG');
    expect(screen.getByText('re-probe').tagName).toBe('EM');
    for (const code of ['ORD-2026-4521', '3.0°F', '#75']) {
      expect(screen.getByText(code)).toHaveClass('answer-token');
    }
  });

  it('shows markup in model output as text', () => {
    const { container } = render(<RichAnswer text={'<img src=x onerror="alert(1)"> hello'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });
});
