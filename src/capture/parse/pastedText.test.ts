import { describe, expect, it } from 'vitest';
import { parsePastedText } from './pastedText';

describe('parsePastedText', () => {
  it('passes ordinary text through unchanged', () => {
    const result = parsePastedText('Some pasted notes.\n\nSecond paragraph.');
    expect(result.text).toBe('Some pasted notes.\n\nSecond paragraph.');
    expect(result.charCount).toBe(result.text.length);
  });

  it('strips a leading BOM', () => {
    const result = parsePastedText('﻿Hello there.');
    expect(result.text).toBe('Hello there.');
  });

  it('normalises CRLF and bare CR line endings to LF', () => {
    const result = parsePastedText('Line one.\r\nLine two.\rLine three.');
    expect(result.text).toBe('Line one.\nLine two.\nLine three.');
  });
});
