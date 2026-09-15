import { describe, expect, it } from 'vitest';
import type { BranchIntent } from '../../db/types';
import { INTENT_LABEL, INTENT_OPTIONS, NEW_CHANGE_INTENT_OPTIONS, dateFieldLabelForIntent, defaultIntentForEntryPoint, intentHeaderLine, intentReviewWeight, isDateRequiredForIntent } from './branchIntent';

const ALL_INTENTS: readonly BranchIntent[] = ['record', 'propose', 'correct', 'explore'];

describe('defaultIntentForEntryPoint', () => {
  it("F0's own named defaults per entry point", () => {
    expect(defaultIntentForEntryPoint('elementPage')).toBe('correct');
    expect(defaultIntentForEntryPoint('directorDoor')).toBe('propose');
    expect(defaultIntentForEntryPoint('whatHappened')).toBe('record');
  });

  it('homeSearch/changesList fall back to the generic propose default', () => {
    expect(defaultIntentForEntryPoint('homeSearch')).toBe('propose');
    expect(defaultIntentForEntryPoint('changesList')).toBe('propose');
  });
});

describe('INTENT_OPTIONS / INTENT_LABEL', () => {
  it('cover exactly the four intents, in the same order, with no duplicates', () => {
    expect(INTENT_OPTIONS.map((o) => o.value)).toEqual(['record', 'propose', 'correct', 'explore']);
    expect(Object.keys(INTENT_LABEL).sort()).toEqual([...ALL_INTENTS].sort());
  });

  it('every INTENT_LABEL entry is a short, non-empty string distinct from the others', () => {
    const labels = ALL_INTENTS.map((intent) => INTENT_LABEL[intent]);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
  });

  it('NEW_CHANGE_INTENT_OPTIONS is every intent except explore, in the same order', () => {
    expect(NEW_CHANGE_INTENT_OPTIONS.map((o) => o.value)).toEqual(['record', 'propose', 'correct']);
  });
});

describe('intentHeaderLine', () => {
  it("record/propose/explore prefix the branch's own title with the intent sentence", () => {
    expect(intentHeaderLine({ intent: 'record', title: 'Dynamics went live', name: 'dynamics-live' })).toBe('Recording: Dynamics went live');
    expect(intentHeaderLine({ intent: 'propose', title: 'Replace ADQM', name: 'replace-adqm' })).toBe('Proposing: Replace ADQM');
    expect(intentHeaderLine({ intent: 'explore', title: 'Option B', name: 'option-b' })).toBe('Exploring: Option B');
  });

  it('falls back to name when title is null', () => {
    expect(intentHeaderLine({ intent: 'propose', title: null, name: 'replace-adqm' })).toBe('Proposing: replace-adqm');
  });

  it('correct gets no title suffix at all — provenance answers "who says so", not a summary sentence', () => {
    expect(intentHeaderLine({ intent: 'correct', title: 'Fix the vendor field', name: 'fix-vendor' })).toBe('Correction');
  });

  it('null intent (a non-change branch, or one predating the migration) falls back to the plain title/name', () => {
    expect(intentHeaderLine({ intent: null, title: 'Main', name: 'main' })).toBe('Main');
    expect(intentHeaderLine({ intent: null, title: null, name: 'main' })).toBe('main');
  });
});

describe('intentReviewWeight', () => {
  it('record/correct: single approver, no queue', () => {
    expect(intentReviewWeight('record')).toBe('single');
    expect(intentReviewWeight('correct')).toBe('single');
  });

  it('propose/explore: the full review queue', () => {
    expect(intentReviewWeight('propose')).toBe('queue');
    expect(intentReviewWeight('explore')).toBe('queue');
  });
});

describe('dateFieldLabelForIntent / isDateRequiredForIntent', () => {
  it('record: "Delivered date", required', () => {
    expect(dateFieldLabelForIntent('record')).toBe('Delivered date');
    expect(isDateRequiredForIntent('record')).toBe(true);
  });

  it('propose: "Target date", required', () => {
    expect(dateFieldLabelForIntent('propose')).toBe('Target date');
    expect(isDateRequiredForIntent('propose')).toBe(true);
  });

  it('correct/explore: no date field at all, never required', () => {
    expect(dateFieldLabelForIntent('correct')).toBeNull();
    expect(dateFieldLabelForIntent('explore')).toBeNull();
    expect(isDateRequiredForIntent('correct')).toBe(false);
    expect(isDateRequiredForIntent('explore')).toBe(false);
  });

  it('a date is required only when there is a field to fill in the first place', () => {
    for (const intent of ALL_INTENTS) {
      if (isDateRequiredForIntent(intent)) expect(dateFieldLabelForIntent(intent)).not.toBeNull();
    }
  });
});
