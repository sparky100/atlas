import { describe, expect, it } from 'vitest';
import { splitMentionSpans } from './commentBodyRender';

describe('splitMentionSpans', () => {
  it('returns one plain-text span for a body with no mentions', () => {
    expect(splitMentionSpans('no mentions here')).toEqual([{ kind: 'text', text: 'no mentions here' }]);
  });

  it('splits text around a single mention', () => {
    expect(splitMentionSpans('hey @alex, can you look?')).toEqual([
      { kind: 'text', text: 'hey ' },
      { kind: 'mention', handle: 'alex' },
      { kind: 'text', text: ', can you look?' },
    ]);
  });

  it('handles a body that is only a mention', () => {
    expect(splitMentionSpans('@alex')).toEqual([{ kind: 'mention', handle: 'alex' }]);
  });

  it('handles two mentions back to back', () => {
    expect(splitMentionSpans('@alex @jordan-2 please review')).toEqual([
      { kind: 'mention', handle: 'alex' },
      { kind: 'text', text: ' ' },
      { kind: 'mention', handle: 'jordan-2' },
      { kind: 'text', text: ' please review' },
    ]);
  });

  it('returns an empty array for an empty body', () => {
    expect(splitMentionSpans('')).toEqual([]);
  });
});
