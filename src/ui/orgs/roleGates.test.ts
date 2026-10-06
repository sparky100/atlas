import { describe, expect, it } from 'vitest';
import type { BranchRow } from '../../db/types';
import { canAddDecisionConcern, canApproveOrMergeRequest, canArchiveModel, canCancelDecision, canDiscardCaptureJob, canEditDecision, canDeleteModel, canEditBranch, canEditValueStreamStructure, canManageAttributeDefinitions, canManageOrgSettings, canRestoreModel, canReviewMergeRequest } from './roleGates';

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
    dismissed_identity_pairs: [],
    intent: null,
    project_id: null,
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

describe('canEditValueStreamStructure', () => {
  it('main: owner/architect only, same as canEditOnMain', () => {
    const main = branch({ kind: 'main' });
    expect(canEditValueStreamStructure('owner', main)).toBe(true);
    expect(canEditValueStreamStructure('architect', main)).toBe(true);
    expect(canEditValueStreamStructure('contributor', main)).toBe(false);
    expect(canEditValueStreamStructure(null, main)).toBe(false);
  });

  it('a draft, correct-intent change: owner/architect/contributor, same floor as canEditBranch', () => {
    const correct = branch({ kind: 'change', status: 'draft', intent: 'correct' });
    expect(canEditValueStreamStructure('owner', correct)).toBe(true);
    expect(canEditValueStreamStructure('contributor', correct)).toBe(true);
    expect(canEditValueStreamStructure('viewer', correct)).toBe(false);
  });

  it('a draft change with any other intent is refused, even for an owner (ADR-023: structural edits need a correction, not a proposal)', () => {
    for (const intent of ['propose', 'record', 'explore'] as const) {
      const change = branch({ kind: 'change', status: 'draft', intent });
      expect(canEditValueStreamStructure('owner', change)).toBe(false);
      expect(canEditValueStreamStructure('architect', change)).toBe(false);
    }
  });

  it('a correct-intent change under review (not draft) is refused, same as canEditBranch', () => {
    const underReview = branch({ kind: 'change', status: 'proposed', intent: 'correct' });
    expect(canEditValueStreamStructure('owner', underReview)).toBe(false);
  });

  it('a capture_draft branch is never editable this way', () => {
    const captureDraft = branch({ kind: 'capture_draft', status: 'draft', intent: 'correct' });
    expect(canEditValueStreamStructure('owner', captureDraft)).toBe(false);
  });
});

describe('canManageAttributeDefinitions', () => {
  it('owner only (mirrors attribute_definitions_insert/_update RLS)', () => {
    expect(canManageAttributeDefinitions('owner')).toBe(true);
    expect(canManageAttributeDefinitions('architect')).toBe(false);
    expect(canManageAttributeDefinitions('contributor')).toBe(false);
    expect(canManageAttributeDefinitions('viewer')).toBe(false);
    expect(canManageAttributeDefinitions(null)).toBe(false);
  });
});

describe('canCancelDecision (mirrors atlas.cancel_decision)', () => {
  const proposed = { status: 'proposed' as const, owner_id: 'owner-user' };
  it('lets an org owner or architect cancel any proposed decision', () => {
    expect(canCancelDecision('owner', proposed, 'someone')).toBe(true);
    expect(canCancelDecision('architect', proposed, 'someone')).toBe(true);
  });
  it("lets the decision's own owner cancel it, at any role", () => {
    expect(canCancelDecision('contributor', proposed, 'owner-user')).toBe(true);
    expect(canCancelDecision('contributor', proposed, 'someone-else')).toBe(false);
    expect(canCancelDecision('viewer', proposed, 'someone-else')).toBe(false);
  });
  it('refuses once the decision is no longer proposed, and for a non-member', () => {
    expect(canCancelDecision('owner', { ...proposed, status: 'accepted' }, 'owner-user')).toBe(false);
    expect(canCancelDecision('owner', { ...proposed, status: 'rejected' }, 'owner-user')).toBe(false);
    expect(canCancelDecision(null, proposed, 'owner-user')).toBe(false);
  });
});

describe('canEditDecision (mirrors decisions_update)', () => {
  const proposed = { status: 'proposed' as const, created_by: 'creator' };
  it('lets the creator, or an org owner/architect, edit a proposed decision', () => {
    expect(canEditDecision('contributor', proposed, 'creator')).toBe(true);
    expect(canEditDecision('owner', proposed, 'someone')).toBe(true);
    expect(canEditDecision('architect', proposed, 'someone')).toBe(true);
    expect(canEditDecision('contributor', proposed, 'someone')).toBe(false);
  });
  it('refuses viewers, non-members, and any decision no longer proposed', () => {
    expect(canEditDecision('viewer', proposed, 'creator')).toBe(false);
    expect(canEditDecision(null, proposed, 'creator')).toBe(false);
    expect(canEditDecision('owner', { ...proposed, status: 'accepted' }, 'creator')).toBe(false);
    expect(canEditDecision('owner', { ...proposed, status: 'rejected' }, 'creator')).toBe(false);
  });
});

describe('canAddDecisionConcern (mirrors decision_links_insert)', () => {
  it('owner, architect or contributor, while proposed', () => {
    expect(canAddDecisionConcern('contributor', { status: 'proposed' })).toBe(true);
    expect(canAddDecisionConcern('viewer', { status: 'proposed' })).toBe(false);
    expect(canAddDecisionConcern('owner', { status: 'accepted' })).toBe(false);
  });
});

describe('canDiscardCaptureJob', () => {
  const parsedJob = { createdBy: 'user-1', status: 'parsed' };

  it('lets the contributor who created a parsed job discard it', () => {
    expect(canDiscardCaptureJob('contributor', parsedJob, 'user-1')).toBe(true);
  });

  it("refuses a contributor who didn't create the job", () => {
    expect(canDiscardCaptureJob('contributor', parsedJob, 'user-2')).toBe(false);
  });

  it('lets any owner or architect discard', () => {
    expect(canDiscardCaptureJob('owner', parsedJob, 'user-2')).toBe(true);
    expect(canDiscardCaptureJob('architect', parsedJob, 'user-2')).toBe(true);
  });

  it('refuses a viewer even on their own job', () => {
    expect(canDiscardCaptureJob('viewer', parsedJob, 'user-1')).toBe(false);
  });

  it('refuses once the job is reviewed or discarded', () => {
    expect(canDiscardCaptureJob('owner', { createdBy: 'user-1', status: 'reviewed' }, 'user-1')).toBe(false);
    expect(canDiscardCaptureJob('owner', { createdBy: 'user-1', status: 'discarded' }, 'user-1')).toBe(false);
  });
});
