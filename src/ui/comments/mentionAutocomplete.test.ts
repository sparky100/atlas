import { describe, expect, it } from 'vitest';
import { activeMentionQuery, insertMention } from './mentionAutocomplete';

describe('activeMentionQuery', () => {
  it('returns the partial handle right before the cursor', () => {
    expect(activeMentionQuery('hey @al', 7)).toBe('al');
  });

  it('returns an empty string for a bare "@" with nothing typed yet', () => {
    expect(activeMentionQuery('hey @', 5)).toBe('');
  });

  it('returns null when the cursor is not inside a mention token at all', () => {
    expect(activeMentionQuery('hey alex', 8)).toBeNull();
  });

  it('returns null for an email address — @ must follow whitespace or start-of-string, not a word character', () => {
    expect(activeMentionQuery('reach me at alex@example', 25)).toBeNull();
  });

  it('works at the very start of the body', () => {
    expect(activeMentionQuery('@al', 3)).toBe('al');
  });

  it('finds the trailing mention when there is an earlier, already-finished one', () => {
    expect(activeMentionQuery('hi @alex, @bo', 13)).toBe('bo');
  });

  it('reflects the cursor position, not just the end of the string', () => {
    // Cursor sits right after "al" in "@already typed text" — mid-body.
    expect(activeMentionQuery('@al ready typed text', 3)).toBe('al');
  });
});

describe('insertMention', () => {
  it('replaces a partial handle with the chosen one, plus a trailing space, and moves the cursor past it', () => {
    expect(insertMention('hey @al', 7, 'alex')).toEqual({ body: 'hey @alex ', cursorIndex: 10 });
  });

  it('fills in a bare "@" the same way', () => {
    expect(insertMention('hey @', 5, 'alex')).toEqual({ body: 'hey @alex ', cursorIndex: 10 });
  });

  it('works at the very start of the body', () => {
    expect(insertMention('@al', 3, 'alex')).toEqual({ body: '@alex ', cursorIndex: 6 });
  });

  it('leaves text after the cursor untouched', () => {
    expect(insertMention('@al can you look?', 3, 'alex')).toEqual({ body: '@alex  can you look?', cursorIndex: 6 });
  });

  it('is a no-op when the cursor is not inside a mention token', () => {
    expect(insertMention('hey alex', 8, 'alex')).toEqual({ body: 'hey alex', cursorIndex: 8 });
  });
});
