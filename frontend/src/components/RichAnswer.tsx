import { Fragment, type ReactNode } from 'react';

import { parseAnswer } from '../lib/answer';

/*
 * The assistant's answers, formatted: headings, bullet and numbered lists, bold, italic, `code`, and
 * the codes a person reads off (#75, ORD-2026-4521, F-13-B01-1, 3°F) set in the mono. Model output is
 * text to display, never HTML (security rules §4): every piece becomes a React text node.
 */

// Order IDs, SKUs, bin locations (letters or digits joined by hyphens, with a digit), issue numbers,
// temperatures.
const TOKEN = /(#\d+\b|\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b|-?\d+(?:\.\d+)?\s?°[FC])/g;

function Tokens({ text }: { text: string }) {
  return (
    <>
      {text.split(TOKEN).map((part, index) =>
        index % 2 === 1 && /\d/.test(part) ? (
          <span key={index} className="answer-token">
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;

export function Inline({ text }: { text: string }): ReactNode {
  return (
    <>
      {text.split(INLINE).map((part, index) => {
        if (index % 2 === 0) return <Tokens key={index} text={part} />;
        if (part.startsWith('**')) {
          return (
            <strong key={index}>
              <Tokens text={part.slice(2, -2)} />
            </strong>
          );
        }
        if (part.startsWith('`')) {
          return (
            <code key={index} className="answer-token">
              {part.slice(1, -1)}
            </code>
          );
        }
        return (
          <em key={index}>
            <Tokens text={part.slice(1, -1)} />
          </em>
        );
      })}
    </>
  );
}

export function RichAnswer({ text }: { text: string }) {
  return (
    <div className="answer-prose">
      {parseAnswer(text).map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return (
              <h3 key={index} className="answer-heading">
                <Inline text={block.text} />
              </h3>
            );
          case 'note':
            return (
              <p key={index} className="answer-note">
                <Inline text={block.text} />
              </p>
            );
          case 'bullets':
            return (
              <ul key={index}>
                {block.items.map((item, i) => (
                  <li key={i}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            );
          case 'steps':
            return (
              <ol key={index} start={block.start}>
                {block.items.map((item, i) => (
                  <li key={i}>
                    <Inline text={item} />
                  </li>
                ))}
              </ol>
            );
          case 'paragraph':
            return (
              <p key={index}>
                {block.lines.map((line, i) => (
                  <Fragment key={i}>
                    {i > 0 && <br />}
                    <Inline text={line} />
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
