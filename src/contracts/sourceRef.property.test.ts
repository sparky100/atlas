/**
 * RT-K3 (SPEC-capture.md §4.1, §13): `formatSourceRef(parseSourceRef(s)) === s`
 * for every grammar; `parseSourceRef` never throws on a hand-typed ref
 * outside all three (covered by the plain unit cases in sourceRef.test.ts).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatSourceRef, parseSourceRef, type SourceRef } from './sourceRef';

const sheetRefArb: fc.Arbitrary<SourceRef> = fc.record({
  kind: fc.constant('sheet' as const),
  sheet: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 _-]{0,30}$/),
  range: fc.stringMatching(/^[A-Z]{1,3}[0-9]{1,6}(:[A-Z]{1,3}[0-9]{1,6})?$/),
});

const pdfRefArb: fc.Arbitrary<SourceRef> = fc.record({
  kind: fc.constant('pdf' as const),
  page: fc.integer({ min: 1, max: 9999 }),
  start: fc.integer({ min: 0, max: 999999 }),
  end: fc.integer({ min: 0, max: 999999 }),
});

const textRefArb: fc.Arbitrary<SourceRef> = fc.record({
  kind: fc.constant('text' as const),
  start: fc.integer({ min: 0, max: 999999 }),
  end: fc.integer({ min: 0, max: 999999 }),
});

describe('SourceRef round trip (RT-K3)', () => {
  it('formatSourceRef(parseSourceRef(s)) === s for every grammar', () => {
    fc.assert(
      fc.property(fc.oneof(sheetRefArb, pdfRefArb, textRefArb), (ref) => {
        const formatted = formatSourceRef(ref);
        expect(parseSourceRef(formatted)).toEqual(ref);
      }),
    );
  });
});
