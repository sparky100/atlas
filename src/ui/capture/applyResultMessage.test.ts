import { describe, expect, it } from 'vitest';
import { applyResultMessage } from './applyResultMessage';

describe('applyResultMessage', () => {
  it('says "Merged to main" when the auto-merge succeeded', () => {
    expect(applyResultMessage({ appliedCount: 5, merged: true })).toBe('Applied 5 items. Merged to main.');
  });

  it('says nothing extra when auto-merge was never attempted because the reviewer is not owner/architect', () => {
    expect(applyResultMessage({ appliedCount: 5, merged: false, mergeSkippedReason: 'not_eligible_role' })).toBe('Applied 5 items.');
  });

  it('says nothing extra when auto-merge was never attempted because the target is propose/explore', () => {
    expect(applyResultMessage({ appliedCount: 5, merged: false, mergeSkippedReason: 'not_eligible_intent' })).toBe('Applied 5 items.');
  });

  it('names the failure when auto-merge was attempted but did not succeed, so the reviewer knows to submit it by hand', () => {
    const message = applyResultMessage({ appliedCount: 5, merged: false, mergeSkippedReason: 'main advanced since this request was approved' });
    expect(message).toContain('Applied 5 items.');
    expect(message).toContain('main advanced since this request was approved');
    expect(message).toContain('submit this change for review');
  });

  it('is the plain base message with no reason at all', () => {
    expect(applyResultMessage({ appliedCount: 5, merged: false })).toBe('Applied 5 items.');
  });
});
