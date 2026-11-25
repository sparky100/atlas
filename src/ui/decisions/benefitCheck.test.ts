import { describe, expect, it } from 'vitest';
import { benefitLine, benefitStepState } from './benefitCheck';

describe('benefitLine', () => {
  it('names who confirmed it, when, the answer and the note', () => {
    expect(benefitLine({ result: 'partly', note: 'Quotes take four days.', recorded_at: '2027-04-03T10:00:00Z' }, 'Priya Shah')).toBe('Benefit confirmed by Priya Shah on 2027-04-03: Partly. Quotes take four days.');
    expect(benefitLine({ result: 'yes', note: '  ', recorded_at: '2027-04-03T10:00:00Z' }, 'Priya Shah')).toBe('Benefit confirmed by Priya Shah on 2027-04-03: Yes.');
  });

  it('never calls "not yet" a confirmation', () => {
    const line = benefitLine({ result: 'not_yet', note: 'Still at eight days.', recorded_at: '2027-02-01T10:00:00Z' }, 'Priya Shah');
    expect(line).toBe('Checked with Priya Shah on 2027-02-01: not yet. Still at eight days.');
    expect(line).not.toMatch(/confirmed/i);
  });
});

describe('benefitStepState', () => {
  it('applies only once the chosen option is in the live model, and never to staying as we are', () => {
    expect(benefitStepState({ chosenIsBaseline: true, inLiveModel: true })).toBe('not_applicable');
    expect(benefitStepState({ chosenIsBaseline: false, inLiveModel: false })).toBe('waiting_for_live');
    expect(benefitStepState({ chosenIsBaseline: false, inLiveModel: true })).toBe('open');
  });
});
