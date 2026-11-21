import { useState, type ReactNode } from 'react';

/**
 * A long description shown as a couple of lines by default, with an explicit
 * Show more / Show less control (not just CSS truncation), so a reader can
 * always reach the full text and keyboard/screen-reader users get
 * `aria-expanded`. Short text renders unchanged, with no control.
 */
export function ClampedText({ text, lines = 2, children }: { text: string; lines?: number; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 160;
  return (
    <div>
      <div
        style={
          long && !expanded
            ? { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
            : undefined
        }
      >
        {children ?? text}
      </div>
      {long && (
        <button type="button" aria-expanded={expanded} onClick={() => { setExpanded((v) => !v); }}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
