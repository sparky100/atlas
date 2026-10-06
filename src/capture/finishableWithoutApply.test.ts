import { describe, expect, it } from 'vitest';
import { finishableWithoutApply } from './finishableWithoutApply';

const rejected = { decision: 'rejected' as const, promotedCommitId: null };
const undecided = { decision: null, promotedCommitId: null };
const acceptedUnapplied = { decision: 'accepted' as const, promotedCommitId: null };
const acceptedApplied = { decision: 'accepted' as const, promotedCommitId: '00000000-0000-0000-0000-000000000001' };

describe('finishableWithoutApply', () => {
  it('is true when every candidate is rejected', () => {
    expect(finishableWithoutApply([rejected, rejected])).toBe(true);
  });

  it('is true when the only non-rejected candidates were already promoted', () => {
    expect(finishableWithoutApply([rejected, acceptedApplied])).toBe(true);
  });

  it('is false while any candidate is undecided', () => {
    expect(finishableWithoutApply([rejected, undecided])).toBe(false);
  });

  it('is false while an accepted candidate still needs applying to a change', () => {
    expect(finishableWithoutApply([rejected, acceptedUnapplied])).toBe(false);
  });

  it('is true for a draft with no candidates — there is nothing to apply', () => {
    expect(finishableWithoutApply([])).toBe(true);
  });
});
