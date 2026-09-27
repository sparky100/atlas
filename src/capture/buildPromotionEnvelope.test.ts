/**
 * `buildPromotionEnvelope` — mirrors `buildCaptureDraftEnvelope.test.ts`'s
 * own shape: small, concrete fixtures folded through the real `fold()`, so
 * a passing test proves the resulting commit is actually valid per the
 * engine's own rules, not just that this function's own return value
 * looks right.
 */
import { describe, expect, it } from 'vitest';
import type { CandidateEvidence, CandidateProposal, CaptureCandidate, MatchOutcome } from '../contracts/capture';
import type { Delta, UUID } from '../contracts/delta';
import { cloneHead, emptyHead, factMapKey, fold, type CommitContext, type Head } from '../engine/deltas';
import { buildPromotionEnvelope, BuildPromotionEnvelopeError } from './buildPromotionEnvelope';

const ctx: CommitContext = { authorId: 'author-1', createdAt: '2026-01-01T00:00:00.000Z' };
const DRAFT_SOURCE_ID = 'draft-source';
const TARGET_SOURCE_ID = 'target-source';
const REVIEWER_SOURCE_ID = 'reviewer-source';
let seq = 0;
const mintId = () => `minted-${String((seq += 1))}`;

function createElement(id: UUID, elementId: UUID, elementType: string, name: string, parentId: UUID | null = null, attributes: Record<string, unknown> = {}, sourceId = TARGET_SOURCE_ID): Delta {
  return { kind: 'element.create', id, elementId, elementType, name, parentId, attributes, sourceId, confidence: 1 } as never;
}

function createRelationship(id: UUID, relationshipId: UUID, relationshipType: string, fromElementId: UUID, toElementId: UUID, attributes: Record<string, unknown> = {}, sourceId = TARGET_SOURCE_ID): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType, fromElementId, toElementId, attributes, sourceId, confidence: 1 } as never;
}

function headFrom(deltas: Delta[]): Head {
  return fold(emptyHead(), deltas, ctx);
}

const SYSTEM_ATTRS = { lifecycleStatus: 'active', isExternal: false };
const NONE_MATCH: MatchOutcome = { level: 'none', score: 0, similar: [], warnings: [] };
const EXACT_MATCH = (elementId: UUID): MatchOutcome => ({ level: 'exact_id', elementId, score: 1, similar: [], warnings: [] });
const NAME_CONTEXT_MATCH = (elementId: UUID, score = 0.8): MatchOutcome => ({ level: 'name_context', elementId, score, similar: [], warnings: [] });

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

