/**
 * RT-K1 (SPEC-capture.md §13): arbitrary `CaptureCandidate`/`CaptureJob` →
 * JSON → deep-equal, and → row → deep-equal. Proposal/evidence/match
 * generators use one representative element type (`system`) and
 * relationship type (`uses`) rather than every type in `ElementAttributesByType`/
 * `RelationshipAttributesByType` — that per-type attribute shape is already
 * exhaustively covered by `delta.property.test.ts`; this file's own job is
 * proving the row↔wire conversion functions are faithful, not re-deriving
 * every attribute schema.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  captureCandidateRowToWire,
  captureCandidateWireToRow,
  captureJobRowToWire,
  captureJobWireToRow,
  type CandidateEvidence,
  type CandidateProposal,
  type CaptureCandidate,
  type CaptureJob,
  type MatchOutcome,
} from './capture';
import type { SourceRef } from './sourceRef';

const uuid = fc.uuid();
const isoDateTime = fc.date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-01-01T00:00:00Z'), noInvalidDate: true }).map((d) => d.toISOString());
const isoDate = fc.date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-01-01T00:00:00Z'), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10));
const confidence = fc.float({ min: 0, max: 1, noNaN: true }).map((n) => Math.round(n * 100) / 100);

const sourceRefArb: fc.Arbitrary<SourceRef> = fc.oneof(
  fc.record({ kind: fc.constant('sheet' as const), sheet: fc.string({ minLength: 1, maxLength: 20 }), range: fc.string({ minLength: 1, maxLength: 8 }) }),
  fc.record({ kind: fc.constant('text' as const), start: fc.nat(1000), end: fc.nat(1000) }),
);

const candidateRefArb = fc.oneof(
  fc.record({ kind: fc.constant('candidate' as const), seq: fc.nat(1000) }),
  fc.record({ kind: fc.constant('existing' as const), elementId: uuid }),
  fc.record({ kind: fc.constant('unresolved' as const), text: fc.string({ minLength: 1, maxLength: 30 }) }),
);

const proposalArb: fc.Arbitrary<CandidateProposal> = fc.oneof(
  fc.record({
    kind: fc.constant('element' as const),
    elementType: fc.constant('system' as const),
    name: fc.string({ minLength: 1, maxLength: 40 }),
    parent: fc.option(candidateRefArb, { nil: null }),
    attributes: fc.record({ isExternal: fc.boolean() }, { requiredKeys: ['isExternal'] }),
  }),
  fc.record({
    kind: fc.constant('relationship' as const),
    relationshipType: fc.constant('uses' as const),
    from: candidateRefArb,
    to: candidateRefArb,
    attributes: fc.record({ description: fc.string() }, { requiredKeys: [] }),
  }),
);

const evidenceArb: fc.Arbitrary<CandidateEvidence> = fc.record({
  sourceRef: sourceRefArb,
  passage: fc.string({ minLength: 1, maxLength: 60 }),
  extractor: fc.constantFrom('sheet-mapping', 'prose-llm', 'capability-llm', 'reimport-diff'),
  attributeConfidence: fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), confidence),
  warnings: fc.array(fc.constantFrom({ code: 'PASSAGE_NORMALISED' as const }, { code: 'MULTI_VALUE_CELL' as const, cell: 'A1' }, { code: 'PARENT_UNRESOLVED' as const, text: 'Legacy CRM' }, { code: 'ENDPOINT_UNRESOLVED' as const, text: 'Legacy CRM', end: 'to' as const })),
});

const matchOutcomeArb: fc.Arbitrary<MatchOutcome> = fc.record(
  {
    level: fc.constantFrom('exact_id' as const, 'alias' as const, 'name_context' as const, 'none' as const),
    elementId: uuid,
    score: fc.float({ min: 0, max: 1, noNaN: true }),
    similar: fc.constant([]),
    warnings: fc.constant([]),
  },
  { requiredKeys: ['level', 'score', 'similar', 'warnings'] },
);

const captureCandidateArb: fc.Arbitrary<CaptureCandidate> = fc.record(
  {
    id: uuid,
    orgId: uuid,
    jobId: uuid,
    modelId: uuid,
    seq: fc.nat(10000),
    kind: fc.constantFrom('element' as const, 'relationship' as const),
    class: fc.constantFrom('new' as const, 'update' as const, 'confirm' as const, 'conflict' as const, 'ambiguous' as const, 'gone' as const, 'invalid' as const, 'unsourced' as const),
    elementType: fc.constant('system' as const),
    relationshipType: fc.constant(null),
    draftSubjectId: uuid,
    proposal: proposalArb,
    evidence: evidenceArb,
    match: matchOutcomeArb,
    confidence,
    rowKey: fc.string({ minLength: 1, maxLength: 30 }),
    reimportStatus: fc.constantFrom('new' as const, 'changed' as const, 'unchanged' as const, 'gone' as const, null),
    draftDeltaIds: fc.array(uuid, { maxLength: 3 }),
    aliasProposals: fc.array(fc.record({ type: fc.constantFrom('name' as const, 'code' as const, 'external_ref' as const, 'source_system_key' as const, 'template_code' as const, 'merged_id' as const), value: fc.string({ minLength: 1, maxLength: 30 }) }), { maxLength: 3 }),
    decision: fc.constantFrom('accepted' as const, 'rejected' as const, null),
    decisionDetail: fc.constant(null),
    decidedBy: fc.option(uuid, { nil: null }),
    decidedAt: fc.option(isoDateTime, { nil: null }),
    promotedCommitId: fc.option(uuid, { nil: null }),
    promotedSubjectId: fc.option(uuid, { nil: null }),
    createdAt: isoDateTime,
  },
  { requiredKeys: ['id', 'orgId', 'jobId', 'modelId', 'seq', 'kind', 'class', 'elementType', 'relationshipType', 'draftSubjectId', 'proposal', 'evidence', 'match', 'confidence', 'rowKey', 'reimportStatus', 'draftDeltaIds', 'aliasProposals', 'decision', 'decisionDetail', 'decidedBy', 'decidedAt', 'promotedCommitId', 'promotedSubjectId', 'createdAt'] },
);

const captureJobArb: fc.Arbitrary<CaptureJob> = fc.record(
  {
    id: uuid,
    orgId: uuid,
    modelId: uuid,
    inputKind: fc.constantFrom('spreadsheet' as const, 'pdf' as const, 'text' as const),
    inputName: fc.string({ minLength: 1, maxLength: 60 }),
    inputRef: fc.string({ minLength: 1, maxLength: 80 }),
    inputSha256: fc.array(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'), { minLength: 64, maxLength: 64 }).map((chars) => chars.join('')),
    documentDate: fc.option(isoDate, { nil: null }),
    status: fc.constantFrom('pending' as const, 'parsed' as const, 'reviewed' as const, 'discarded' as const),
    resultingBranchId: fc.option(uuid, { nil: null }),
    reimportOfJobId: fc.option(uuid, { nil: null }),
    targetBranchId: fc.option(uuid, { nil: null }),
    progress: fc.constant(null),
    llmUsage: fc.constant(null),
    stats: fc.option(fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.nat(1000)), { nil: null }),
    error: fc.constant(null),
    createdBy: uuid,
    createdAt: isoDateTime,
    finishedAt: fc.option(isoDateTime, { nil: null }),
  },
  { requiredKeys: ['id', 'orgId', 'modelId', 'inputKind', 'inputName', 'inputRef', 'inputSha256', 'documentDate', 'status', 'resultingBranchId', 'reimportOfJobId', 'targetBranchId', 'progress', 'llmUsage', 'stats', 'error', 'createdBy', 'createdAt', 'finishedAt'] },
);

describe('CaptureCandidate round trip (RT-K1)', () => {
  it('survives a JSON round trip', () => {
    fc.assert(
      fc.property(captureCandidateArb, (candidate) => {
        expect(JSON.parse(JSON.stringify(candidate))).toEqual(candidate);
      }),
    );
  });

  it('survives candidate -> row -> candidate', () => {
    fc.assert(
      fc.property(captureCandidateArb, (candidate) => {
        expect(captureCandidateRowToWire(captureCandidateWireToRow(candidate))).toEqual(candidate);
      }),
    );
  });
});

describe('CaptureJob round trip (RT-K1)', () => {
  it('survives a JSON round trip', () => {
    fc.assert(
      fc.property(captureJobArb, (job) => {
        expect(JSON.parse(JSON.stringify(job))).toEqual(job);
      }),
    );
  });

  it('survives job -> row -> job', () => {
    fc.assert(
      fc.property(captureJobArb, (job) => {
        expect(captureJobRowToWire(captureJobWireToRow(job))).toEqual(job);
      }),
    );
  });
});
