/**
 * F2 (full K1) PR10, SPEC-capture.md §5.2's own "Intra-document duplicates"
 * paragraph, extended: `rowsToCandidates.ts` already collapses *exact*
 * normalised-name duplicates within one sheet (same `(type, name, parent)`
 * triple); this pass catches what that exact grouping misses — a fuzzier
 * spelling of the same row's own name (`Power On` vs `PowerOn (Enzen)` vs
 * `POWERON`) — using the same trigram identity threshold `match.ts`'s own
 * level-3 matching uses, run within one job's own candidate set instead of
 * against main (`rowsToCandidates.ts`'s own module comment names this as
 * "the orchestrator's job (PR10)").
 *
 * Only element candidates of the same type sharing the same (still
 * `unresolved`) parent text are compared — actor and relationship
 * candidates are never merged with each other here, only re-pointed when
 * the element/actor a `{kind:'candidate', seq}` reference names turns out
 * to have been merged away. A merged element's own attributes follow
 * `rowsToCandidates.ts`'s own rule for exact duplicates: the survivor's
 * (first-seen) value wins on a per-attribute basis, an attribute only the
 * duplicate stated is added, and a genuine disagreement on a value both
 * state is recorded as `ROWS_DISAGREE` rather than silently overwritten.
 */
import type { CandidateRef, CandidateEvidence, EvidenceWarning } from '../contracts/capture';
import type { SourceRef } from '../contracts/sourceRef';
import { deepEqualJson } from './classify';
import { IDENTITY_TRIGRAM_THRESHOLD, trigramSimilarity } from '../engine/trigram';
import { normaliseName } from './normalise';
import type { RowCandidate } from './rowsToCandidates';

function refCellText(evidence: CandidateEvidence, attribute: string): string {
  const ref = evidence.attributeRefs?.[attribute] ?? evidence.sourceRef;
  return ref.kind === 'sheet' ? ref.range : '';
}

type AliasProposal = RowCandidate['aliasProposals'][number];

/**
 * Exact-value dedup only — deliberately *not* `normaliseName`: `rowsToCandidates.ts`'s
 * own exact-duplicate grouping already keeps "PowerOn" and "POWERON" as two
 * separate `name` alias proposals despite sharing a normalised form (every
 * row's own literal spelling is evidence a document actually used that
 * string), and this merge pass extends the same group with more candidates
 * — it must not start silently collapsing what the earlier pass deliberately
 * kept distinct. This only catches a literal re-add of the same string (the
 * survivor's own name pushed a second time by `mergeElementCandidates`
 * below, when `dup.aliasProposals` already carries it).
 */
