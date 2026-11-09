import { describe, expect, it } from 'vitest';
import { branchStatusTone } from '../changes/branchStatus';
import { CRITICALITY_TONE } from './criticalityTone';
import { dispositionTone } from './disposition';
import { FIT_FOR_PURPOSE_TONE } from './fitForPurposeTone';
import { LIFECYCLE_TONE } from './lifecycleTone';
import { DOMAIN_TONE } from './systemDomain';

/** docs/UI-principles.md §8.4a: green healthy/done, amber needs attention soon, red a problem now, blue in progress/informational, grey not assessed/inactive/ended. */
describe('status colours keep one meaning (§8.4a)', () => {
  it('lifecycle: a retired system is red, retiring amber, active green, planned blue', () => {
    expect(LIFECYCLE_TONE).toEqual({ planned: 'info', active: 'ok', retiring: 'warn', retired: 'danger' });
  });

  it('planned actions are plans, never fault colours', () => {
    expect(dispositionTone('invest')).toBe('ok');
    expect(dispositionTone('tolerate')).toBe('info');
    expect(dispositionTone('migrate')).toBe('info');
    expect(dispositionTone('eliminate')).toBe('info');
    expect(dispositionTone(null)).toBe('neutral');
  });

  it('fit: good is green, weak fit is amber, red is not used for fit', () => {
    expect(FIT_FOR_PURPOSE_TONE).toEqual({ excellent: 'ok', good: 'ok', adequate: 'warn', poor: 'warn' });
  });

  it('a domain is a fact, not a risk', () => {
    expect(Object.values(DOMAIN_TONE).every((tone) => tone === 'neutral')).toBe(true);
  });

  it('criticality: critical is red, low is grey', () => {
    expect(CRITICALITY_TONE.critical).toBe('danger');
    expect(CRITICALITY_TONE.low).toBe('neutral');
  });

  it('a rejected change is red, a draft grey, one in review blue', () => {
    expect(branchStatusTone('rejected')).toBe('danger');
    expect(branchStatusTone('draft')).toBe('neutral');
    expect(branchStatusTone('in_review')).toBe('info');
  });
});
