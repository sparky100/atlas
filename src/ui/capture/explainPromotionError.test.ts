import { describe, expect, it } from 'vitest';
import type { CandidateEvidence, CandidateProposal, CaptureCandidate, MatchOutcome } from '../../contracts/capture';
import type { ElementsHeadRow } from '../../contracts/rows';
import { BuildPromotionEnvelopeError } from '../../capture/buildPromotionEnvelope';
import { explainPromotionError } from './explainPromotionError';

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

const NO_MAIN_ELEMENTS = new Map<string, ElementsHeadRow>();
const NO_DRAFT_ELEMENTS = new Map<string, string>();

describe('explainPromotionError', () => {
  it('a relationship whose endpoint was rejected names both candidates by their own content, not seq/raw ids', () => {
    const rejectedCapability = candidate({
      seq: 9,
      class: 'new',
      elementType: 'capability',
      draftSubjectId: 'd4667dbd-723d-459f-ac47-5f4436a97fc0',
      decision: 'rejected',
      proposal: { kind: 'element', elementType: 'capability', name: 'Customer Led Connections Solutions', parent: null, attributes: {} },
    });
    const acceptedRelationship = candidate({
      seq: 12,
      kind: 'relationship',
      class: 'new',
      relationshipType: 'supports',
      draftSubjectId: 'rel-draft',
      decision: 'accepted',
      proposal: {
        kind: 'relationship',
        relationshipType: 'supports',
        from: { kind: 'existing', elementId: 'from-el' },
        to: { kind: 'existing', elementId: 'd4667dbd-723d-459f-ac47-5f4436a97fc0' },
        attributes: { role: 'secondary' },
      },
    });
    const error = new BuildPromotionEnvelopeError(12, "seq 12: to (d4667dbd-723d-459f-ac47-5f4436a97fc0) was not found on the target branch — either it wasn't promoted in this same apply call, or it no longer exists there", 'd4667dbd-723d-459f-ac47-5f4436a97fc0');
    // `useCaptureReviewQueue.ts`'s own `draftElementById` maps every element
    // candidate's own draftSubjectId to its name unconditionally — a
    // rejected candidate is still named, same as any other, so the
    // relationship's own "supports X → Y" label reads with real names too,
    // not just the "it depends on" explanation.
    const draftElementById = new Map([['d4667dbd-723d-459f-ac47-5f4436a97fc0', 'Customer Led Connections Solutions']]);

    const message = explainPromotionError(error, [rejectedCapability, acceptedRelationship], NO_MAIN_ELEMENTS, draftElementById);

    expect(message).not.toMatch(/seq \d+/);
    expect(message).not.toMatch(/d4667dbd/);
    expect(message).toContain('Customer Led Connections Solutions');
    expect(message).toContain('rejected');
    expect(message).toMatch(/supports/);
  });

  it('a relationship whose endpoint is simply undecided yet says so, not "rejected"', () => {
    const undecided = candidate({
      seq: 9,
      class: 'new',
      elementType: 'capability',
      draftSubjectId: 'cap-draft',
      decision: null,
      proposal: { kind: 'element', elementType: 'capability', name: 'Customer Led Connections Solutions', parent: null, attributes: {} },
    });
    const rel = candidate({
      seq: 12,
      kind: 'relationship',
      class: 'new',
      relationshipType: 'supports',
      decision: 'accepted',
      proposal: { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: 'from-el' }, to: { kind: 'existing', elementId: 'cap-draft' }, attributes: {} },
    });
    const error = new BuildPromotionEnvelopeError(12, 'seq 12: to (cap-draft) was not found on the target branch', 'cap-draft');

    const message = explainPromotionError(error, [undecided, rel], NO_MAIN_ELEMENTS, NO_DRAFT_ELEMENTS);

    expect(message).toContain("hasn't been decided yet");
    expect(message).not.toContain('rejected');
  });

  it('an unresolved id that matches a real target-branch element (not a draft candidate) names it and explains it may have been retracted there', () => {
    const rel = candidate({
      seq: 5,
      kind: 'relationship',
      class: 'update',
      relationshipType: 'supports',
      decision: 'accepted',
      proposal: { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: 'from-el' }, to: { kind: 'existing', elementId: 'target-el' }, attributes: {} },
    });
    const mainElementById = new Map<string, ElementsHeadRow>([['target-el', { element_id: 'target-el', element_type: 'capability', name: 'Finance', parent_id: null, attributes: {}, exists_delta_id: 'd-1' }]]);
    const error = new BuildPromotionEnvelopeError(5, 'seq 5: matched element target-el was not found on the target branch (TARGET_RETRACTED)', 'target-el');

    const message = explainPromotionError(error, [rel], mainElementById, NO_DRAFT_ELEMENTS);

    expect(message).toContain('Finance');
    expect(message).toContain('retracted');
    expect(message).not.toContain('target-el');
  });

  it('falls back to the offending candidate\'s own name plus the raw message when the unresolved id resolves nowhere at all', () => {
    const rel = candidate({
      seq: 5,
      kind: 'relationship',
      class: 'update',
      relationshipType: 'supports',
      decision: 'accepted',
      proposal: { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: 'from-el' }, to: { kind: 'existing', elementId: 'ghost-id' }, attributes: {} },
    });
    const error = new BuildPromotionEnvelopeError(5, 'seq 5: matched element ghost-id was not found on the target branch (TARGET_RETRACTED)', 'ghost-id');

    const message = explainPromotionError(error, [rel], NO_MAIN_ELEMENTS, NO_DRAFT_ELEMENTS);

    expect(message).toContain('supports');
    expect(message).toContain('matched element ghost-id was not found on the target branch (TARGET_RETRACTED)');
    expect(message).not.toMatch(/seq 5/);
  });

  it('an error with no unresolvedRefId at all still names the offending candidate rather than just its seq', () => {
    const el = candidate({ seq: 3, class: 'new', elementType: 'system', decision: 'edited', proposal: { kind: 'element', elementType: 'system', name: 'Legacy CRM', parent: null, attributes: {} } });
    const error = new BuildPromotionEnvelopeError(3, "seq 3: 'edited' needs decisionDetail.attributes");

    const message = explainPromotionError(error, [el], NO_MAIN_ELEMENTS, NO_DRAFT_ELEMENTS);

    expect(message).toContain('Legacy CRM');
    expect(message).not.toMatch(/seq 3/);
    expect(message).toContain("'edited' needs decisionDetail.attributes");
  });

  it('falls back to "row {seq}" only when the offending candidate itself cannot be found at all (defensive, should not happen in practice)', () => {
    const error = new BuildPromotionEnvelopeError(99, 'seq 99: internal — no promoted subject id');
    const message = explainPromotionError(error, [], NO_MAIN_ELEMENTS, NO_DRAFT_ELEMENTS);
    expect(message).toContain('row 99');
  });
});
