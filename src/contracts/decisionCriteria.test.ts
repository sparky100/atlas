import { describe, expect, it } from 'vitest';
import {
  DECISION_CRITERIA,
  DECISION_RATING_LEVELS,
  DECISION_RATING_NOTE_MAX_LENGTH,
  decisionCriterionByKey,
  decisionCriterionLevelLabel,
  decisionRatingLevelTone,
  isDecisionRatingLevel,
  isValidDecisionRatingNote,
} from './decisionCriteria';

describe('DECISION_CRITERIA', () => {
  it('has the outcome first, then the five named criteria, in the brief\'s own order', () => {
    expect(DECISION_CRITERIA.map((c) => c.key)).toEqual(['outcome', 'cost', 'effort', 'deliveryRisk', 'timing', 'vendorFit']);
  });

  it('has no duplicate criterion keys', () => {
    const keys = DECISION_CRITERIA.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every criterion defines a label for all three levels', () => {
    for (const criterion of DECISION_CRITERIA) {
      for (const level of DECISION_RATING_LEVELS) {
        expect(criterion.levelLabels[level].length).toBeGreaterThan(0);
      }
    }
  });

  it("timing's own labels name the support-end-date judgement, not a generic low/medium/high scale", () => {
    expect(decisionCriterionLevelLabel('timing', 'favourable')).toBe('Before end date');
    expect(decisionCriterionLevelLabel('timing', 'acceptable')).toBe('At risk');
    expect(decisionCriterionLevelLabel('timing', 'unfavourable')).toBe('After end date');
  });

  it('decisionCriterionByKey finds a real criterion and reports undefined for an unknown one', () => {
    expect(decisionCriterionByKey('cost')?.label).toBe('Cost');
    expect(decisionCriterionByKey('not-a-real-criterion')).toBeUndefined();
  });

  it('decisionCriterionLevelLabel reports undefined for an unknown criterion, never a guessed fallback', () => {
    expect(decisionCriterionLevelLabel('not-a-real-criterion', 'favourable')).toBeUndefined();
  });
});

describe('DECISION_RATING_LEVELS / tone', () => {
  it('is ordered favourable, acceptable, unfavourable', () => {
    expect(DECISION_RATING_LEVELS).toEqual(['favourable', 'acceptable', 'unfavourable']);
  });

  it('maps each level to the good/ok/poor tone, never colour alone (paired with a label everywhere it renders)', () => {
    expect(decisionRatingLevelTone('favourable')).toBe('ok');
    expect(decisionRatingLevelTone('acceptable')).toBe('warn');
    expect(decisionRatingLevelTone('unfavourable')).toBe('danger');
  });

  it('isDecisionRatingLevel accepts only the three real levels', () => {
    expect(isDecisionRatingLevel('favourable')).toBe(true);
    expect(isDecisionRatingLevel('acceptable')).toBe(true);
    expect(isDecisionRatingLevel('unfavourable')).toBe(true);
    expect(isDecisionRatingLevel('good')).toBe(false);
    expect(isDecisionRatingLevel('')).toBe(false);
  });
});

describe('isValidDecisionRatingNote', () => {
  it('accepts null (no note) and an empty string', () => {
    expect(isValidDecisionRatingNote(null)).toBe(true);
    expect(isValidDecisionRatingNote('')).toBe(true);
  });

  it(`accepts a note exactly at the ${String(DECISION_RATING_NOTE_MAX_LENGTH)}-character cap`, () => {
    expect(isValidDecisionRatingNote('x'.repeat(DECISION_RATING_NOTE_MAX_LENGTH))).toBe(true);
  });

  it('rejects a note one character over the cap', () => {
    expect(isValidDecisionRatingNote('x'.repeat(DECISION_RATING_NOTE_MAX_LENGTH + 1))).toBe(false);
  });

  it('trims before checking — trailing whitespace alone never tips a note over the limit', () => {
    const padded = `${'x'.repeat(DECISION_RATING_NOTE_MAX_LENGTH)}   `;
    expect(isValidDecisionRatingNote(padded)).toBe(true);
  });
});
