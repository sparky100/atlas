/**
 * ADR-019 (docs/ADR-000-foundations.md), SPEC §3.6/§9/§7.4, E7
 * (docs/prompts/atlas-prompt-pack.md): a reversible identity merge — "these
 * two elements are the same real thing." Pure, like `mergeResolution.ts`'s
 * neighbouring builders: takes an already-folded `Head` (or, for undo, a
 * commit's own already-loaded deltas) and a caller-supplied id minter
 * (CLAUDE.md rule 6), no I/O. `src/db/elementMerges.ts` is this module's
 * one caller — it commits the result through the ordinary `commitToBranch`
 * path (a merge is, mechanically, exactly the edit a person would make by
 * hand, just atomic and computed) and separately records `element_merges`/
 * the `merged_id`/`name` aliases via `atlas.record_element_merge`.
 * `buildMergeElementsDeltas` also returns a structured `MergeEffect`
 * alongside its deltas — the "Merge into…" UI action's own confirmation
 * preview (`mergeEffectSentences.ts`) reads it directly rather than
 * re-deriving what the merge will do from a second, independent pass.
 */
import type { Delta, RelationshipType, UUID } from '../contracts/delta';
import type { Json } from '../contracts/rows';
import { factMapKey, type Head } from './deltas';
import { EngineError } from './errors';

/**
 * What happened to one of the loser's relationships, for the confirmation
 * preview (E7's own "Merge into…" UI action) — computed in the same pass
 * as `deltas` below, so the preview can never drift from what the commit
 * actually does. `repointed`/`repointed-demoted-secondary` land as a real
 * `relationship.create`; the three `dropped-*` outcomes match this
 * function's own (a)/(b)/(c) cases and produce no replacement at all.
 */
export type MergeRelationshipOutcome = 'repointed' | 'repointed-demoted-secondary' | 'dropped-self-loop' | 'dropped-duplicate' | 'dropped-cardinality';

export interface MergeRelationshipEffect {
  relationshipId: UUID;
  relationshipType: RelationshipType;
  /** The relationship's other endpoint — whichever side wasn't the loser. */
  otherElementId: UUID;
  /** Which side of the relationship the loser was on — which verb direction the preview reads in. */
  loserSide: 'from' | 'to';
  outcome: MergeRelationshipOutcome;
}

export interface MergeEffect {
  relationships: MergeRelationshipEffect[];
  /** Every one of the loser's own children, re-parented onto the survivor. */
  reparentedChildIds: UUID[];
}

export interface BuildMergeElementsResult {
  deltas: Delta[];
  effect: MergeEffect;
}

function elementRetractDelta(id: UUID, elementId: UUID, elementType: string, previousDeltaId: UUID, sourceId: UUID): Delta {
  return { kind: 'element.retract', id, elementId, elementType, previousDeltaId, sourceId, confidence: 1 } as never;
}

function elementRestoreDelta(id: UUID, elementId: UUID, elementType: string, previousDeltaId: UUID, sourceId: UUID): Delta {
  return { kind: 'element.restore', id, elementId, elementType, previousDeltaId, sourceId, confidence: 1 } as never;
}

function elementUpdateParentIdDelta(id: UUID, elementId: UUID, elementType: string, parentId: UUID | null, previousDeltaId: UUID, sourceId: UUID): Delta {
  return { kind: 'element.update', id, elementId, elementType, attribute: 'parentId', value: parentId, previousDeltaId, sourceId, confidence: 1 } as never;
}

function relationshipRetractDelta(id: UUID, relationshipId: UUID, relationshipType: string, previousDeltaId: UUID, sourceId: UUID): Delta {
  return { kind: 'relationship.retract', id, relationshipId, relationshipType, previousDeltaId, sourceId, confidence: 1 } as never;
}

function relationshipRestoreDelta(id: UUID, relationshipId: UUID, relationshipType: string, previousDeltaId: UUID, sourceId: UUID): Delta {
  return { kind: 'relationship.restore', id, relationshipId, relationshipType, previousDeltaId, sourceId, confidence: 1 } as never;
}