describe('buildPromotionEnvelope — accepted on new', () => {
  it('mints a fresh id and carries the draft\'s own provenance verbatim', () => {
    const draftHead = headFrom([createElement('draft-create-1', 'draft-sys', 'system', 'CRM', null, { ...SYSTEM_ATTRS, vendor: 'Acme' }, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([]);
    const c = candidate({ seq: 0, class: 'new', elementType: 'system', draftSubjectId: 'draft-sys', decision: 'accepted', proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: { ...SYSTEM_ATTRS, vendor: 'Acme' } } });

    const { deltas, promotedSubjectIdBySeq } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });

    const promotedId = promotedSubjectIdBySeq.get(0);
    expect(promotedId).toBeDefined();
    expect(promotedId).not.toBe('draft-sys');
    expect(deltas).toEqual([expect.objectContaining({ kind: 'element.create', elementId: promotedId, name: 'CRM', attributes: { ...SYSTEM_ATTRS, vendor: 'Acme' }, sourceId: DRAFT_SOURCE_ID, confidence: 1 })]);
    expect(() => fold(cloneHead(targetHead), deltas, ctx)).not.toThrow();
  });

  it('re-points a container\'s parent to a co-promoted system\'s fresh id', () => {
    const draftHead = headFrom([createElement('draft-create-sap', 'draft-sap', 'system', 'SAP', null, SYSTEM_ATTRS, DRAFT_SOURCE_ID), createElement('draft-create-mod', 'draft-mod', 'container', 'PM', 'draft-sap', SYSTEM_ATTRS, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([]);
    const sap = candidate({ seq: 0, class: 'new', elementType: 'system', draftSubjectId: 'draft-sap', decision: 'accepted', proposal: { kind: 'element', elementType: 'system', name: 'SAP', parent: null, attributes: SYSTEM_ATTRS } });
    const mod = candidate({ seq: 1, class: 'new', elementType: 'container', draftSubjectId: 'draft-mod', decision: 'accepted', proposal: { kind: 'element', elementType: 'container', name: 'PM', parent: { kind: 'existing', elementId: 'draft-sap' }, attributes: SYSTEM_ATTRS } });

    const { deltas, promotedSubjectIdBySeq } = buildPromotionEnvelope({ candidates: [sap, mod], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    const sapId = promotedSubjectIdBySeq.get(0);
    expect(deltas.find((d) => d.kind === 'element.create' && d.name === 'PM')).toMatchObject({ parentId: sapId });
    expect(() => fold(cloneHead(targetHead), deltas, ctx)).not.toThrow();
  });

  it('resolves a parent that already exists on the target unchanged', () => {
    const draftHead = headFrom([createElement('draft-create', 'draft-mod', 'container', 'PM', 'sap', SYSTEM_ATTRS, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([createElement('target-sap', 'sap', 'system', 'SAP', null, SYSTEM_ATTRS)]);
    const c = candidate({ seq: 0, class: 'new', elementType: 'container', draftSubjectId: 'draft-mod', decision: 'accepted', proposal: { kind: 'element', elementType: 'container', name: 'PM', parent: { kind: 'existing', elementId: 'sap' }, attributes: SYSTEM_ATTRS } });
    const { deltas } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    expect(deltas[0]).toMatchObject({ parentId: 'sap' });
  });
});

describe('buildPromotionEnvelope — accepted on update/confirm/conflict', () => {
  it("previousDeltaId is re-derived against the TARGET's current fact, not the draft's", () => {
    const draftHead = headFrom([createElement('draft-create', 'sys', 'system', 'CRM', null, { ...SYSTEM_ATTRS, vendor: 'Northgate' }, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([createElement('target-create', 'sys', 'system', 'CRM', null, { ...SYSTEM_ATTRS, vendor: 'Acme' })]);
    const targetPriorDeltaId = targetHead.facts.get(factMapKey('sys', 'vendor'))?.deltaId;
    const c = candidate({ seq: 0, class: 'update', elementType: 'system', draftSubjectId: 'sys', match: EXACT_MATCH('sys'), decision: 'accepted', proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: { vendor: 'Northgate' } } });

    const { deltas } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    expect(deltas).toEqual([expect.objectContaining({ kind: 'element.update', elementId: 'sys', attribute: 'vendor', value: 'Northgate', previousDeltaId: targetPriorDeltaId, sourceId: DRAFT_SOURCE_ID })]);
    expect(() => fold(cloneHead(targetHead), deltas, ctx)).not.toThrow();
  });

  it('falls back to existsDeltaId when the target has never had a fact for this attribute', () => {
    const draftHead = headFrom([createElement('draft-create', 'sys', 'system', 'CRM', null, { ...SYSTEM_ATTRS, vendor: 'Acme' }, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([createElement('target-create', 'sys', 'system', 'CRM', null, SYSTEM_ATTRS)]);
    const targetExistsDeltaId = targetHead.elements.get('sys')?.existsDeltaId;
    const c = candidate({ seq: 0, class: 'update', elementType: 'system', draftSubjectId: 'sys', match: EXACT_MATCH('sys'), decision: 'accepted', proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: { vendor: 'Acme' } } });
    const { deltas } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    expect(deltas[0]).toMatchObject({ previousDeltaId: targetExistsDeltaId });
  });

  it('writes a name alias for a promoted name_context match', () => {
    const draftHead = headFrom([createElement('draft-create', 'sys', 'system', 'CRM', null, { ...SYSTEM_ATTRS, vendor: 'Acme' }, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([createElement('target-create', 'sys', 'system', 'CRM', null, SYSTEM_ATTRS)]);
    const c = candidate({ seq: 0, class: 'update', elementType: 'system', draftSubjectId: 'sys', match: NAME_CONTEXT_MATCH('sys', 0.8), decision: 'accepted', proposal: { kind: 'element', elementType: 'system', name: 'CRM (legacy)', parent: null, attributes: { vendor: 'Acme' } } });
    const { aliasRows } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    expect(aliasRows).toEqual([expect.objectContaining({ elementId: 'sys', aliasValue: 'CRM (legacy)', aliasType: 'name', sourceId: DRAFT_SOURCE_ID })]);
  });

  it('throws TARGET_RETRACTED when the matched element no longer exists on the target', () => {
    const draftHead = headFrom([createElement('draft-create', 'sys', 'system', 'CRM', null, SYSTEM_ATTRS, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([]);
    const c = candidate({ seq: 0, class: 'update', elementType: 'system', draftSubjectId: 'sys', match: EXACT_MATCH('sys'), decision: 'accepted', proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: { vendor: 'Acme' } } });
    expect(() => buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId })).toThrow(/TARGET_RETRACTED/);
  });
});

describe('buildPromotionEnvelope — ambiguous', () => {
  it('accepted with a chosen target behaves exactly like update', () => {
    const draftHead = headFrom([createElement('draft-create', 'draft-guess', 'system', 'Tenants Portal', null, { ...SYSTEM_ATTRS, vendor: 'Acme' }, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([createElement('target-create', 'sys-chosen', 'system', 'Tenants Portal', null, SYSTEM_ATTRS)]);
    const c = candidate({ seq: 0, class: 'ambiguous', elementType: 'system', draftSubjectId: 'draft-guess', match: { level: 'name_context', elementId: 'draft-guess', score: 0.65, ambiguous: [], similar: [], warnings: [] }, decision: 'accepted', decisionDetail: { intoElementId: 'sys-chosen' }, proposal: { kind: 'element', elementType: 'system', name: 'Tenants Portal', parent: null, attributes: { vendor: 'Acme' } } });
    const { deltas, promotedSubjectIdBySeq } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    expect(promotedSubjectIdBySeq.get(0)).toBe('sys-chosen');
    expect(deltas).toEqual([expect.objectContaining({ kind: 'element.update', elementId: 'sys-chosen', attribute: 'vendor', value: 'Acme' })]);
  });

  it('accepted with no chosen target ("none of these") mints a fresh id like new', () => {
    const draftHead = headFrom([createElement('draft-create', 'draft-guess', 'system', 'Tenants Portal', null, { ...SYSTEM_ATTRS, vendor: 'Acme' }, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([createElement('target-create', 'sys-other', 'system', 'Tenants Portal', null, SYSTEM_ATTRS)]);
    const c = candidate({ seq: 0, class: 'ambiguous', elementType: 'system', draftSubjectId: 'draft-guess', match: { level: 'name_context', elementId: 'draft-guess', score: 0.65, ambiguous: [], similar: [], warnings: [] }, decision: 'accepted', decisionDetail: null, proposal: { kind: 'element', elementType: 'system', name: 'Tenants Portal', parent: null, attributes: { ...SYSTEM_ATTRS, vendor: 'Acme' } } });
    const { deltas, promotedSubjectIdBySeq } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    const promotedId = promotedSubjectIdBySeq.get(0);
    expect(promotedId).not.toBe('sys-other');
    expect(deltas).toEqual([expect.objectContaining({ kind: 'element.create', elementId: promotedId })]);
  });
});

describe('buildPromotionEnvelope — gone', () => {
  it('accepted on a system: lifecycleStatus update, confidence 0.50, provenance from the draft', () => {
    const draftHead = headFrom([createElement('draft-retire', 'sys', 'system', 'CRM', null, SYSTEM_ATTRS, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([createElement('target-create', 'sys', 'system', 'CRM', null, SYSTEM_ATTRS)]);
    const targetExistsDeltaId = targetHead.elements.get('sys')?.existsDeltaId;
    const c = candidate({ seq: 0, class: 'gone', elementType: 'system', draftSubjectId: 'sys', decision: 'accepted', proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: {} } });
    const { deltas } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    expect(deltas).toEqual([expect.objectContaining({ kind: 'element.update', elementId: 'sys', attribute: 'lifecycleStatus', value: 'retired', previousDeltaId: targetExistsDeltaId, confidence: 0.5, sourceId: DRAFT_SOURCE_ID })]);
  });

  it('accepted on a container: retract, confidence 0.50', () => {
    const draftHead = headFrom([createElement('draft-retract', 'mod', 'container', 'PM', 'sap', SYSTEM_ATTRS, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([createElement('target-sap', 'sap', 'system', 'SAP', null, SYSTEM_ATTRS), createElement('target-mod', 'mod', 'container', 'PM', 'sap', SYSTEM_ATTRS)]);
    const c = candidate({ seq: 0, class: 'gone', elementType: 'container', draftSubjectId: 'mod', decision: 'accepted', proposal: { kind: 'element', elementType: 'container', name: 'PM', parent: null, attributes: {} } });
    const { deltas } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    expect(deltas).toEqual([expect.objectContaining({ kind: 'element.retract', elementId: 'mod', confidence: 0.5 })]);
    expect(() => fold(cloneHead(targetHead), deltas, ctx)).not.toThrow();
  });

  it('edited replaces the retirement with any attribute the reviewer chose (e.g. plannedEnd), confidence 1.0', () => {
    const draftHead = headFrom([createElement('draft-retire', 'sys', 'system', 'CRM', null, SYSTEM_ATTRS, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([createElement('target-create', 'sys', 'system', 'CRM', null, SYSTEM_ATTRS)]);
    const c = candidate({ seq: 0, class: 'gone', elementType: 'system', draftSubjectId: 'sys', decision: 'edited', decisionDetail: { attributes: { plannedEnd: '2027-06-01' } }, proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: {} } });
    const { deltas, resolvedConflicts } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    expect(deltas).toEqual([expect.objectContaining({ kind: 'element.update', elementId: 'sys', attribute: 'plannedEnd', value: '2027-06-01', sourceId: REVIEWER_SOURCE_ID, confidence: 1 })]);
    expect(resolvedConflicts).toHaveLength(1);
  });
});

describe('buildPromotionEnvelope — merged', () => {
  it("becomes updates against the chosen element for differing attributes only, plus a name alias", () => {
    const draftHead = headFrom([createElement('draft-create', 'draft-crm', 'system', 'CRM (dup)', null, { ...SYSTEM_ATTRS, vendor: 'Acme', criticality: 'high' }, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([createElement('target-create', 'real-crm', 'system', 'CRM', null, { ...SYSTEM_ATTRS, vendor: 'Acme' })]);
    const existsDeltaId = targetHead.elements.get('real-crm')?.existsDeltaId;
    const c = candidate({ seq: 0, class: 'new', elementType: 'system', draftSubjectId: 'draft-crm', decision: 'merged', decisionDetail: { intoElementId: 'real-crm' }, proposal: { kind: 'element', elementType: 'system', name: 'CRM (dup)', parent: null, attributes: { ...SYSTEM_ATTRS, vendor: 'Acme', criticality: 'high' } } });

    const { deltas, aliasRows, promotedSubjectIdBySeq } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    expect(promotedSubjectIdBySeq.get(0)).toBe('real-crm');
    // vendor/lifecycleStatus/isExternal already match main — only criticality (new) differs.
    expect(deltas).toEqual([expect.objectContaining({ kind: 'element.update', elementId: 'real-crm', attribute: 'criticality', value: 'high', previousDeltaId: existsDeltaId })]);
    expect(aliasRows).toEqual([expect.objectContaining({ elementId: 'real-crm', aliasValue: 'CRM (dup)', aliasType: 'name', confidence: 1 })]);
    expect(() => fold(cloneHead(targetHead), deltas, ctx)).not.toThrow();
  });

  it('re-points a relationship candidate that referenced the merged draft id onto the chosen element', () => {
    const draftHead = headFrom([createElement('draft-create-crm', 'draft-crm', 'system', 'CRM (dup)', null, SYSTEM_ATTRS, DRAFT_SOURCE_ID), createElement('draft-create-cap', 'cap', 'capability', 'Customer Service', null, {}, DRAFT_SOURCE_ID), createRelationship('draft-rel', 'draft-rel-id', 'supports', 'draft-crm', 'cap', { role: 'secondary' }, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([createElement('target-create', 'real-crm', 'system', 'CRM', null, SYSTEM_ATTRS), createElement('target-cap', 'cap', 'capability', 'Customer Service')]);
    const merged = candidate({ seq: 0, class: 'new', elementType: 'system', draftSubjectId: 'draft-crm', decision: 'merged', decisionDetail: { intoElementId: 'real-crm' }, proposal: { kind: 'element', elementType: 'system', name: 'CRM (dup)', parent: null, attributes: SYSTEM_ATTRS } });
    const rel = candidate({ seq: 1, kind: 'relationship', class: 'new', relationshipType: 'supports', draftSubjectId: 'draft-rel-id', decision: 'accepted', proposal: { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: 'draft-crm' }, to: { kind: 'existing', elementId: 'cap' }, attributes: { role: 'secondary' } } });

    const { deltas } = buildPromotionEnvelope({ candidates: [merged, rel], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    expect(deltas.find((d) => d.kind === 'relationship.create')).toMatchObject({ fromElementId: 'real-crm', toElementId: 'cap' });
    expect(() => fold(cloneHead(targetHead), deltas, ctx)).not.toThrow();
  });
});

describe('buildPromotionEnvelope — edited', () => {
  it('on new: full replacement attributes, reviewer provenance, one resolved_conflicts row against the draft create', () => {
    const draftHead = headFrom([createElement('draft-create', 'draft-sys', 'system', 'CRM', null, { ...SYSTEM_ATTRS, vendor: 'Acme' }, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([]);
    const c = candidate({ seq: 0, class: 'new', elementType: 'system', draftSubjectId: 'draft-sys', decision: 'edited', decisionDetail: { attributes: { ...SYSTEM_ATTRS, vendor: 'Northgate' } }, proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: { ...SYSTEM_ATTRS, vendor: 'Acme' } } });
    const { deltas, resolvedConflicts } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    expect(deltas).toEqual([expect.objectContaining({ kind: 'element.create', attributes: { ...SYSTEM_ATTRS, vendor: 'Northgate' }, sourceId: REVIEWER_SOURCE_ID, confidence: 1 })]);
    expect(resolvedConflicts).toEqual([expect.objectContaining({ winningDeltaId: deltas[0]?.id, discardedDeltaId: 'draft-create' })]);
  });

  it('on update: one resolved_conflicts row per edited attribute', () => {
    const draftHead = headFrom([createElement('draft-create', 'sys', 'system', 'CRM', null, { ...SYSTEM_ATTRS, vendor: 'Acme' }, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([createElement('target-create', 'sys', 'system', 'CRM', null, SYSTEM_ATTRS)]);
    const c = candidate({ seq: 0, class: 'update', elementType: 'system', draftSubjectId: 'sys', match: EXACT_MATCH('sys'), decision: 'edited', decisionDetail: { attributes: { vendor: 'Something Else' } }, proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: { vendor: 'Acme' } } });
    const { deltas, resolvedConflicts } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    expect(deltas).toEqual([expect.objectContaining({ attribute: 'vendor', value: 'Something Else', sourceId: REVIEWER_SOURCE_ID, confidence: 1 })]);
    expect(resolvedConflicts).toEqual([expect.objectContaining({ winningDeltaId: deltas[0]?.id, discardedDeltaId: 'draft-create' })]);
  });

  it('on invalid/unsourced throws — needs re-grounding (PR11), not yet supported', () => {
    const draftHead = headFrom([]);
    const targetHead = headFrom([]);
    const c = candidate({ seq: 0, class: 'invalid', decision: 'edited', decisionDetail: { attributes: {} }, proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: {} } });
    expect(() => buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId })).toThrow(BuildPromotionEnvelopeError);
  });
});

describe('buildPromotionEnvelope — split', () => {
  it('on new: only acceptedAttributes are included in the create', () => {
    const draftHead = headFrom([createElement('draft-create', 'draft-sys', 'system', 'CRM', null, { ...SYSTEM_ATTRS, vendor: 'Acme', criticality: 'high' }, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([]);
    const c = candidate({ seq: 0, class: 'new', elementType: 'system', draftSubjectId: 'draft-sys', decision: 'split', decisionDetail: { acceptedAttributes: ['lifecycleStatus', 'isExternal'] }, proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: { ...SYSTEM_ATTRS, vendor: 'Acme', criticality: 'high' } } });
    const { deltas } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    expect(deltas[0]).toMatchObject({ attributes: SYSTEM_ATTRS });
  });

  it('on update: only acceptedAttributes get update deltas', () => {
    const draftHead = headFrom([createElement('draft-create', 'sys', 'system', 'CRM', null, { vendor: 'Acme', criticality: 'high' }, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([createElement('target-create', 'sys', 'system', 'CRM', null, SYSTEM_ATTRS)]);
    const c = candidate({ seq: 0, class: 'update', elementType: 'system', draftSubjectId: 'sys', match: EXACT_MATCH('sys'), decision: 'split', decisionDetail: { acceptedAttributes: ['vendor'] }, proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: { vendor: 'Acme', criticality: 'high' } } });
    const { deltas } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ attribute: 'vendor' });
  });
});

describe('buildPromotionEnvelope — rejected', () => {
  it('produces no deltas and no promoted subject id', () => {
    const draftHead = headFrom([createElement('draft-create', 'draft-sys', 'system', 'CRM', null, SYSTEM_ATTRS, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([]);
    const c = candidate({ seq: 0, class: 'new', elementType: 'system', draftSubjectId: 'draft-sys', decision: 'rejected', proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: SYSTEM_ATTRS } });
    const { deltas, promotedSubjectIdBySeq } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    expect(deltas).toEqual([]);
    expect(promotedSubjectIdBySeq.has(0)).toBe(false);
  });

  it('a relationship referencing a rejected new endpoint throws rather than building an orphaned edge', () => {
    const draftHead = headFrom([createElement('draft-create-crm', 'draft-crm', 'system', 'CRM', null, SYSTEM_ATTRS, DRAFT_SOURCE_ID), createElement('draft-create-cap', 'cap', 'capability', 'Customer Service', null, {}, DRAFT_SOURCE_ID), createRelationship('draft-rel', 'draft-rel-id', 'supports', 'draft-crm', 'cap', { role: 'secondary' }, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([createElement('target-cap', 'cap', 'capability', 'Customer Service')]);
    const rejectedNew = candidate({ seq: 0, class: 'new', elementType: 'system', draftSubjectId: 'draft-crm', decision: 'rejected', proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: SYSTEM_ATTRS } });
    const rel = candidate({ seq: 1, kind: 'relationship', class: 'new', relationshipType: 'supports', draftSubjectId: 'draft-rel-id', decision: 'accepted', proposal: { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: 'draft-crm' }, to: { kind: 'existing', elementId: 'cap' }, attributes: { role: 'secondary' } } });
    expect(() => buildPromotionEnvelope({ candidates: [rejectedNew, rel], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId })).toThrow(BuildPromotionEnvelopeError);
    // The offending candidate's own seq, and the specific draft id its own
    // endpoint couldn't resolve — what `explainPromotionError.ts` needs to
    // name the rejected candidate by name instead of a raw id (real capture
    // review this shape was found from: "seq 12: to (d4667dbd-…) was not
    // found on the target branch," with no way to connect that id to
    // anything visible in the review UI).
    try {
      buildPromotionEnvelope({ candidates: [rejectedNew, rel], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
      expect.unreachable('expected buildPromotionEnvelope to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BuildPromotionEnvelopeError);
      const err = e as BuildPromotionEnvelopeError;
      expect(err.seq).toBe(1);
      expect(err.unresolvedRefId).toBe('draft-crm');
    }
  });
});

describe('buildPromotionEnvelope — relationships', () => {
  it('new relationship: minted id, endpoints resolved against the target, provenance from the draft', () => {
    const draftHead = headFrom([createElement('draft-create-sys', 'sys', 'system', 'CRM', null, SYSTEM_ATTRS, DRAFT_SOURCE_ID), createElement('draft-create-cap', 'cap', 'capability', 'Customer Service', null, {}, DRAFT_SOURCE_ID), createRelationship('draft-rel', 'draft-rel-id', 'supports', 'sys', 'cap', { role: 'secondary' }, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([createElement('target-sys', 'sys', 'system', 'CRM', null, SYSTEM_ATTRS), createElement('target-cap', 'cap', 'capability', 'Customer Service')]);
    const c = candidate({ seq: 0, kind: 'relationship', class: 'new', relationshipType: 'supports', draftSubjectId: 'draft-rel-id', decision: 'accepted', proposal: { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: 'sys' }, to: { kind: 'existing', elementId: 'cap' }, attributes: { role: 'secondary' } } });
    const { deltas } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    expect(deltas).toEqual([expect.objectContaining({ kind: 'relationship.create', fromElementId: 'sys', toElementId: 'cap', attributes: { role: 'secondary' }, sourceId: DRAFT_SOURCE_ID })]);
    expect(() => fold(cloneHead(targetHead), deltas, ctx)).not.toThrow();
  });

  it('matched relationship: update re-derived against the target', () => {
    const draftHead = headFrom([createElement('draft-sys', 'sys', 'system', 'CRM', null, SYSTEM_ATTRS, DRAFT_SOURCE_ID), createElement('draft-cap', 'cap', 'capability', 'Customer Service', null, {}, DRAFT_SOURCE_ID), createRelationship('draft-rel', 'rel', 'supports', 'sys', 'cap', { role: 'primary' }, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([createElement('target-sys', 'sys', 'system', 'CRM', null, SYSTEM_ATTRS), createElement('target-cap', 'cap', 'capability', 'Customer Service'), createRelationship('target-rel', 'rel', 'supports', 'sys', 'cap', { role: 'secondary' })]);
    const targetPriorDeltaId = targetHead.facts.get(factMapKey('rel', 'role'))?.deltaId;
    const c = candidate({ seq: 0, kind: 'relationship', class: 'update', relationshipType: 'supports', draftSubjectId: 'rel', decision: 'accepted', proposal: { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: 'sys' }, to: { kind: 'existing', elementId: 'cap' }, attributes: { role: 'primary' } } });
    const { deltas } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });
    expect(deltas).toEqual([expect.objectContaining({ kind: 'relationship.update', relationshipId: 'rel', attribute: 'role', value: 'primary', previousDeltaId: targetPriorDeltaId })]);
  });

  it('a relationship candidate can never be class "gone"', () => {
    const draftHead = headFrom([]);
    const targetHead = headFrom([]);
    const c = candidate({ seq: 0, kind: 'relationship', class: 'gone', relationshipType: 'supports', draftSubjectId: 'rel', decision: 'accepted', proposal: { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: 'sys' }, to: { kind: 'existing', elementId: 'cap' }, attributes: { role: 'secondary' } } });
    expect(() => buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId })).toThrow(BuildPromotionEnvelopeError);
  });

  it('"merged" never applies to a relationship candidate', () => {
    const draftHead = headFrom([]);
    const targetHead = headFrom([]);
    const c = candidate({ seq: 0, kind: 'relationship', class: 'new', relationshipType: 'supports', draftSubjectId: 'rel', decision: 'merged', decisionDetail: { intoElementId: 'x' }, proposal: { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: 'sys' }, to: { kind: 'existing', elementId: 'cap' }, attributes: { role: 'secondary' } } });
    expect(() => buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId })).toThrow(BuildPromotionEnvelopeError);
  });
});

describe('buildPromotionEnvelope — replaces (Sprint F2b Step 4, SPEC-capture.md §5.6)', () => {
  it('accepted as new: transfers the retiring element\'s own live supports edges to the replacement, role secondary, description carried over', () => {
    const draftHead = headFrom([createElement('draft-old', 'old-crm', 'system', 'Legacy CRM', null, SYSTEM_ATTRS, DRAFT_SOURCE_ID), createElement('draft-new', 'new-crm', 'system', 'New CRM', null, SYSTEM_ATTRS, DRAFT_SOURCE_ID), createRelationship('draft-replaces', 'draft-replaces-id', 'replaces', 'new-crm', 'old-crm', {}, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([
      createElement('target-old', 'old-crm', 'system', 'Legacy CRM', null, SYSTEM_ATTRS),
      createElement('target-new', 'new-crm', 'system', 'New CRM', null, SYSTEM_ATTRS),
      createElement('target-cap', 'cap', 'capability', 'Customer Service'),
      createRelationship('target-supports', 'supports-id', 'supports', 'old-crm', 'cap', { role: 'primary', description: 'handles enquiries' }),
    ]);
    const c = candidate({ seq: 0, kind: 'relationship', class: 'new', relationshipType: 'replaces', draftSubjectId: 'draft-replaces-id', decision: 'accepted', proposal: { kind: 'relationship', relationshipType: 'replaces', from: { kind: 'existing', elementId: 'new-crm' }, to: { kind: 'existing', elementId: 'old-crm' }, attributes: {} } });

    const { deltas } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });

    expect(deltas.find((d) => d.kind === 'relationship.create' && 'relationshipType' in d && d.relationshipType === 'replaces')).toMatchObject({ fromElementId: 'new-crm', toElementId: 'old-crm' });
    expect(deltas.find((d) => d.kind === 'relationship.retract')).toMatchObject({ relationshipId: 'supports-id' });
    const transferred = deltas.find((d) => d.kind === 'relationship.create' && 'relationshipType' in d && d.relationshipType === 'supports');
    expect(transferred).toMatchObject({ fromElementId: 'new-crm', toElementId: 'cap', attributes: { role: 'secondary', description: 'handles enquiries' } });
    expect(() => fold(cloneHead(targetHead), deltas, ctx)).not.toThrow();
  });

  it('never transfers a supports edge belonging to a different element', () => {
    const draftHead = headFrom([createElement('draft-old', 'old-crm', 'system', 'Legacy CRM', null, SYSTEM_ATTRS, DRAFT_SOURCE_ID), createElement('draft-new', 'new-crm', 'system', 'New CRM', null, SYSTEM_ATTRS, DRAFT_SOURCE_ID), createRelationship('draft-replaces', 'draft-replaces-id', 'replaces', 'new-crm', 'old-crm', {}, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([
      createElement('target-old', 'old-crm', 'system', 'Legacy CRM', null, SYSTEM_ATTRS),
      createElement('target-new', 'new-crm', 'system', 'New CRM', null, SYSTEM_ATTRS),
      createElement('target-other', 'other', 'system', 'Unrelated System', null, SYSTEM_ATTRS),
      createElement('target-cap', 'cap', 'capability', 'Customer Service'),
      createRelationship('target-supports', 'supports-id', 'supports', 'other', 'cap', { role: 'primary' }),
    ]);
    const c = candidate({ seq: 0, kind: 'relationship', class: 'new', relationshipType: 'replaces', draftSubjectId: 'draft-replaces-id', decision: 'accepted', proposal: { kind: 'relationship', relationshipType: 'replaces', from: { kind: 'existing', elementId: 'new-crm' }, to: { kind: 'existing', elementId: 'old-crm' }, attributes: {} } });

    const { deltas } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });

    expect(deltas.filter((d) => d.kind === 'relationship.retract')).toHaveLength(0);
    expect(deltas.filter((d) => d.kind === 'relationship.create')).toHaveLength(1); // the `replaces` edge itself only.
  });

  it('carries no transfer at all when the retiring element has no live supports edges', () => {
    const draftHead = headFrom([createElement('draft-old', 'old-crm', 'system', 'Legacy CRM', null, SYSTEM_ATTRS, DRAFT_SOURCE_ID), createElement('draft-new', 'new-crm', 'system', 'New CRM', null, SYSTEM_ATTRS, DRAFT_SOURCE_ID), createRelationship('draft-replaces', 'draft-replaces-id', 'replaces', 'new-crm', 'old-crm', {}, DRAFT_SOURCE_ID)]);
    const targetHead = headFrom([createElement('target-old', 'old-crm', 'system', 'Legacy CRM', null, SYSTEM_ATTRS), createElement('target-new', 'new-crm', 'system', 'New CRM', null, SYSTEM_ATTRS)]);
    const c = candidate({ seq: 0, kind: 'relationship', class: 'new', relationshipType: 'replaces', draftSubjectId: 'draft-replaces-id', decision: 'accepted', proposal: { kind: 'relationship', relationshipType: 'replaces', from: { kind: 'existing', elementId: 'new-crm' }, to: { kind: 'existing', elementId: 'old-crm' }, attributes: {} } });

    const { deltas } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });

    expect(deltas).toHaveLength(1); // the `replaces` edge itself only.
    expect(() => fold(cloneHead(targetHead), deltas, ctx)).not.toThrow();
  });
});
