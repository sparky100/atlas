import { describe, expect, it } from 'vitest';
import type { BranchRow } from '../../db/types';
import { canEditBranch } from './roleGates';

function branch(overrides: Partial<BranchRow>): BranchRow {
  return {
    id: 'branch-1',
    org_id: 'org-1',
    model_id: 'model-1',
    name: 'main',
    kind: 'main',
    status: 'draft',
    base_commit_id: null,
    head_commit_id: 'commit-1',
    shared_for_review: false,
    title: null,
    description: null,
    target_date: null,
    split_from: null,
    created_by: 'user-1',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('canEditBranch', () => {
  it('main: owner/architect only (mirrors atlas.commit_deltas, ADR-015)', () => {
    const main = branch({ kind: 'main' });
    expect(canEditBranch('owner', main)).toBe(true);
    expect(canEditBranch('architect', main)).toBe(true);
    expect(canEditBranch('contributor', main)).toBe(false);
    expect(canEditBranch('viewer', main)).toBe(false);
    expect(canEditBranch(null, main)).toBe(false);
  });

  it('a draft change branch: owner/architect/contributor (ADR-009)', () => {
    const draft = branch({ kind: 'change', status: 'draft' });
    expect(canEditBranch('owner', draft)).toBe(true);
    expect(canEditBranch('architect', draft)).toBe(true);
    expect(canEditBranch('contributor', draft)).toBe(true);
    expect(canEditBranch('viewer', draft)).toBe(false);
  });

  it('a change branch under review (proposed/approved/etc.) is never editable, whatever the role (S-18: new commits only while draft)', () => {
    for (const status of ['proposed', 'in_review', 'approved', 'merged', 'rejected', 'archived'] as const) {
      const underReview = branch({ kind: 'change', status });
      expect(canEditBranch('owner', underReview)).toBe(false);
      expect(canEditBranch('contributor', underReview)).toBe(false);
    }
  });

  it('a capture_draft branch is never editable from this affordance (ADR-004: triaged one delta at a time, not via the element page editor)', () => {
    const captureDraft = branch({ kind: 'capture_draft', status: 'draft' });
    expect(canEditBranch('owner', captureDraft)).toBe(false);
    expect(canEditBranch('architect', captureDraft)).toBe(false);
  });
});
