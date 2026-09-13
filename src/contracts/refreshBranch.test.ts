/**
 * Round-trip tests for src/contracts/rows.ts's atlas.refresh_branch contract
 * (ADR-021 §5 item 5, rule 1: migration + contract type + round-trip test,
 * together). Two directions, since the RPC's params and its return are
 * different shapes with no single inverse: `toDeltaWireRow`/
 * `toRefreshBranchParams` on the way in (reconstructing a `Delta` from the
 * wire row it produces, minus only the five DB-assigned fields it's
 * documented to drop), `fromRefreshBranchResult` on the way back.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { UUID } from './delta';
import { deltaArb } from './delta.property.test';
import { fromDeltaRow, fromRefreshBranchResult, toDeltaRow, toDeltaWireRow, toRefreshBranchParams, type RefreshBranchInput } from './rows';

const uuid = fc.uuid();

describe('toDeltaWireRow (RT, contract level)', () => {
  it('drops exactly the five DB-assigned fields — reintroducing them with placeholders reconstructs the original delta', () => {
    fc.assert(
      fc.property(deltaArb, uuid, uuid, uuid, fc.integer({ min: 0, max: 100 }), (delta, orgId, modelId, createdBy, seq) => {
        const wire = toDeltaWireRow(delta);
        const reconstructed = fromDeltaRow({ ...wire, commit_id: 'x', org_id: orgId, model_id: modelId, seq, created_by: createdBy });
        expect(reconstructed).toEqual(delta);
      }),
    );
  });

  it('is exactly toDeltaRow with commit_id/org_id/model_id/seq/created_by stripped, whatever context toDeltaRow was given', () => {
    fc.assert(
      fc.property(deltaArb, uuid, uuid, uuid, uuid, fc.integer({ min: 0, max: 100 }), (delta, orgId, modelId, commitId, createdBy, seq) => {
        const full = toDeltaRow(delta, { orgId, modelId, commitId, seq, createdBy });
        expect(toDeltaWireRow(delta)).toEqual({
          id: full.id,
          kind: full.kind,
          subject_type: full.subject_type,
          subject_id: full.subject_id,
          attribute: full.attribute,
          element_type: full.element_type,
          relationship_type: full.relationship_type,
          name: full.name,
          parent_id: full.parent_id,
          from_element_id: full.from_element_id,
          to_element_id: full.to_element_id,
          value: full.value,
          previous_delta_id: full.previous_delta_id,
          source_id: full.source_id,
          source_ref: full.source_ref,
          effective_date: full.effective_date,
          confidence: full.confidence,
        });
      }),
    );
  });
});

describe('toRefreshBranchParams (ADR-021 §5 item 5)', () => {
  const refreshInputArb: fc.Arbitrary<RefreshBranchInput> = fc
    .tuple(uuid, uuid, uuid, fc.boolean(), uuid, fc.string({ minLength: 1, maxLength: 40 }), fc.array(deltaArb, { maxLength: 3 }), uuid, fc.string({ minLength: 1, maxLength: 40 }), fc.array(deltaArb, { maxLength: 3 }))
    .map(([branchId, expectedHeadCommitId, mainHeadCommitId, hasPrep, prepId, prepTitle, prepDeltas, mergeId, mergeTitle, mergeDeltas]) => ({
      branchId,
      expectedHeadCommitId,
      mainHeadCommitId,
      prepCommit: hasPrep ? { id: prepId, title: prepTitle, deltas: prepDeltas } : null,
      mergeCommit: { id: mergeId, title: mergeTitle, deltas: mergeDeltas },
      resolvedConflicts: [],
    }));

  it('carries branch/head/main ids straight through, unchanged', () => {
    fc.assert(
      fc.property(refreshInputArb, (input) => {
        const params = toRefreshBranchParams(input);
        expect(params.p_branch_id).toBe(input.branchId);
        expect(params.p_expected_head_commit_id).toBe(input.expectedHeadCommitId);
        expect(params.p_main_head_commit_id).toBe(input.mainHeadCommitId);
      }),
    );
  });

  it('p_prep_commit is null exactly when prepCommit is null; otherwise its id/title pass through and its deltas map through toDeltaWireRow', () => {
    fc.assert(
      fc.property(refreshInputArb, (input) => {
        const params = toRefreshBranchParams(input);
        if (input.prepCommit === null) {
          expect(params.p_prep_commit).toBeNull();
        } else {
          expect(params.p_prep_commit).not.toBeNull();
          expect(params.p_prep_commit?.id).toBe(input.prepCommit.id);
          expect(params.p_prep_commit?.title).toBe(input.prepCommit.title);
          expect(params.p_prep_commit?.deltas).toEqual(input.prepCommit.deltas.map(toDeltaWireRow));
        }
      }),
    );
  });

  it('p_merge_commit always carries the merge commit\'s own id/title/deltas', () => {
    fc.assert(
      fc.property(refreshInputArb, (input) => {
        const params = toRefreshBranchParams(input);
        expect(params.p_merge_commit.id).toBe(input.mergeCommit.id);
        expect(params.p_merge_commit.title).toBe(input.mergeCommit.title);
        expect(params.p_merge_commit.deltas).toEqual(input.mergeCommit.deltas.map(toDeltaWireRow));
      }),
    );
  });
});

describe('fromRefreshBranchResult (round trip on the RPC\'s own return)', () => {
  it('"ok" with a prep commit round-trips both ids', () => {
    const mergeCommitId: UUID = 'merge-1';
    const prepCommitId: UUID = 'prep-1';
    expect(fromRefreshBranchResult({ status: 'ok', prepCommitId, mergeCommitId })).toEqual({ status: 'ok', prepCommitId, mergeCommitId });
  });

  it('"ok" with no prep commit round-trips prepCommitId as null, whether the row omits it or sends null explicitly', () => {
    const mergeCommitId: UUID = 'merge-1';
    expect(fromRefreshBranchResult({ status: 'ok', mergeCommitId })).toEqual({ status: 'ok', prepCommitId: null, mergeCommitId });
    expect(fromRefreshBranchResult({ status: 'ok', prepCommitId: null, mergeCommitId })).toEqual({ status: 'ok', prepCommitId: null, mergeCommitId });
  });

  it('"stale_head" round-trips with no other fields', () => {
    expect(fromRefreshBranchResult({ status: 'stale_head' })).toEqual({ status: 'stale_head' });
  });

  it('"invalid" round-trips its reason', () => {
    expect(fromRefreshBranchResult({ status: 'invalid', reason: 'branch not found' })).toEqual({ status: 'invalid', reason: 'branch not found' });
  });

  it('throws rather than silently defaulting when a required field is missing', () => {
    expect(() => fromRefreshBranchResult({ status: 'ok' })).toThrow(/mergeCommitId/);
    expect(() => fromRefreshBranchResult({ status: 'invalid' })).toThrow(/reason/);
  });
});
