/**
 * `buildCaptureDraftEnvelope` — mirrors `convertSystemToModule.test.ts`'s own
 * shape: small, concrete fixtures folded through the real `fold()`, so a
 * passing test proves the resulting commit is actually valid per the
 * engine's own rules (C6/C7/C9), not just that this function's own return
 * value looks right.
 */
import { describe, expect, it } from 'vitest';
import type { CandidateEvidence, CandidateProposal, CaptureCandidate, MatchOutcome } from '../contracts/capture';
import type { Delta, UUID } from '../contracts/delta';
import { cloneHead, emptyHead, factMapKey, fold, type CommitContext, type Head } from '../engine/deltas';
import { buildCaptureDraftEnvelope, CaptureDraftEnvelopeError } from './buildCaptureDraftEnvelope';

const ctx: CommitContext = { authorId: 'author-1', createdAt: '2026-01-01T00:00:00.000Z' };
const MAIN_SOURCE_ID = 'main-source';
const RUN_SOURCE_ID = 'run-source';
let seq = 0;
const mintId = () => `minted-${String((seq += 1))}`;

function createElement(id: UUID, elementId: UUID, elementType: string, name: string, parentId: UUID | null = null, attributes: Record<string, unknown> = {}): Delta {
  return { kind: 'element.create', id, elementId, elementType, name, parentId, attributes, sourceId: MAIN_SOURCE_ID, confidence: 1 } as never;
}

function createRelationship(id: UUID, relationshipId: UUID, relationshipType: string, fromElementId: UUID, toElementId: UUID, attributes: Record<string, unknown> = {}): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType, fromElementId, toElementId, attributes, sourceId: MAIN_SOURCE_ID, confidence: 1 } as never;
}

function headFrom(deltas: Delta[]): Head {
  return fold(emptyHead(), deltas, ctx);
}

const SYSTEM_ATTRS = { lifecycleStatus: 'active', isExternal: false };
const NONE_MATCH: MatchOutcome = { level: 'none', score: 0, similar: [], warnings: [] };
const EXACT_MATCH = (elementId: UUID): MatchOutcome => ({ level: 'exact_id', elementId, score: 1, similar: [], warnings: [] });

function evidence(overrides: Partial<CandidateEvidence> = {}): CandidateEvidence {
  return { sourceRef: { kind: 'sheet', sheet: 'Sheet1', range: 'B2' }, passage: 'CRM | Acme', extractor: 'sheet-mapping', attributeConfidence: {}, warnings: [], ...overrides };
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

const BASE_INPUT = { commitId: 'commit-1', branchId: 'branch-1', parentCommitId: 'parent-commit-1', title: 'Capture from register.xlsx', body: null, sourceId: RUN_SOURCE_ID, effectiveDate: '2026-02-01' as string | null };

describe('buildCaptureDraftEnvelope — new candidates', () => {
  it('writes one element.create with every proposed attribute, confidence = candidate.confidence', () => {
    const mainHead = headFrom([]);
    const c = candidate({
      seq: 0,
      kind: 'element',
      class: 'new',
      elementType: 'system',
      draftSubjectId: 'sys-new',
      confidence: 0.9,
      proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: { ...SYSTEM_ATTRS, vendor: 'Acme' } },
    });

    const { envelope, draftDeltaIdsBySeq } = buildCaptureDraftEnvelope({ ...BASE_INPUT, mainHead, candidates: [c], mintId });

    expect(envelope.deltas).toEqual([expect.objectContaining({ kind: 'element.create', elementId: 'sys-new', elementType: 'system', name: 'CRM', parentId: null, attributes: { ...SYSTEM_ATTRS, vendor: 'Acme' }, sourceId: RUN_SOURCE_ID, confidence: 0.9, effectiveDate: '2026-02-01', sourceRef: 'sheet:Sheet1!B2' })]);
    expect(draftDeltaIdsBySeq.get(0)).toEqual([envelope.deltas[0]?.id]);
    expect(() => fold(cloneHead(mainHead), envelope.deltas, ctx)).not.toThrow();
  });

  it('resolves an {kind:"existing"} parent ref to a real parentId', () => {
    const mainHead = headFrom([createElement('d-sap', 'sap', 'system', 'SAP', null, SYSTEM_ATTRS)]);
    const c = candidate({ seq: 0, class: 'new', elementType: 'container', draftSubjectId: 'mod-new', proposal: { kind: 'element', elementType: 'container', name: 'PM', parent: { kind: 'existing', elementId: 'sap' }, attributes: SYSTEM_ATTRS } });
    const { envelope } = buildCaptureDraftEnvelope({ ...BASE_INPUT, mainHead, candidates: [c], mintId });
    expect(envelope.deltas[0]).toMatchObject({ parentId: 'sap' });
  });

  it('throws when a parent ref is still unresolved — the orchestrator is expected to have resolved it first', () => {
    const mainHead = headFrom([]);
    const c = candidate({ seq: 0, class: 'new', elementType: 'container', draftSubjectId: 'mod-new', proposal: { kind: 'element', elementType: 'container', name: 'PM', parent: { kind: 'unresolved', text: 'SAP' }, attributes: SYSTEM_ATTRS } });
    expect(() => buildCaptureDraftEnvelope({ ...BASE_INPUT, mainHead, candidates: [c], mintId })).toThrow(CaptureDraftEnvelopeError);
  });

  it('writes one relationship.create for a new relationship candidate', () => {
    const mainHead = headFrom([createElement('d-sys', 'sys', 'system', 'CRM', null, SYSTEM_ATTRS), createElement('d-cap', 'cap', 'capability', 'Customer Service')]);
    const c = candidate({
      seq: 0,
      kind: 'relationship',
      class: 'new',
      relationshipType: 'supports',
      draftSubjectId: 'rel-new',
      confidence: 1,
      proposal: { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: 'sys' }, to: { kind: 'existing', elementId: 'cap' }, attributes: { role: 'secondary' } },
    });
    const { envelope } = buildCaptureDraftEnvelope({ ...BASE_INPUT, mainHead, candidates: [c], mintId });
    expect(envelope.deltas).toEqual([expect.objectContaining({ kind: 'relationship.create', relationshipId: 'rel-new', fromElementId: 'sys', toElementId: 'cap', attributes: { role: 'secondary' } })]);
    expect(() => fold(cloneHead(mainHead), envelope.deltas, ctx)).not.toThrow();
  });
});

