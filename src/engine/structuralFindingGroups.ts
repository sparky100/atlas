/**
 * Display-ready grouping of a `MergeReview`'s structural findings (ADR-021
 * §4, C2b) — one card per retracted element (whichever of
 * `structural:retract-vs-modify`/`dangling-endpoint`/`dangling-parent` it
 * arrived as), one per duplicate-relationship or cardinality pair. Pure:
 * takes an already-computed `MergeReview`, no I/O — `src/ui/reviews`'s
 * `BranchRebasePanel.tsx`/`ReviewRequestView.tsx` call this once per render
 * instead of re-deriving groupings themselves, so a card's own choice UI
 * and `buildStructuralResolutions` (`mergeResolution.ts`) can never
 * disagree about what a "retracted element" or a "pair" is.
 */
import type { UUID } from '../contracts/delta';
import type { ConflictFinding, MergeReview } from './merge';
import { groupRetractionFindings, type RetractionFindingGroup } from './mergeResolution';

export interface RetractionCardData {
  elementId: UUID;
  elementName: string;
  group: RetractionFindingGroup;
  findings: ConflictFinding[];
  retractedSide: 'ours' | 'theirs';
  keepingSide: 'ours' | 'theirs';
  /** Case B only (`retractedSide === 'theirs'`) — pre-existing relationships of the element, still live on our own side, gone on main's: "keep element" defaults every one of these to restored (UI-principles §5.3's own amendment), the reviewer unticks any that should stay retracted. Empty in Case A, where nothing needs this checklist at all. */
  preExistingRelationships: { relationshipId: UUID; name: string }[];
  /** Where a re-parented child (`dangling-parent`) lands if the reviewer keeps the retraction — the element's own parent at the merge base, named for the consequences text (UI-principles §5.3: "re-parents 2 containers under Integration Platform"). `null` for a top-level element. */
  formerParentName: string | null;
}

export interface PairCardData {
  findingClass: 'structural:duplicate-relationship' | 'structural:cardinality';
  relationshipId: UUID;
  relatedRelationshipId: UUID;
  finding: ConflictFinding;
  relationshipTypeLabel: string;
}

export interface StructuralFindingGroups {
  retractions: RetractionCardData[];
  duplicates: PairCardData[];
  cardinalities: PairCardData[];
}

function existsIn(head: MergeReview['threeWay']['base'], id: UUID): boolean {
  return head.elements.has(id) || head.relationships.has(id);
}

function nameOf(review: MergeReview, id: UUID): string {
  const { base, ours, theirs } = review.threeWay;
  return ours.elements.get(id)?.name ?? theirs.elements.get(id)?.name ?? base.elements.get(id)?.name ?? id;
}

/**
 * Everything a structural-conflict card needs to render and to build its
 * eventual `StructuralChoice`, grouped from `review`'s own findings.
 * Converged-retract findings never appear here — they're non-blocking and
 * resolved automatically (ADR-021 §4.1), never a card; callers should
 * already be filtering to blocking findings before this runs, but this
 * function only ever groups the retraction-shaped classes that *are*
 * blocking regardless.
 */
export function groupStructuralFindings(review: MergeReview): StructuralFindingGroups {
  const { base, ours, theirs } = review.threeWay;
  const { findings } = review.classification;

  const retractionGroups = groupRetractionFindings(findings.filter((f) => f.blocking));
  const retractions: RetractionCardData[] = [];
  for (const [elementId, group] of retractionGroups) {
    if (group.converged) continue; // non-blocking, never a card (ADR-021 §4.1)
    const inOurs = existsIn(ours, elementId);
    const inTheirs = existsIn(theirs, elementId);
    if (inOurs === inTheirs) continue; // not actually one-sidedly retracted — shouldn't happen for a blocking finding, but never render a card for it
    const retractedSide: 'ours' | 'theirs' = inOurs ? 'theirs' : 'ours';
    const keepingSide: 'ours' | 'theirs' = retractedSide === 'ours' ? 'theirs' : 'ours';
    const keepingHead = keepingSide === 'ours' ? ours : theirs;
    const retractingHead = retractedSide === 'ours' ? ours : theirs;

    const preExistingRelationships: { relationshipId: UUID; name: string }[] = [];
    if (retractedSide === 'theirs') {
      // Case B: pre-existing relationships of the element, still live on
      // our own (keeping) side, gone on the retracting (main) side —
      // ADR-021 §4.1's "Q", listed here so "keep element" can default them
      // to restored and let the reviewer untick any that should stay gone.
      for (const [qId, qRow] of base.relationships) {
        if (qRow.fromElementId !== elementId && qRow.toElementId !== elementId) continue;
        if (!keepingHead.relationships.has(qId) || retractingHead.relationships.has(qId)) continue;
        preExistingRelationships.push({ relationshipId: qId, name: nameOf(review, qRow.fromElementId === elementId ? qRow.toElementId : qRow.fromElementId) });
      }
    }

    const formerParentId = base.elements.get(elementId)?.parentId ?? null;

    retractions.push({
      elementId,
      elementName: nameOf(review, elementId),
      group,
      findings: findings.filter((f) => (f.class === 'structural:dangling-parent' ? f.relatedSubjectId === elementId : f.subjectId === elementId) && f.class !== 'structural:converged-retract'),
      retractedSide,
      keepingSide,
      preExistingRelationships,
      formerParentName: formerParentId ? nameOf(review, formerParentId) : null,
    });
  }

  const duplicates: PairCardData[] = [];
  const cardinalities: PairCardData[] = [];
  const seenPairs = new Set<string>();
  for (const f of findings) {
    if (f.class !== 'structural:duplicate-relationship' && f.class !== 'structural:cardinality') continue;
    if (!f.relatedSubjectId) continue;
    const pairKey = `${f.class} ${[f.subjectId, f.relatedSubjectId].sort().join(' ')}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    const row = ours.relationships.get(f.subjectId) ?? theirs.relationships.get(f.subjectId);
    const card: PairCardData = {
      findingClass: f.class,
      relationshipId: f.subjectId,
      relatedRelationshipId: f.relatedSubjectId,
      finding: f,
      relationshipTypeLabel: row?.relationshipType ?? 'relationship',
    };
    if (f.class === 'structural:duplicate-relationship') duplicates.push(card);
    else cardinalities.push(card);
  }

  return { retractions, duplicates, cardinalities };
}
