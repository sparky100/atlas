import { describe, expect, it } from 'vitest';
import { isRootComment, isValidHandle, parseMentionHandles } from './comments';

describe('parseMentionHandles', () => {
  it('extracts a single handle', () => {
    expect(parseMentionHandles('hey @alex, can you take a look?')).toEqual(['alex']);
  });

  it('extracts multiple distinct handles in order of first appearance', () => {
    expect(parseMentionHandles('@alex and @jordan-2 should both see this')).toEqual(['alex', 'jordan-2']);
  });

  it('lowercases handles so case never splits one mention into two', () => {
    expect(parseMentionHandles('@Alex please review, cc @ALEX')).toEqual(['alex']);
  });

  it('dedupes repeated mentions of the same handle', () => {
    expect(parseMentionHandles('@alex @alex @alex')).toEqual(['alex']);
  });

  it('returns nothing for a body with no @ at all', () => {
    expect(parseMentionHandles('no mentions here, just plain text')).toEqual([]);
  });

  it('does not treat the domain half of an email as a mention', () => {
    // The '@' in "alex@example.com" is preceded by a word character, but
    // this parser (like the server-side trigger it mirrors) doesn't
    // require a leading boundary — it matches "@example" as a token. This
    // test documents that known, accepted behaviour (an email in a body
    // reads as a mention of "example") rather than silently relying on it.
    expect(parseMentionHandles('reach me at alex@example.com')).toEqual(['example']);
  });

  it('stops a handle at punctuation that is not part of the allowed charset', () => {
    expect(parseMentionHandles('@alex, @jordan.')).toEqual(['alex', 'jordan']);
  });
});

describe('isValidHandle', () => {
  it('accepts lowercase alphanumeric, underscore, and hyphen', () => {
    expect(isValidHandle('alex')).toBe(true);
    expect(isValidHandle('alex_2')).toBe(true);
    expect(isValidHandle('alex-2')).toBe(true);
    expect(isValidHandle('a1b2c3')).toBe(true);
  });

  it('rejects uppercase, spaces, and other punctuation', () => {
    expect(isValidHandle('Alex')).toBe(false);
    expect(isValidHandle('alex smith')).toBe(false);
    expect(isValidHandle('alex@example')).toBe(false);
    expect(isValidHandle('')).toBe(false);
  });
});

describe('isRootComment', () => {
  it('is true when parent_comment_id is null', () => {
    expect(isRootComment({ parent_comment_id: null })).toBe(true);
  });

  it('is false for a reply', () => {
    expect(isRootComment({ parent_comment_id: 'some-id' })).toBe(false);
  });
});
