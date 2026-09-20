import { describe, expect, it } from 'vitest';
import type { MatchOutcome } from '../contracts/capture';
import { classifyAttribute, classifyElement, classifyRelationship, deepEqualJson } from './classify';

function matchOutcome(overrides: Partial<MatchOutcome> = {}): MatchOutcome {
  return { level: 'none', score: 0, similar: [], warnings: [], ...overrides };
}

describe('deepEqualJson', () => {
  it('compares primitives, arrays and plain objects structurally', () => {
    expect(deepEqualJson('a', 'a')).toBe(true);
    expect(deepEqualJson(1, 2)).toBe(false);
    expect(deepEqualJson([1, 2], [1, 2])).toBe(true);
    expect(deepEqualJson([1, 2], [2, 1])).toBe(false);
    expect(deepEqualJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqualJson({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqualJson(null, undefined)).toBe(false);
  });
});

describe('classifyAttribute', () => {
  it('is "update" when main has no fact for this attribute at all', () => {
    expect(classifyAttribute({ proposedValue: 'x', proposedConfidence: 0.8, mainFact: undefined, sourceCapturedAt: null })).toBe('update');
  });

  it('is "confirm" when the proposed value deep-equals main\'s current value', () => {
    expect(classifyAttribute({ proposedValue: 'x', proposedConfidence: 0.8, mainFact: { value: 'x', confidence: 0.5, effectiveOrAssertedDate: '2020-01-01' }, sourceCapturedAt: '2026-01-01' })).toBe('confirm');
  });

  it('is "update" when values differ and neither strength rule favours main', () => {
    const outcome = classifyAttribute({
      proposedValue: 'new-vendor',
      proposedConfidence: 0.9,
      mainFact: { value: 'old-vendor', confidence: 0.5, effectiveOrAssertedDate: '2020-01-01' },
      sourceCapturedAt: '2026-01-01',
    });
    expect(outcome).toBe('update');
  });

  it('is "conflict" when main\'s confidence is at least the candidate\'s', () => {
    const outcome = classifyAttribute({
      proposedValue: 'new-vendor',
      proposedConfidence: 0.5,
      mainFact: { value: 'old-vendor', confidence: 0.9, effectiveOrAssertedDate: '2020-01-01' },
      sourceCapturedAt: '2026-01-01',
    });
    expect(outcome).toBe('conflict');
  });

  it('is "conflict" when main\'s own effective/asserted date is later than the source\'s captured_at', () => {
    const outcome = classifyAttribute({
      proposedValue: 'new-vendor',
      proposedConfidence: 0.9,
      mainFact: { value: 'old-vendor', confidence: 0.1, effectiveOrAssertedDate: '2026-06-01' },
      sourceCapturedAt: '2026-01-01',
    });
    expect(outcome).toBe('conflict');
  });

  it('never treats main as stronger by date alone when the source has no captured_at', () => {
    const outcome = classifyAttribute({
      proposedValue: 'new-vendor',
      proposedConfidence: 0.9,
      mainFact: { value: 'old-vendor', confidence: 0.1, effectiveOrAssertedDate: '2026-06-01' },
      sourceCapturedAt: null,
    });
    expect(outcome).toBe('update');
  });
});

describe('classifyElement', () => {
  it('is "new" when the match level is none', () => {
    expect(classifyElement({ match: matchOutcome({ level: 'none' }), attributes: [] })).toBe('new');
  });

  it('is "ambiguous" whenever the match outcome names ambiguous hits, regardless of attributes', () => {
    const match = matchOutcome({ level: 'name_context', elementId: 'el-1', score: 0.7, ambiguous: [{ elementId: 'el-1', name: 'A', score: 0.7 }, { elementId: 'el-2', name: 'B', score: 0.68 }] });
    expect(classifyElement({ match, attributes: [] })).toBe('ambiguous');
  });

  it('is "confirm" when matched and every attribute already equals main', () => {
    const match = matchOutcome({ level: 'alias', elementId: 'el-1', score: 1 });
    const attributes = [{ proposedValue: 'x', proposedConfidence: 0.8, mainFact: { value: 'x', confidence: 0.5, effectiveOrAssertedDate: '2020-01-01' }, sourceCapturedAt: '2026-01-01' }];
    expect(classifyElement({ match, attributes })).toBe('confirm');
  });

  it('is "update" when matched and some attribute differs with neither strength rule favouring main', () => {
    const match = matchOutcome({ level: 'alias', elementId: 'el-1', score: 1 });
    const attributes = [{ proposedValue: 'y', proposedConfidence: 0.9, mainFact: { value: 'x', confidence: 0.1, effectiveOrAssertedDate: '2020-01-01' }, sourceCapturedAt: '2026-01-01' }];
    expect(classifyElement({ match, attributes })).toBe('update');
  });

  it('is "conflict" as soon as any one attribute conflicts, even if others are plain updates', () => {
    const match = matchOutcome({ level: 'alias', elementId: 'el-1', score: 1 });
    const attributes = [
      { proposedValue: 'y', proposedConfidence: 0.9, mainFact: { value: 'x', confidence: 0.1, effectiveOrAssertedDate: '2020-01-01' }, sourceCapturedAt: '2026-01-01' },
      { proposedValue: 'z', proposedConfidence: 0.1, mainFact: { value: 'w', confidence: 0.9, effectiveOrAssertedDate: '2020-01-01' }, sourceCapturedAt: '2026-01-01' },
    ];
    expect(classifyElement({ match, attributes })).toBe('conflict');
  });
});

describe('classifyRelationship', () => {
  it('is "new" when no existing (type, from, to) triple exists', () => {
    expect(classifyRelationship({ existingRelationship: undefined })).toBe('new');
  });

  it('is "confirm" when an existing relationship\'s attributes all already equal the proposal', () => {
    const attributes = [{ proposedValue: 'x', proposedConfidence: 0.8, mainFact: { value: 'x', confidence: 0.5, effectiveOrAssertedDate: '2020-01-01' }, sourceCapturedAt: '2026-01-01' }];
    expect(classifyRelationship({ existingRelationship: { attributes } })).toBe('confirm');
  });

  it('is "confirm" when the existing relationship has no compared attributes at all', () => {
    expect(classifyRelationship({ existingRelationship: { attributes: [] } })).toBe('confirm');
  });

  it('is "conflict" when an existing relationship attribute conflicts', () => {
    const attributes = [{ proposedValue: 'y', proposedConfidence: 0.1, mainFact: { value: 'x', confidence: 0.9, effectiveOrAssertedDate: '2020-01-01' }, sourceCapturedAt: '2026-01-01' }];
    expect(classifyRelationship({ existingRelationship: { attributes } })).toBe('conflict');
  });
});
