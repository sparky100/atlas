import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../contracts/rows';
import type { MemberRole } from './types';
import { deriveReviewerSet, ownerReviewerCandidates, pickArchitect } from './deriveReviewers';

function actor(id: string, memberId: string | null): ElementsHeadRow {
  return { element_id: id, element_type: 'actor', name: id, parent_id: null, attributes: memberId ? { memberId } : {}, exists_delta_id: `d-${id}` };
}

function owns(fromId: string, toId: string, role: string): RelationshipsHeadRow {
  return { relationship_id: `r-${fromId}-${toId}-${role}`, relationship_type: 'owns', from_element_id: fromId, to_element_id: toId, attributes: { role }, exists_delta_id: `d-${fromId}` };
}

describe('ownerReviewerCandidates', () => {
  it('resolves touched systems business + technical owners and affected capabilities business owners to their memberIds', () => {
    const actors = new Map([
      ['biz', actor('biz', 'u-biz')],
      ['tech', actor('tech', 'u-tech')],
      ['capbiz', actor('capbiz', 'u-capbiz')],
    ]);
    const ownsEdges = [
      owns('biz', 'sys-1', 'business'),
      owns('tech', 'sys-1', 'technical'),
      owns('capbiz', 'cap-1', 'business'),
      owns('biz', 'other', 'business'),
    ];
    const candidates = ownerReviewerCandidates(['sys-1'], ['cap-1'], ownsEdges, actors);
    expect(candidates.map((c) => c.userId).sort()).toEqual(['u-biz', 'u-capbiz', 'u-tech'].sort());
    expect(candidates.every((c) => c.required)).toBe(true);
  });

  it('dedupes a member who owns several touched things', () => {
    const actors = new Map([['biz', actor('biz', 'u-biz')]]);
    const ownsEdges = [owns('biz', 'sys-1', 'business'), owns('biz', 'sys-2', 'technical'), owns('biz', 'cap-1', 'business')];
    const candidates = ownerReviewerCandidates(['sys-1', 'sys-2'], ['cap-1'], ownsEdges, actors);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.userId).toBe('u-biz');
  });

  it('skips owner actors with no memberId', () => {
    const actors = new Map([['biz', actor('biz', null)]]);
    const ownsEdges = [owns('biz', 'sys-1', 'business')];
    expect(ownerReviewerCandidates(['sys-1'], [], ownsEdges, actors)).toEqual([]);
  });
});

describe('pickArchitect', () => {
  it('picks the first architect in the (sorted) member list', () => {
    const members: { userId: string; role: MemberRole }[] = [
      { userId: 'u-contrib', role: 'contributor' },
      { userId: 'u-arch', role: 'architect' },
    ];
    expect(pickArchitect(members)).toBe('u-arch');
  });

  it('returns null when there is no architect', () => {
    expect(pickArchitect([{ userId: 'u-contrib', role: 'contributor' }])).toBeNull();
  });
});

describe('deriveReviewerSet', () => {
  it('adds the architect, required, when not already among the owners', () => {
    const result = deriveReviewerSet([{ userId: 'u-biz', required: true }], 'u-arch');
    expect(result.map((r) => r.userId).sort()).toEqual(['u-arch', 'u-biz']);
    expect(result.find((r) => r.userId === 'u-arch')?.required).toBe(true);
  });

  it('does not duplicate an architect who is already an owner', () => {
    const result = deriveReviewerSet([{ userId: 'u-arch', required: true }], 'u-arch');
    expect(result).toHaveLength(1);
  });
});
