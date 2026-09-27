import { describe, expect, it } from 'vitest';
import type { CandidateEvidence, CandidateProposal, CaptureCandidate, MatchOutcome } from '../contracts/capture';
import { findBlockedCandidates } from './findBlockedCandidates';

const NONE_MATCH: MatchOutcome = { level: 'none', score: 0, similar: [], warnings: [] };

function evidence(overrides: Partial<CandidateEvidence> = {}): CandidateEvidence {
  return { sourceRef: { kind: 'sheet', sheet: 'Sheet1', range: 'B2' }, passage: '', extractor: 'sheet-mapping', attributeConfidence: {}, warnings: [], ...overrides };
}

function candidate(overrides: Partial<CaptureCandidate> & { proposal: CandidateProposal }): CaptureCandidate {
  return {
    id: `cc-${String(overrides.seq ?? 0)}`,
    orgId: 'org-1',
    jobId: 'job-1',
    modelId: 'model-1',
    seq: 0,
    kind: 'element',
    class: 'new',
    elementType: null,
    relationshipType: null,
    draftSubjectId: null,
    evidence: evidence(),
    match: NONE_MATCH,
    confidence: 0.9,
    rowKey: 'row-0',
    reimportStatus: null,
    draftDeltaIds: [],
    aliasProposals: [],
    decision: null,
    decisionDetail: null,
    decidedBy: null,
    decidedAt: null,
    promotedCommitId: null,
    promotedSubjectId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('findBlockedCandidates', () => {
  it('flags an accepted relationship whose own endpoint was rejected (the real capture-review shape this was found from)', () => {
    const rejectedCapability = candidate({ id: 'cap', seq: 9, class: 'new', elementType: 'capability', draftSubjectId: 'draft-cap', decision: 'rejected', proposal: { kind: 'element', elementType: 'capability', name: 'Customer Led Connections Solutions', parent: null, attributes: {} } });
    const acceptedRelationship = candidate({
      id: 'rel',
      seq: 12,
      kind: 'relationship',
      class: 'new',
      relationshipType: 'supports',
      decision: 'accepted',
      proposal: { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: 'from-el' }, to: { kind: 'existing', elementId: 'draft-cap' }, attributes: {} },
    });

    expect(findBlockedCandidates([rejectedCapability, acceptedRelationship])).toEqual(new Set(['rel']));
  });

  it('flags an accepted relationship whose own endpoint is still undecided, same as rejected', () => {
    const undecided = candidate({ id: 'cap', seq: 9, class: 'new', elementType: 'capability', draftSubjectId: 'draft-cap', decision: null, proposal: { kind: 'element', elementType: 'capability', name: 'Customer Led Connections Solutions', parent: null, attributes: {} } });
    const rel = candidate({
      id: 'rel',
      seq: 12,
      kind: 'relationship',
      class: 'new',
      relationshipType: 'supports',
      decision: 'accepted',
      proposal: { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: 'from-el' }, to: { kind: 'existing', elementId: 'draft-cap' }, attributes: {} },
    });

    expect(findBlockedCandidates([undecided, rel])).toEqual(new Set(['rel']));
  });

  it('does not flag a relationship whose endpoint was accepted', () => {
    const accepted = candidate({ id: 'cap', seq: 9, class: 'new', elementType: 'capability', draftSubjectId: 'draft-cap', decision: 'accepted', proposal: { kind: 'element', elementType: 'capability', name: 'Customer Led Connections Solutions', parent: null, attributes: {} } });
    const rel = candidate({
      id: 'rel',
      seq: 12,
      kind: 'relationship',
      class: 'new',
      relationshipType: 'supports',
      decision: 'accepted',
      proposal: { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: 'from-el' }, to: { kind: 'existing', elementId: 'draft-cap' }, attributes: {} },
    });

    expect(findBlockedCandidates([accepted, rel])).toEqual(new Set());
  });

  it('does not flag a relationship whose endpoint is a real element already on the target/main, not a sibling draft candidate', () => {
    const rel = candidate({
      id: 'rel',
      seq: 12,
      kind: 'relationship',
      class: 'update',
      relationshipType: 'supports',
      decision: 'accepted',
      proposal: { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: 'from-el' }, to: { kind: 'existing', elementId: 'real-main-element' }, attributes: {} },
    });

    expect(findBlockedCandidates([rel])).toEqual(new Set());
  });

  it('never flags a rejected or still-undecided candidate itself, only what depends on it', () => {
    const rejected = candidate({ id: 'cap', seq: 9, class: 'new', elementType: 'capability', draftSubjectId: 'draft-cap', decision: 'rejected', proposal: { kind: 'element', elementType: 'capability', name: 'Customer Led Connections Solutions', parent: null, attributes: {} } });
    expect(findBlockedCandidates([rejected])).toEqual(new Set());
  });

  it('flags a new container/capability whose own parent references a rejected sibling', () => {
    const rejectedPlatform = candidate({ id: 'sys', seq: 1, class: 'new', elementType: 'system', draftSubjectId: 'draft-sys', decision: 'rejected', proposal: { kind: 'element', elementType: 'system', name: 'SAP', parent: null, attributes: {} } });
    const acceptedModule = candidate({
      id: 'mod',
      seq: 2,
      class: 'new',
      elementType: 'container',
      decision: 'accepted',
      proposal: { kind: 'element', elementType: 'container', name: 'PM', parent: { kind: 'existing', elementId: 'draft-sys' }, attributes: {} },
    });

    expect(findBlockedCandidates([rejectedPlatform, acceptedModule])).toEqual(new Set(['mod']));
  });

  it('an edited or split (not just accepted) candidate is still checked for a blocked reference', () => {
    const rejected = candidate({ id: 'cap', seq: 9, class: 'new', elementType: 'capability', draftSubjectId: 'draft-cap', decision: 'rejected', proposal: { kind: 'element', elementType: 'capability', name: 'X', parent: null, attributes: {} } });
    const editedRel = candidate({
      id: 'rel',
      seq: 12,
      kind: 'relationship',
      class: 'new',
      relationshipType: 'supports',
      decision: 'edited',
      proposal: { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: 'from-el' }, to: { kind: 'existing', elementId: 'draft-cap' }, attributes: {} },
    });

    expect(findBlockedCandidates([rejected, editedRel])).toEqual(new Set(['rel']));
  });
});
