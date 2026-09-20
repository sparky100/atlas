import { describe, expect, it } from 'vitest';
import { formatSourceRef, parseSourceRef } from './sourceRef';

describe('formatSourceRef', () => {
  it('formats each grammar exactly per SPEC-capture.md §4.1', () => {
    expect(formatSourceRef({ kind: 'sheet', sheet: 'Applications', range: 'C14' })).toBe('sheet:Applications!C14');
    expect(formatSourceRef({ kind: 'sheet', sheet: 'Applications', range: 'A14:H14' })).toBe('sheet:Applications!A14:H14');
    expect(formatSourceRef({ kind: 'pdf', page: 7, start: 1203, end: 1288 })).toBe('pdf:p7!1203-1288');
    expect(formatSourceRef({ kind: 'text', start: 120, end: 340 })).toBe('text:120-340');
  });
});

describe('parseSourceRef', () => {
  it('parses each grammar back to its structured form', () => {
    expect(parseSourceRef('sheet:Applications!C14')).toEqual({ kind: 'sheet', sheet: 'Applications', range: 'C14' });
    expect(parseSourceRef('sheet:Applications!A14:H14')).toEqual({ kind: 'sheet', sheet: 'Applications', range: 'A14:H14' });
    expect(parseSourceRef('pdf:p7!1203-1288')).toEqual({ kind: 'pdf', page: 7, start: 1203, end: 1288 });
    expect(parseSourceRef('text:120-340')).toEqual({ kind: 'text', start: 120, end: 340 });
  });

  it('never throws on a hand-typed ref outside all three grammars, returning null instead', () => {
    for (const garbage of ['', 'not a ref', 'sheet:', 'sheet:NoRange', 'pdf:page7', 'text:onlyone', 'manual: recorded by hand']) {
      expect(parseSourceRef(garbage)).toBeNull();
    }
  });

  it('splits a sheet ref on its first "!"', () => {
    expect(parseSourceRef('sheet:Applications!A1:H1')).toEqual({ kind: 'sheet', sheet: 'Applications', range: 'A1:H1' });
  });
});