function relationshipCreateDelta(id: UUID, relationshipId: UUID, relationshipType: string, fromElementId: UUID, toElementId: UUID, attributes: Record<string, Json>, sourceId: UUID): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType, fromElementId, toElementId, attributes, sourceId, confidence: 1 } as never;
}

function currentDeltaId(head: Head, subjectId: UUID, attribute: string): UUID {
  const fact = head.facts.get(factMapKey(subjectId, attribute));
  if (!fact) throw new EngineError(`mergeElements: ${subjectId}.${attribute} has no currently-asserting delta in this head`);
  return fact.deltaId;
}

/**
 * Builds the one commit's worth of deltas `atlas.merge_elements` needs
 * (SPEC §3.6): every relationship touching `loserId` is re-pointed to
 * `survivorId` — unless doing so would (a) leave a self-loop (both ends
 * now `survivorId` — a relationship between the two elements being merged
 * is meaningless once they're one identity, so it's dropped, not kept),
 * (b) duplicate a relationship the survivor already has (S-6 — the loser's
 * own copy is retracted with no replacement), or (c) collide with a
 * cardinality limit the survivor already holds (`supports.role = 'primary'`
 * demotes to `'secondary'`, the one neutral value that type has; `owns` has
 * none, so the losing edge is dropped outright — the exact same two
 * conventions ADR-021 §4.3 already established for the equivalent branch-
 * merge collision, reused here rather than invented fresh). Every one of
 * the loser's children is re-parented onto the survivor. The loser itself
 * is retracted last, once nothing live still references it (C8).
 */
export function buildMergeElementsDeltas(head: Head, survivorId: UUID, loserId: UUID, sourceId: UUID, mintId: () => UUID): BuildMergeElementsResult {
  if (survivorId === loserId) throw new EngineError('mergeElements: cannot merge an element into itself');
  const survivor = head.elements.get(survivorId);
  const loser = head.elements.get(loserId);
  if (!survivor) throw new EngineError(`mergeElements: survivor ${survivorId} does not exist in this head`);
  if (!loser) throw new EngineError(`mergeElements: loser ${loserId} does not exist in this head`);
  if (survivor.elementType !== loser.elementType) {
    throw new EngineError(`mergeElements: cannot merge a ${loser.elementType} (${loserId}) into a ${survivor.elementType} (${survivorId}) — different element types can never be the same real thing`);
  }

  const deltas: Delta[] = [];
  const relationshipEffects: MergeRelationshipEffect[] = [];

  for (const [relId, rel] of head.relationships) {
    if (rel.fromElementId !== loserId && rel.toElementId !== loserId) continue;
    const loserSide: 'from' | 'to' = rel.fromElementId === loserId ? 'from' : 'to';
    const otherElementId = loserSide === 'from' ? rel.toElementId : rel.fromElementId;

    deltas.push(relationshipRetractDelta(mintId(), relId, rel.relationshipType, rel.existsDeltaId, sourceId));

    const newFrom = rel.fromElementId === loserId ? survivorId : rel.fromElementId;
    const newTo = rel.toElementId === loserId ? survivorId : rel.toElementId;
    if (newFrom === newTo) {
      // (a) a relationship between the two elements being merged — meaningless post-merge.
      relationshipEffects.push({ relationshipId: relId, relationshipType: rel.relationshipType, otherElementId, loserSide, outcome: 'dropped-self-loop' });
      continue;
    }

    const isDuplicate = [...head.relationships].some(([otherId, other]) => otherId !== relId && other.relationshipType === rel.relationshipType && other.fromElementId === newFrom && other.toElementId === newTo);
    if (isDuplicate) {
      // (b) S-6 — the survivor already has this exact edge.
      relationshipEffects.push({ relationshipId: relId, relationshipType: rel.relationshipType, otherElementId, loserSide, outcome: 'dropped-duplicate' });
      continue;
    }

    let attributes: Record<string, Json> = { ...rel.attributes };
    const role = typeof attributes.role === 'string' ? attributes.role : undefined;
    let outcome: MergeRelationshipOutcome = 'repointed';
    if (rel.relationshipType === 'supports' && role === 'primary') {
      const collidesOnFrom = [...head.relationships].some(
        ([otherId, other]) => otherId !== relId && other.relationshipType === 'supports' && other.fromElementId === newFrom && other.attributes.role === 'primary',
      );
      if (collidesOnFrom) {
        attributes = { ...attributes, role: 'secondary' };
        outcome = 'repointed-demoted-secondary';
      }
    } else if (rel.relationshipType === 'owns' && role !== undefined) {
      const collidesOnTo = [...head.relationships].some(
        ([otherId, other]) => otherId !== relId && other.relationshipType === 'owns' && other.toElementId === newTo && other.attributes.role === role,
      );
      if (collidesOnTo) {
        // (c) owns has no neutral role value (ADR-021 §4.3) — drop rather than collide.
        relationshipEffects.push({ relationshipId: relId, relationshipType: rel.relationshipType, otherElementId, loserSide, outcome: 'dropped-cardinality' });
        continue;
      }
    }

    deltas.push(relationshipCreateDelta(mintId(), mintId(), rel.relationshipType, newFrom, newTo, attributes, sourceId));
    relationshipEffects.push({ relationshipId: relId, relationshipType: rel.relationshipType, otherElementId, loserSide, outcome });
  }

  const reparentedChildIds: UUID[] = [];
  for (const [childId, child] of head.elements) {
    if (child.parentId !== loserId) continue;
    deltas.push(elementUpdateParentIdDelta(mintId(), childId, child.elementType, survivorId, currentDeltaId(head, childId, 'parentId'), sourceId));
    reparentedChildIds.push(childId);
  }

  deltas.push(elementRetractDelta(mintId(), loserId, loser.elementType, loser.existsDeltaId, sourceId));

  return { deltas, effect: { relationships: relationshipEffects, reparentedChildIds } };
}