describe('buildCaptureDraftEnvelope — matched candidates (update/confirm/conflict/ambiguous)', () => {
  it("update: previousDeltaId comes from main's current fact for that exact attribute", () => {
    const mainHead = headFrom([createElement('d-sys', 'sys', 'system', 'CRM', null, { ...SYSTEM_ATTRS, vendor: 'Acme' })]);
    const priorDeltaId = mainHead.facts.get(factMapKey('sys', 'vendor'))?.deltaId;
    const c = candidate({
      seq: 0,
      class: 'update',
      elementType: 'system',
      draftSubjectId: 'sys',
      match: EXACT_MATCH('sys'),
      evidence: evidence({ attributeConfidence: { vendor: 0.95 } }),
      proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: { vendor: 'Northgate' } },
    });
    const { envelope } = buildCaptureDraftEnvelope({ ...BASE_INPUT, mainHead, candidates: [c], mintId });
    expect(envelope.deltas).toEqual([expect.objectContaining({ kind: 'element.update', elementId: 'sys', attribute: 'vendor', value: 'Northgate', previousDeltaId: priorDeltaId, confidence: 0.95 })]);
    expect(() => fold(cloneHead(mainHead), envelope.deltas, ctx)).not.toThrow();
  });

  it("falls back to the element's own existsDeltaId when the attribute has never had a fact before (first-time assertion on an existing element)", () => {
    const mainHead = headFrom([createElement('d-sys', 'sys', 'system', 'CRM', null, SYSTEM_ATTRS)]);
    expect(mainHead.facts.has(factMapKey('sys', 'vendor'))).toBe(false);
    const existsDeltaId = mainHead.elements.get('sys')?.existsDeltaId;
    const c = candidate({
      seq: 0,
      class: 'update',
      elementType: 'system',
      draftSubjectId: 'sys',
      match: EXACT_MATCH('sys'),
      evidence: evidence({ attributeConfidence: { vendor: 0.9 } }),
      proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: { vendor: 'Acme' } },
    });
    const { envelope } = buildCaptureDraftEnvelope({ ...BASE_INPUT, mainHead, candidates: [c], mintId });
    expect(envelope.deltas[0]).toMatchObject({ kind: 'element.update', attribute: 'vendor', previousDeltaId: existsDeltaId });
    expect(() => fold(cloneHead(mainHead), envelope.deltas, ctx)).not.toThrow();
  });

  it('caps a differing attribute\'s confidence at the match confidence (updateConf)', () => {
    const mainHead = headFrom([createElement('d-sys', 'sys', 'system', 'CRM', null, { ...SYSTEM_ATTRS, vendor: 'Acme' })]);
    // name_context at the identity threshold (score 0.60) -> matchConf 0.60.
    const c = candidate({
      seq: 0,
      class: 'update',
      elementType: 'system',
      draftSubjectId: 'sys',
      match: { level: 'name_context', elementId: 'sys', score: 0.6, similar: [], warnings: [] },
      evidence: evidence({ attributeConfidence: { vendor: 0.95 } }),
      proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: { vendor: 'Northgate' } },
    });
    const { envelope } = buildCaptureDraftEnvelope({ ...BASE_INPUT, mainHead, candidates: [c], mintId });
    expect(envelope.deltas[0]).toMatchObject({ confidence: 0.6 });
  });

  it('confirm: writes an update delta re-asserting the same value with this run\'s own source/provenance (K-6)', () => {
    const mainHead = headFrom([createElement('d-sys', 'sys', 'system', 'CRM', null, { ...SYSTEM_ATTRS, vendor: 'Acme' })]);
    const priorDeltaId = mainHead.facts.get(factMapKey('sys', 'vendor'))?.deltaId;
    const c = candidate({
      seq: 0,
      class: 'confirm',
      elementType: 'system',
      draftSubjectId: 'sys',
      match: EXACT_MATCH('sys'),
      evidence: evidence({ attributeConfidence: { vendor: 0.95 } }),
      proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: { vendor: 'Acme' } },
    });
    const { envelope } = buildCaptureDraftEnvelope({ ...BASE_INPUT, mainHead, candidates: [c], mintId });
    expect(envelope.deltas).toEqual([expect.objectContaining({ kind: 'element.update', attribute: 'vendor', value: 'Acme', previousDeltaId: priorDeltaId, sourceId: RUN_SOURCE_ID })]);
  });

  it('conflict: still writes the candidate\'s own proposed value (the review queue, not this module, decides whether it lands)', () => {
    const mainHead = headFrom([createElement('d-sys', 'sys', 'system', 'CRM', null, { ...SYSTEM_ATTRS, vendor: 'Acme' })]);
    const c = candidate({
      seq: 0,
      class: 'conflict',
      elementType: 'system',
      draftSubjectId: 'sys',
      match: EXACT_MATCH('sys'),
      evidence: evidence({ attributeConfidence: { vendor: 0.6 } }),
      proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: { vendor: 'Northgate' } },
    });
    const { envelope } = buildCaptureDraftEnvelope({ ...BASE_INPUT, mainHead, candidates: [c], mintId });
    expect(envelope.deltas[0]).toMatchObject({ kind: 'element.update', attribute: 'vendor', value: 'Northgate' });
  });

  it('never turns a matched candidate\'s own proposal.name into a rename delta', () => {
    const mainHead = headFrom([createElement('d-sys', 'sys', 'system', 'CRM', null, SYSTEM_ATTRS)]);
    const c = candidate({ seq: 0, class: 'confirm', elementType: 'system', draftSubjectId: 'sys', match: EXACT_MATCH('sys'), proposal: { kind: 'element', elementType: 'system', name: 'CRM (from doc)', parent: null, attributes: {} } });
    const { envelope } = buildCaptureDraftEnvelope({ ...BASE_INPUT, mainHead, candidates: [c], mintId });
    expect(envelope.deltas).toEqual([]);
  });

  it('updates a matched relationship the same way, keyed by the relationship id', () => {
    const mainHead = headFrom([createElement('d-sys', 'sys', 'system', 'CRM', null, SYSTEM_ATTRS), createElement('d-cap', 'cap', 'capability', 'Customer Service'), createRelationship('d-rel', 'rel', 'supports', 'sys', 'cap', { role: 'secondary' })]);
    const priorDeltaId = mainHead.facts.get(factMapKey('rel', 'role'))?.deltaId;
    const c = candidate({
      seq: 0,
      kind: 'relationship',
      class: 'update',
      relationshipType: 'supports',
      draftSubjectId: 'rel',
      match: EXACT_MATCH('rel'),
      evidence: evidence({ attributeConfidence: { role: 1 } }),
      proposal: { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: 'sys' }, to: { kind: 'existing', elementId: 'cap' }, attributes: { role: 'primary' } },
    });
    const { envelope } = buildCaptureDraftEnvelope({ ...BASE_INPUT, mainHead, candidates: [c], mintId });
    expect(envelope.deltas).toEqual([expect.objectContaining({ kind: 'relationship.update', relationshipId: 'rel', attribute: 'role', value: 'primary', previousDeltaId: priorDeltaId })]);
    expect(() => fold(cloneHead(mainHead), envelope.deltas, ctx)).not.toThrow();
  });

  it('throws when the matched subject cannot be found in main\'s current head', () => {
    const mainHead = headFrom([]);
    const c = candidate({ seq: 0, class: 'update', elementType: 'system', draftSubjectId: 'missing', match: EXACT_MATCH('missing'), proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: { vendor: 'Acme' } } });
    expect(() => buildCaptureDraftEnvelope({ ...BASE_INPUT, mainHead, candidates: [c], mintId })).toThrow(CaptureDraftEnvelopeError);
  });

  it('throws when a non-"new" candidate has no resolved draftSubjectId', () => {
    const mainHead = headFrom([]);
    const c = candidate({ seq: 0, class: 'update', elementType: 'system', draftSubjectId: null, proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: { vendor: 'Acme' } } });
    expect(() => buildCaptureDraftEnvelope({ ...BASE_INPUT, mainHead, candidates: [c], mintId })).toThrow(CaptureDraftEnvelopeError);
  });
});