function dedupeAliasProposals(proposals: readonly AliasProposal[]): AliasProposal[] {
  const seen = new Set<string>();
  const result: RowCandidate['aliasProposals'] = [];
  for (const proposal of proposals) {
    const key = `${proposal.type}|${proposal.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(proposal);
  }
  return result;
}

/** Merges `dup` into `survivor` — §5.2's own exact-duplicate rule, applied here to a fuzzy (trigram) match instead: survivor's first-seen attribute value wins, a genuinely new attribute is added, a real disagreement is warned rather than overwritten. */
function mergeElementCandidates(survivor: RowCandidate, dup: RowCandidate): RowCandidate {
  if (survivor.proposal.kind !== 'element' || dup.proposal.kind !== 'element') {
    throw new Error('intraDocumentDedup: mergeElementCandidates requires two element candidates.');
  }
  const survivorProposal = survivor.proposal;
  const dupProposal = dup.proposal;

  const attributes: Record<string, unknown> = { ...survivorProposal.attributes };
  const attributeConfidence: Record<string, number> = { ...survivor.evidence.attributeConfidence };
  const attributeRefs: Record<string, SourceRef> = { ...survivor.evidence.attributeRefs };
  const warnings: EvidenceWarning[] = [...survivor.evidence.warnings];

  for (const [key, value] of Object.entries(dupProposal.attributes as Record<string, unknown>)) {
    if (!(key in attributes)) {
      attributes[key] = value;
      const dupConfidence = dup.evidence.attributeConfidence[key];
      if (dupConfidence !== undefined) attributeConfidence[key] = dupConfidence;
      const dupRef = dup.evidence.attributeRefs?.[key];
      if (dupRef !== undefined) attributeRefs[key] = dupRef;
      continue;
    }
    if (!deepEqualJson(attributes[key], value)) {
      warnings.push({ code: 'ROWS_DISAGREE', cell: refCellText(dup.evidence, key) });
    }
  }

  const aliasProposals = dedupeAliasProposals([...survivor.aliasProposals, { type: 'name' as const, value: dupProposal.name }, ...dup.aliasProposals]);

  const mergedAtlasId = survivor.matchHints?.atlasId ?? dup.matchHints?.atlasId;
  const mergedSourceKeys = [...(survivor.matchHints?.sourceKeys ?? []), ...(dup.matchHints?.sourceKeys ?? [])];
  const matchHints: RowCandidate['matchHints'] = {
    ...(mergedAtlasId !== undefined ? { atlasId: mergedAtlasId } : {}),
    ...(mergedSourceKeys.length > 0 ? { sourceKeys: mergedSourceKeys } : {}),
  };

  return {
    ...survivor,
    proposal: { ...survivorProposal, attributes },
    evidence: { ...survivor.evidence, passage: `${survivor.evidence.passage}\n${dup.evidence.passage}`, attributeConfidence, attributeRefs, warnings },
    matchHints,
    aliasProposals,
  };
}

function remapRef(ref: CandidateRef, seqRemap: ReadonlyMap<number, number>): CandidateRef {
  if (ref.kind === 'candidate') {
    const remapped = seqRemap.get(ref.seq);
    if (remapped !== undefined) return { kind: 'candidate', seq: remapped };
  }
  return ref;
}

function remapCandidateRefs(candidate: RowCandidate, seqRemap: ReadonlyMap<number, number>): RowCandidate {
  if (seqRemap.size === 0) return candidate;
  if (candidate.proposal.kind === 'element') {
    if (candidate.proposal.parent?.kind !== 'candidate') return candidate;
    return { ...candidate, proposal: { ...candidate.proposal, parent: remapRef(candidate.proposal.parent, seqRemap) } };
  }
  return { ...candidate, proposal: { ...candidate.proposal, from: remapRef(candidate.proposal.from, seqRemap), to: remapRef(candidate.proposal.to, seqRemap) } };
}

/** A group's own bucket key: element type plus its (still textual) parent — an unresolved parent's own normalised text, `''` for an explicit top-level (`parent: null`), or the ref's own JSON shape for anything else (defensive; `rowsToCandidates.ts` never emits a `parent` in any other shape at this stage). */
function bucketKeyFor(candidate: Extract<RowCandidate['proposal'], { kind: 'element' }>): string {
  const parent = candidate.parent;
  const parentKey = parent === null ? '' : parent.kind === 'unresolved' ? normaliseName(parent.text) : JSON.stringify(parent);
  return `${candidate.elementType}|${parentKey}`;
}

export interface DedupeIntraDocumentCandidatesResult {
  candidates: RowCandidate[];
  /** Dropped (merged-away) seq → the survivor's own seq — `runCapture.ts` applies this same map to `RowsToCandidatesResult.capabilityRows` (keyed by the very same per-sheet element seq), which this module never sees. */
  seqRemap: ReadonlyMap<number, number>;
}

/**
 * Runs over one sheet's own `rowsToCandidates()` output (elements, actors
 * and relationships together — non-element candidates pass through
 * unchanged apart from seq re-pointing). Candidates merged away are
 * dropped from the result; every surviving candidate keeps its own
 * original `seq` — final, contiguous re-numbering across every sheet is
 * `runCapture.ts`'s own last step, not this pass's job.
 */
export function dedupeIntraDocumentCandidates(candidates: readonly RowCandidate[]): DedupeIntraDocumentCandidatesResult {
  const result: RowCandidate[] = [];
  const seqRemap = new Map<number, number>();
  const survivorIndicesByBucket = new Map<string, number[]>();

  for (const candidate of candidates) {
    if (candidate.proposal.kind !== 'element') {
      result.push(candidate);
      continue;
    }

    const bucketKey = bucketKeyFor(candidate.proposal);
    const indices = survivorIndicesByBucket.get(bucketKey) ?? [];
    const normalisedName = normaliseName(candidate.proposal.name);

    let mergeIntoIndex: number | undefined;
    for (const index of indices) {
      const existing = result[index];
      if (existing?.proposal.kind !== 'element') continue;
      // Two rows that each name a different Atlas ID are two different
      // elements whatever their names look like — this product's own export
      // writes an ID on every row, and "Connections" next to "Connection
      // Quotations" is two capabilities, not a typo.
      const existingAtlasId = existing.matchHints?.atlasId;
      const ownAtlasId = candidate.matchHints?.atlasId;
      if (existingAtlasId !== undefined && ownAtlasId !== undefined && existingAtlasId !== ownAtlasId) continue;
      if (trigramSimilarity(normalisedName, normaliseName(existing.proposal.name)) >= IDENTITY_TRIGRAM_THRESHOLD) {
        mergeIntoIndex = index;
        break;
      }
    }

    if (mergeIntoIndex === undefined) {
      indices.push(result.length);
      survivorIndicesByBucket.set(bucketKey, indices);
      result.push(candidate);
      continue;
    }

    const survivor = result[mergeIntoIndex];
    if (survivor === undefined) throw new Error('intraDocumentDedup: internal — indexed survivor must exist.');
    seqRemap.set(candidate.seq, survivor.seq);
    result[mergeIntoIndex] = mergeElementCandidates(survivor, candidate);
  }

  return { candidates: seqRemap.size === 0 ? result : result.map((c) => remapCandidateRefs(c, seqRemap)), seqRemap };
}