export interface BuildUndoMergeElementsResult {
  deltas: Delta[];
}

/**
 * The exact inverse of `buildMergeElementsDeltas`, computed purely from the
 * original merge commit's own delta list (`mergeCommitDeltas` — a
 * `CommitNode.deltas`) — no head lookup needed, since every fact an undo
 * needs is already implicit in what the merge itself wrote: restoring an
 * `element.retract`/`relationship.retract` recovers exactly the state it
 * superseded (the same "restore" semantics every other reversible action
 * in this codebase already relies on), and retracting a
 * `relationship.create` removes exactly the re-pointed edge the merge
 * added. Processed in reverse commit order (last delta undone first) so
 * the loser exists again (`element.restore`, the merge's own last delta)
 * before anything that references it is restored. `element_merges` itself
 * is never touched (CLAUDE.md rule 5) — see this migration's own comment.
 */
export function buildUndoMergeElementsDeltas(mergeCommitDeltas: readonly Delta[], loserId: UUID, sourceId: UUID, mintId: () => UUID): BuildUndoMergeElementsResult {
  const deltas: Delta[] = [];
  for (const d of [...mergeCommitDeltas].reverse()) {
    if (d.kind === 'element.retract' && d.elementId === loserId) {
      deltas.push(elementRestoreDelta(mintId(), d.elementId, d.elementType, d.id, sourceId));
    } else if (d.kind === 'element.update' && d.attribute === 'parentId') {
      deltas.push(elementUpdateParentIdDelta(mintId(), d.elementId, d.elementType, loserId, d.id, sourceId));
    } else if (d.kind === 'relationship.retract') {
      deltas.push(relationshipRestoreDelta(mintId(), d.relationshipId, d.relationshipType, d.id, sourceId));
    } else if (d.kind === 'relationship.create') {
      deltas.push(relationshipRetractDelta(mintId(), d.relationshipId, d.relationshipType, d.id, sourceId));
    }
  }
  return { deltas };
}
