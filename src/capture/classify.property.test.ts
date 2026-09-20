/**
 * P-K8 (SPEC-capture.md §13): for arbitrary (candidate, main fact) pairs,
 * `conflict` iff the value differs and main's fact is stronger by §4.4's
 * rule; `confirm` iff all values equal; `update` otherwise.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifyAttribute, deepEqualJson, type AttributeMainFact } from './classify';

const jsonValueArb: fc.Arbitrary<unknown> = fc.oneof(fc.string(), fc.integer(), fc.boolean());
const isoDate = fc.date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-01-01T00:00:00Z'), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10));
const confidence = fc.float({ min: 0, max: 1, noNaN: true });

const mainFactArb: fc.Arbitrary<AttributeMainFact> = fc.record({ value: jsonValueArb, confidence, effectiveOrAssertedDate: isoDate });

describe('classifyAttribute (P-K8)', () => {
  it('is confirm iff the proposed value deep-equals main\'s current value', () => {
    fc.assert(
      fc.property(jsonValueArb, mainFactArb, fc.option(isoDate, { nil: null }), confidence, (proposedValue, mainFact, sourceCapturedAt, proposedConfidence) => {
        const outcome = classifyAttribute({ proposedValue, proposedConfidence, mainFact, sourceCapturedAt });
        expect(outcome === 'confirm').toBe(deepEqualJson(proposedValue, mainFact.value));
      }),
    );
  });

  it('is update when main has no recorded fact for this attribute at all', () => {
    fc.assert(
      fc.property(jsonValueArb, confidence, fc.option(isoDate, { nil: null }), (proposedValue, proposedConfidence, sourceCapturedAt) => {
        expect(classifyAttribute({ proposedValue, proposedConfidence, mainFact: undefined, sourceCapturedAt })).toBe('update');
      }),
    );
  });

  it('is conflict iff the values differ and main is stronger (confidence >= candidate, or main\'s own date is later than the source\'s captured_at)', () => {
    fc.assert(
      fc.property(jsonValueArb, jsonValueArb, mainFactArb, confidence, isoDate, (proposedValue, mainValue, mainFactBase, proposedConfidence, sourceCapturedAt) => {
        const mainFact: AttributeMainFact = { ...mainFactBase, value: mainValue };
        const outcome = classifyAttribute({ proposedValue, proposedConfidence, mainFact, sourceCapturedAt });
        const valuesDiffer = !deepEqualJson(proposedValue, mainValue);
        const mainStronger = mainFact.confidence >= proposedConfidence || mainFact.effectiveOrAssertedDate > sourceCapturedAt;
        expect(outcome === 'conflict').toBe(valuesDiffer && mainStronger);
        expect(outcome === 'update').toBe(valuesDiffer && !mainStronger);
      }),
    );
  });
});
