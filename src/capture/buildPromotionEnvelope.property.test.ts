/**
 * P-K3 and P-K4 (SPEC-capture.md §10), both genuinely pure (no database) —
 * `buildPromotionEnvelope` + `fold()` prove them directly, so both run for
 * real here rather than being written-and-skipped like RT-K2/P-K6 (which
 * need a real Postgres, this repo's standing sandbox limitation).
 *
 * P-K3: "Promotion never reuses a draft subject id; every relationship
 * promoted alongside a promoted new element is re-pointed to the re-minted
 * id; a promoted commit folds cleanly (C1–C17)."
 *
 * P-K4: "A confirm candidate's promoted deltas change no head value:
 * fold(target before) and fold(target after) differ only in
 * facts[*].delta_id/provenance for the confirmed keys."
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CaptureCandidate, MatchOutcome, RelationshipProposal } from '../contracts/capture';
import type { Delta, UUID } from '../contracts/delta';
import { cloneHead, emptyHead, factMapKey, fold, type CommitContext, type Head } from '../engine/deltas';
import { buildPromotionEnvelope } from './buildPromotionEnvelope';

const ctx: CommitContext = { authorId: 'author-1', createdAt: '2026-01-01T00:00:00.000Z' };
const DRAFT_SOURCE_ID = 'draft-source';
const REVIEWER_SOURCE_ID = 'reviewer-source';

function createElement(id: UUID, elementId: UUID, elementType: string, name: string, attributes: Record<string, unknown> = {}, sourceId = 'target-source'): Delta {
  return { kind: 'element.create', id, elementId, elementType, name, parentId: null, attributes, sourceId, confidence: 1 } as never;
}

function createRelationship(id: UUID, relationshipId: UUID, relationshipType: string, fromElementId: UUID, toElementId: UUID, attributes: Record<string, unknown>, sourceId: string): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType, fromElementId, toElementId, attributes, sourceId, confidence: 1 } as never;
}

function headFrom(deltas: Delta[]): Head {
  return fold(emptyHead(), deltas, ctx);
}

const NONE_MATCH: MatchOutcome = { level: 'none', score: 0, similar: [], warnings: [] };

function baseCandidate(overrides: Partial<CaptureCandidate> & Pick<CaptureCandidate, 'seq' | 'proposal'>): CaptureCandidate {
  return {
    id: `cc-${String(overrides.seq)}`,
    orgId: 'org-1',
    jobId: 'job-1',
    modelId: 'model-1',
    kind: 'element',
    class: 'new',
    elementType: null,
    relationshipType: null,
    draftSubjectId: null,
    evidence: { sourceRef: { kind: 'sheet', sheet: 'Sheet1', range: 'A1' }, passage: '', extractor: 'sheet-mapping', attributeConfidence: {}, warnings: [] },
    match: NONE_MATCH,
    confidence: 0.9,
    rowKey: `row-${String(overrides.seq)}`,
    reimportStatus: null,
    draftDeltaIds: [],
    aliasProposals: [],
    decision: 'accepted',
    decisionDetail: null,
    decidedBy: null,
    decidedAt: null,
    promotedCommitId: null,
    promotedSubjectId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildPromotionEnvelope — P-K3', () => {
  it('never reuses a draft subject id, and re-points every relationship endpoint to the re-minted id, for arbitrary counts of new elements/relationships', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 0, max: 10 }), fc.integer({ min: 0, max: 1_000_000 }), (elementCount, relationshipCount, seed) => {
        const draftDeltas: Delta[] = [];
        const draftElementIds: UUID[] = [];
        for (let i = 0; i < elementCount; i += 1) {
          const draftId = `draft-el-${String(i)}`;
          draftElementIds.push(draftId);
          draftDeltas.push(createElement(`draft-create-${String(i)}`, draftId, i === 0 ? 'capability' : 'system', `Element ${String(i)}`, i === 0 ? {} : { lifecycleStatus: 'active', isExternal: false }, DRAFT_SOURCE_ID));
        }

        let rngState = seed;
        const nextIndex = (max: number) => {
          rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
          return max === 0 ? 0 : rngState % max;
        };

        const relInfo: { draftRelId: UUID; fromDraftId: UUID; toDraftId: UUID }[] = [];
        const seenFromIds = new Set<UUID>(); // V6 dedup — every candidate targets the same capability, so only `fromDraftId` can collide.
        for (let i = 0; i < relationshipCount; i += 1) {
          if (elementCount < 2) break;
          const fromDraftId = draftElementIds[1 + nextIndex(elementCount - 1)]; // never the capability at index 0
          const toDraftId = draftElementIds[0]; // the capability
          if (fromDraftId === undefined || toDraftId === undefined || seenFromIds.has(fromDraftId)) continue;
          seenFromIds.add(fromDraftId);
          const draftRelId = `draft-rel-${String(i)}`;
          draftDeltas.push(createRelationship(`draft-rel-create-${String(i)}`, draftRelId, 'supports', fromDraftId, toDraftId, { role: 'secondary' }, DRAFT_SOURCE_ID));
          relInfo.push({ draftRelId, fromDraftId, toDraftId });
        }

        const draftHead = headFrom(draftDeltas);
        const targetHead = headFrom([]);

        const elementCandidates: CaptureCandidate[] = draftElementIds.map((draftId, i) =>
          baseCandidate({ seq: i, kind: 'element', class: 'new', elementType: i === 0 ? 'capability' : 'system', draftSubjectId: draftId, proposal: { kind: 'element', elementType: i === 0 ? 'capability' : 'system', name: `Element ${String(i)}`, parent: null, attributes: i === 0 ? {} : { lifecycleStatus: 'active', isExternal: false } } }),
        );
        const relationshipCandidates: CaptureCandidate[] = relInfo.map((info, i) => {
          const proposal: RelationshipProposal<'supports'> = { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: info.fromDraftId }, to: { kind: 'existing', elementId: info.toDraftId }, attributes: { role: 'secondary' } };
          return baseCandidate({ seq: elementCount + i, kind: 'relationship', class: 'new', relationshipType: 'supports', draftSubjectId: info.draftRelId, proposal });
        });

        let nextMinted = 0;
        const mintId = () => `promoted-${String((nextMinted += 1))}`;
        const { deltas, promotedSubjectIdBySeq } = buildPromotionEnvelope({ candidates: [...elementCandidates, ...relationshipCandidates], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });

        // Never reuses a draft subject id.
        const promotedIds = [...promotedSubjectIdBySeq.values()];
        for (const draftId of draftElementIds) expect(promotedIds).not.toContain(draftId);
        for (const info of relInfo) expect(promotedIds).not.toContain(info.draftRelId);

        // Every relationship create's endpoints are the re-minted ids, never a draft id.
        for (const delta of deltas) {
          if (delta.kind !== 'relationship.create') continue;
          expect(draftElementIds).not.toContain(delta.fromElementId);
          expect(draftElementIds).not.toContain(delta.toElementId);
        }

        // Folds cleanly (C1-C17).
        expect(() => fold(cloneHead(targetHead), deltas, ctx)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });
});

describe('buildPromotionEnvelope — P-K4', () => {
  it("a confirm candidate's promoted deltas change no head value — only facts[*].deltaId/provenance move", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0), fc.boolean(), (vendor, isExternal) => {
        const attrs = { lifecycleStatus: 'active', isExternal, vendor };
        const draftHead = headFrom([createElement('draft-create', 'sys', 'system', 'CRM', attrs, DRAFT_SOURCE_ID)]);
        const targetHead = headFrom([createElement('target-create', 'sys', 'system', 'CRM', attrs)]);

        const c = baseCandidate({ seq: 0, class: 'confirm', elementType: 'system', draftSubjectId: 'sys', match: { level: 'exact_id', elementId: 'sys', score: 1, similar: [], warnings: [] }, proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: attrs } });

        let nextMinted = 0;
        const mintId = () => `promoted-${String((nextMinted += 1))}`;
        const { deltas } = buildPromotionEnvelope({ candidates: [c], draftHead, targetHead, reviewerSourceId: REVIEWER_SOURCE_ID, mintId });

        const before = targetHead;
        const after = fold(cloneHead(targetHead), deltas, ctx);

        // Same live value for every attribute.
        expect(after.elements.get('sys')?.attributes).toEqual(before.elements.get('sys')?.attributes);
        expect(after.elements.get('sys')?.name).toEqual(before.elements.get('sys')?.name);

        // Every confirmed key's own deltaId moved (a new delta was written), value did not.
        for (const key of Object.keys(attrs)) {
          const beforeFact = before.facts.get(factMapKey('sys', key));
          const afterFact = after.facts.get(factMapKey('sys', key));
          expect(afterFact?.value).toEqual(beforeFact?.value);
          expect(afterFact?.deltaId).not.toEqual(beforeFact?.deltaId);
        }
      }),
      { numRuns: 100 },
    );
  });
});