describe('buildCaptureDraftEnvelope — gone (K-14)', () => {
  it("a system retires via element.update lifecycleStatus='retired', confidence 0.50", () => {
    const mainHead = headFrom([createElement('d-sys', 'sys', 'system', 'CRM', null, SYSTEM_ATTRS)]);
    const priorDeltaId = mainHead.facts.get(factMapKey('sys', 'lifecycleStatus'))?.deltaId;
    const c = candidate({ seq: 0, class: 'gone', elementType: 'system', draftSubjectId: 'sys', proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: {} } });
    const { envelope } = buildCaptureDraftEnvelope({ ...BASE_INPUT, mainHead, candidates: [c], mintId });
    expect(envelope.deltas).toEqual([expect.objectContaining({ kind: 'element.update', elementId: 'sys', attribute: 'lifecycleStatus', value: 'retired', previousDeltaId: priorDeltaId, confidence: 0.5 })]);
    expect(() => fold(cloneHead(mainHead), envelope.deltas, ctx)).not.toThrow();
  });

  it('a non-system element (e.g. a container) retracts outright, confidence 0.50', () => {
    const mainHead = headFrom([createElement('d-sap', 'sap', 'system', 'SAP', null, SYSTEM_ATTRS), createElement('d-mod', 'mod', 'container', 'PM', 'sap', SYSTEM_ATTRS)]);
    const existsDeltaId = mainHead.elements.get('mod')?.existsDeltaId;
    const c = candidate({ seq: 0, class: 'gone', elementType: 'container', draftSubjectId: 'mod', proposal: { kind: 'element', elementType: 'container', name: 'PM', parent: null, attributes: {} } });
    const { envelope } = buildCaptureDraftEnvelope({ ...BASE_INPUT, mainHead, candidates: [c], mintId });
    expect(envelope.deltas).toEqual([expect.objectContaining({ kind: 'element.retract', elementId: 'mod', previousDeltaId: existsDeltaId, confidence: 0.5 })]);
    expect(() => fold(cloneHead(mainHead), envelope.deltas, ctx)).not.toThrow();
  });

  it('a relationship candidate can never be class "gone"', () => {
    const mainHead = headFrom([]);
    const c = candidate({ seq: 0, kind: 'relationship', class: 'gone', relationshipType: 'supports', draftSubjectId: 'rel', proposal: { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: 'sys' }, to: { kind: 'existing', elementId: 'cap' }, attributes: { role: 'secondary' } } });
    expect(() => buildCaptureDraftEnvelope({ ...BASE_INPUT, mainHead, candidates: [c], mintId })).toThrow(CaptureDraftEnvelopeError);
  });
});

