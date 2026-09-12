import { describe, expect, it } from 'vitest';
import type { BranchRow } from '../../db/types';
import { canApproveOrMergeRequest, canArchiveModel, canDeleteModel, canEditBranch, canManageOrgSettings, canRestoreModel, canReviewMergeRequest } from './roleGates';

function branch(overrides: Partial<BranchRow>): BranchRow {
  return {
    id: 'branch-1',
    org_id: 'org-1',
    model_id: 'model-1',
    name: 'main',
    kind: 'main',
    status: 'draft',
    base_commit_id: 'genesis-commit-1',
    head_commit_id: 'commit-1',
    shared_for_review: false,
    title: null,
    description: null,
    target_date: null,
    split_from: null,
    created_by: 'user-1',
    updated_at: '2026-01-01T00:00:00.000Z',
    cancel_reason: null,
    cancelled_at: null,
    cancelled_by: null,
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

describe('canReviewMergeRequest', () => {
  it('owner/architect/contributor may reopen a request or push a refresh (mirrors atlas.request_changes)', () => {
    expect(canReviewMergeRequest('owner')).toBe(true);
    expect(canReviewMergeRequest('architect')).toBe(true);
    expect(canReviewMergeRequest('contributor')).toBe(true);
    expect(canReviewMergeRequest('viewer')).toBe(false);
    expect(canReviewMergeRequest(null)).toBe(false);
  });
});

describe('canApproveOrMergeRequest', () => {
  it('owner/architect only (mirrors atlas.approve_merge_request/reject_merge_request/merge_branch)', () => {
    expect(canApproveOrMergeRequest('owner')).toBe(true);
    expect(canApproveOrMergeRequest('architect')).toBe(true);
    expect(canApproveOrMergeRequest('contributor')).toBe(false);
    expect(canApproveOrMergeRequest('viewer')).toBe(false);
  });
});

describe('canArchiveModel', () => {
  it('owner/architect only (mirrors models_update RLS)', () => {
    expect(canArchiveModel('owner')).toBe(true);
    expect(canArchiveModel('architect')).toBe(true);
    expect(canArchiveModel('contributor')).toBe(false);
    expect(canArchiveModel('viewer')).toBe(false);
    expect(canArchiveModel(null)).toBe(false);
  });
});

describe('canRestoreModel', () => {
  it('owner only — narrower than archive ("Restore for owners")', () => {
    expect(canRestoreModel('owner')).toBe(true);
    expect(canRestoreModel('architect')).toBe(false);
    expect(canRestoreModel('contributor')).toBe(false);
  });
});

describe('canDeleteModel', () => {
  it('owner only (mirrors models_delete RLS)', () => {
    expect(canDeleteModel('owner')).toBe(true);
    expect(canDeleteModel('architect')).toBe(false);
  });
});

describe('canManageOrgSettings', () => {
  it('owner only (mirrors organisations_update/delete and members_insert/update/delete RLS)', () => {
    expect(canManageOrgSettings('owner')).toBe(true);
    expect(canManageOrgSettings('architect')).toBe(false);
    expect(canManageOrgSettings('contributor')).toBe(false);
    expect(canManageOrgSettings('viewer')).toBe(false);
    expect(canManageOrgSettings(null)).toBe(false);
  });
});