describe('buildCaptureDraftEnvelope — invalid / unsourced', () => {
  it('writes no deltas for invalid or unsourced candidates, but still records an (empty) draftDeltaIds entry', () => {
    const mainHead = headFrom([]);
    const invalid = candidate({ seq: 0, class: 'invalid', proposal: { kind: 'element', elementType: 'system', name: '', parent: null, attributes: {} } });
    const unsourced = candidate({ seq: 1, class: 'unsourced', proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: {} } });
    const { envelope, draftDeltaIdsBySeq } = buildCaptureDraftEnvelope({ ...BASE_INPUT, mainHead, candidates: [invalid, unsourced], mintId });
    expect(envelope.deltas).toEqual([]);
    expect(draftDeltaIdsBySeq.get(0)).toEqual([]);
    expect(draftDeltaIdsBySeq.get(1)).toEqual([]);
  });
});

describe('buildCaptureDraftEnvelope — envelope shape', () => {
  it('is a capture commit parented on the branch\'s own base commit, never a merge', () => {
    const mainHead = headFrom([]);
    const { envelope } = buildCaptureDraftEnvelope({ ...BASE_INPUT, mainHead, candidates: [], mintId });
    expect(envelope).toMatchObject({ id: 'commit-1', branchId: 'branch-1', parentCommitId: 'parent-commit-1', mergedBranchHeadCommitId: null, kind: 'capture', title: 'Capture from register.xlsx', body: null, deltas: [] });
  });

  it('omits effectiveDate from every delta when the job has no document date', () => {
    const mainHead = headFrom([]);
    const c = candidate({ seq: 0, class: 'new', elementType: 'system', draftSubjectId: 'sys-new', proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: SYSTEM_ATTRS } });
    const { envelope } = buildCaptureDraftEnvelope({ ...BASE_INPUT, effectiveDate: null, mainHead, candidates: [c], mintId });
    expect(envelope.deltas[0]).not.toHaveProperty('effectiveDate');
  });
});
