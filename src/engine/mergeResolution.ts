/**
 * Building the resolution deltas SPEC-data-model.md §7.4 describes for a
 * field-conflict card's actions ("keep this change / keep main / enter a
 * value"): each writes one `element.update`/`relationship.update` delta
 * whose `previousDeltaId` is *ours'* delta id (the branch's own currently-
 * asserting delta for that fact key — apply()/fold() (src/engine/deltas.ts)
 * never re-validates `previousDeltaId` against the head it's applied to,
 * but this module still sets it to the one value that's true regardless:
 * the delta this resolution is conceptually superseding on the branch's
 * own history), plus the matching `resolved_conflicts` row.
 *
 * Also builds the structural-conflict resolutions ADR-021 (C2b) describes:
 * `buildStructuralResolutions` (§3.3, §4) — retraction direction choice
 * (keep-retraction / keep-element, with the dependent cascade), duplicate-
 * relationship survivor pick, and cardinality primary/role pick. Unlike the
 * field-conflict builder above, this one splits its output into two commits
 * — `prepDeltas` (a `preparation`-kind commit, mechanical, derived from the
 * findings alone) and `mergeDeltas` (the `merge` commit's own deltas, where
 * the reviewer's actual decision lives) — because a structural resolution
 * can require an own delta to run *before* the other side's exclusive
 * commits replay (fold, SPEC §6.2), which a single merge commit's own
 * deltas (applied last) cannot express. See ADR-021 §3 for the two designs
 * that were rejected instead, and why.
 *
 * Pure: takes an already-computed `MergeReview` (src/engine/merge.ts) and a
 * caller-supplied id minter (CLAUDE.md rule 6: no `Math.random` here) — no
 * I/O, so a resolution can be previewed and unit-tested before anything is
 * committed.
 */
import type { Delta, ElementType, RelationshipType, UUID } from '../contracts/delta';
import { EXISTS_ATTRIBUTE } from '../contracts/delta';
import type { Json } from '../contracts/rows';
import type { FieldDiff } from './branch';
import { factMapKey, type Head } from './deltas';
import { EngineError } from './errors';
import type { ConflictFinding, MergeReview } from './merge';

export type FieldConflictAction = 'keep-ours' | 'keep-theirs' | 'value';

export interface FieldConflictChoice {
  subjectId: UUID;
  attribute: string;
  action: FieldConflictAction;
  /** Required, and only meaningful, when `action === 'value'`. */
  value?: Json;
}

/** One `resolved_conflicts` row's worth of fields (ADR-007, SPEC §7.4) — camelCased; src/db/commits.ts's `ResolvedConflictInput` adds the `id` a caller mints for it. */
export interface ResolvedConflictFields {
  winningDeltaId: UUID;
  discardedDeltaId: UUID;
  resolutionDeltaId: UUID;
}

export interface BuiltFieldConflictResolutions {
  deltas: Delta[];
  resolvedConflicts: ResolvedConflictFields[];
}

/**
 * SPEC §7.5's C15: "the set of fact keys in resolutions must equal the set
 * of FIELD_CONFLICT keys." Folding a refresh's own deltas is applied *after*
 * main's exclusive commits are folded in (src/engine/head.ts's
 * `foldFromGenesis`, on a merge commit) — `apply()` never re-validates
 * `previousDeltaId` against the head it lands on, so an unresolved
 * FIELD_CONFLICT key doesn't fail loudly, it silently takes main's value,
 * discarding the branch's own one with no record at all. This is the guard
 * that stops that: every caller pushing a refresh checks this is empty
 * first (src/db/mergeRequests.ts's `pushRefresh`).
 */
export function unresolvedFieldConflictKeys(fields: readonly FieldDiff[], choices: readonly FieldConflictChoice[]): { subjectId: UUID; attribute: string }[] {
  const resolved = new Set(choices.map((c) => `${c.subjectId} ${c.attribute}`));
  return fields.filter((f) => f.classification === 'FIELD_CONFLICT' && !resolved.has(`${f.subjectId} ${f.attribute}`)).map((f) => ({ subjectId: f.subjectId, attribute: f.attribute }));
}

/**
 * Resolves every `choice` against its matching `FIELD_CONFLICT` entry in
 * `fields`. Throws (rather than silently skipping) for a choice that
 * doesn't match an actual field-conflict — a stale UI selection (the
 * classification moved since the reviewer staged it) should surface as an
 * error, not commit something no longer meant.
 *
 * Judgment call on `discardedDeltaId` for `action: 'value'` (SPEC §7.4
 * names `winningDeltaId` exactly — "the resolution delta itself" — but
 * doesn't say which side counts as discarded when neither is chosen
 * outright): this treats the branch's own superseded delta (`ours`) as
 * discarded in that case, same as it mechanically is the delta this
 * resolution's `previousDeltaId` points at.
 */
export function buildFieldConflictResolutions(fields: readonly FieldDiff[], ours: Head, choices: readonly FieldConflictChoice[], sourceId: UUID, mintId: () => UUID): BuiltFieldConflictResolutions {
  const deltas: Delta[] = [];
  const resolvedConflicts: ResolvedConflictFields[] = [];

  for (const choice of choices) {
    const field = fields.find((f) => f.subjectId === choice.subjectId && f.attribute === choice.attribute && f.classification === 'FIELD_CONFLICT');
    if (!field?.ours || !field.theirs) {
      throw new EngineError(`buildFieldConflictResolutions: no field-conflict for ${choice.subjectId}.${choice.attribute} (the branch may have moved since this choice was staged)`);
    }
    if (choice.action === 'value' && choice.value === undefined) {
      throw new EngineError(`buildFieldConflictResolutions: ${choice.subjectId}.${choice.attribute}'s action is "value" but no value was supplied`);
    }

    const value = choice.action === 'keep-ours' ? field.ours.value : choice.action === 'keep-theirs' ? field.theirs.value : (choice.value ?? null);
    const deltaId = mintId();
    const element = ours.elements.get(choice.subjectId);
    const relationship = ours.relationships.get(choice.subjectId);

    if (element) {
      deltas.push({
        kind: 'element.update',
        id: deltaId,
        elementId: choice.subjectId,
        elementType: element.elementType,
        attribute: choice.attribute,
        value,
        previousDeltaId: field.ours.deltaId,
        sourceId,
        confidence: 1,
      } as never);
    } else if (relationship) {
      deltas.push({
        kind: 'relationship.update',
        id: deltaId,
        relationshipId: choice.subjectId,
        relationshipType: relationship.relationshipType,
        attribute: choice.attribute,
        value,
        previousDeltaId: field.ours.deltaId,
        sourceId,
        confidence: 1,
      } as never);
    } else {
      throw new EngineError(`buildFieldConflictResolutions: ${choice.subjectId} is neither a known element nor relationship in ours`);
    }

    const winningDeltaId = choice.action === 'keep-ours' ? field.ours.deltaId : choice.action === 'keep-theirs' ? field.theirs.deltaId : deltaId;
    const discardedDeltaId = choice.action === 'keep-ours' ? field.theirs.deltaId : field.ours.deltaId;
    resolvedConflicts.push({ winningDeltaId, discardedDeltaId, resolutionDeltaId: deltaId });
  }

  return { deltas, resolvedConflicts };
}

// ---------------------------------------------------------------------------
// Structural conflicts (ADR-021 §3.3, §4 — C2b)
// ---------------------------------------------------------------------------

/**
 * One choice per retracted element (ADR-021 §4.1) — covers every finding
 * that names it, whichever of `structural:retract-vs-modify` /
 * `structural:dangling-endpoint` / `structural:dangling-parent` it arrived
 * as; the three are "the same conflict seen through the element, a
 * relationship, or a child" (§4.1) and get one card, one choice.
 */
export interface RetractionChoice {
  class: 'retraction';
  elementId: UUID;
  action: 'keep-retraction' | 'keep-element';
  /**
   * Case B ("keep element", main retracted `E`): pre-existing relationships
   * of `E` that main retracted only because it was retracting `E` (ADR-021
   * §4.1's "Q") default to restored — whether main's retract was "because
   * of E" or an independent decision isn't decidable from history, so the
   * default is the reading ADR-006 implies. List any the reviewer leaves
   * retracted here; omit for "restore all of them."
   */
  excludePreExistingRelationshipIds?: readonly UUID[];
}

/** Survivor pick for `structural:duplicate-relationship` (ADR-021 §4.2). `relationshipId`/`relatedSubjectId` match the finding's own fields. */
export interface DuplicateRelationshipChoice {
  class: 'duplicate-relationship';
  relationshipId: UUID;
  relatedRelationshipId: UUID;
  keep: 'ours' | 'theirs';
}

/** Primary/role pick for `structural:cardinality` (ADR-021 §4.3). */
export interface CardinalityChoice {
  class: 'cardinality';
  relationshipId: UUID;
  relatedRelationshipId: UUID;
  keep: 'ours' | 'theirs';
}

export type StructuralChoice = RetractionChoice | DuplicateRelationshipChoice | CardinalityChoice;

export interface ResolvedStructuralConflictFields {
  winningDeltaId: UUID;
  discardedDeltaId: UUID;
  /** Null for the one case ADR-021 §4.1 names: a keep-retraction's superseded field update, where the winning delta (main's retract) already did the work and there is no delta left to point at. */
  resolutionDeltaId: UUID | null;
  rationale: 'keep-retraction' | 'keep-element' | 'converged' | 'survivor' | 'primary';
}

export interface BuiltStructuralResolutions {
  /** The `preparation`-kind commit's deltas (SPEC §5.1, C21) — mechanical, derived from the findings alone, identical whatever the reviewer chooses. Empty only for a refresh with no blocking findings, or whose only findings are Case B ("theirs" retracted) with nothing dangling on our own side — every other shape below (including duplicate-relationship and cardinality, both of which retract ours' own colliding copy here first) needs at least one. */
  prepDeltas: Delta[];
  /** The `merge` commit's own deltas — where the reviewer's actual decision lives. */
  mergeDeltas: Delta[];
  resolvedConflicts: ResolvedStructuralConflictFields[];
}

/**
 * Every blocking structural finding that still needs a choice (C15,
 * amended — ADR-021 §6): extends `unresolvedFieldConflictKeys`'s guard to
 * the structural classes. A converged-retract is never blocking (resolved
 * automatically by `buildStructuralResolutions`, never a card) and is
 * excluded regardless of `choices`.
 */
export function unresolvedStructuralFindings(findings: readonly ConflictFinding[], choices: readonly StructuralChoice[]): ConflictFinding[] {
  const retractionElementIds = new Set(choices.filter((c): c is RetractionChoice => c.class === 'retraction').map((c) => c.elementId));
  const pairKeys = new Set(
    choices
      .filter((c): c is DuplicateRelationshipChoice | CardinalityChoice => c.class === 'duplicate-relationship' || c.class === 'cardinality')
      .map((c) => `${c.relationshipId} ${c.relatedRelationshipId}`),
  );
  return findings.filter((f) => {
    if (!f.blocking) return false;
    if (f.class === 'structural:retract-vs-modify' || f.class === 'structural:dangling-endpoint') return !retractionElementIds.has(f.subjectId);
    if (f.class === 'structural:dangling-parent') return f.relatedSubjectId === undefined || !retractionElementIds.has(f.relatedSubjectId);
    if (f.class === 'structural:duplicate-relationship' || f.class === 'structural:cardinality') {
      return f.relatedSubjectId === undefined || !pairKeys.has(`${f.subjectId} ${f.relatedSubjectId}`);
    }
    return false; // field-conflict: unresolvedFieldConflictKeys's job, not this one's.
  });
}

function existsIn(head: Head, id: UUID): boolean {
  return head.elements.has(id) || head.relationships.has(id);
}

/** One retracted element's worth of grouped findings — see `groupRetractionFindings`. */
export interface RetractionFindingGroup {
  elementId: UUID;
  danglingRelationshipIds: Set<UUID>;
  danglingChildIds: Set<UUID>;
  hasFieldModification: boolean;
  converged: boolean;
}

/**
 * Groups retraction-shaped findings — `structural:retract-vs-modify`,
 * `structural:dangling-endpoint`, `structural:dangling-parent`, and
 * `structural:converged-retract` — by the element actually being retracted
 * (ADR-021 §4.1: "the three are the same conflict seen through the
 * element, a relationship, or a child" and get one card, one choice).
 * Shared by `buildStructuralResolutions` below and the review UI's own
 * card grouping (`src/ui/reviews`) — one place computes which findings
 * belong to the same retracted element, so a card and the resolution it
 * builds can never disagree about the grouping.
 */
export function groupRetractionFindings(findings: readonly ConflictFinding[]): Map<UUID, RetractionFindingGroup> {
  const groups = new Map<UUID, RetractionFindingGroup>();
  function groupFor(elementId: UUID): RetractionFindingGroup {
    let g = groups.get(elementId);
    if (!g) {
      g = { elementId, danglingRelationshipIds: new Set(), danglingChildIds: new Set(), hasFieldModification: false, converged: false };
      groups.set(elementId, g);
    }
    return g;
  }
  for (const f of findings) {
    if (f.class === 'structural:retract-vs-modify') groupFor(f.subjectId).hasFieldModification = true;
    else if (f.class === 'structural:dangling-endpoint') {
      const g = groupFor(f.subjectId);
      if (f.relatedSubjectId) g.danglingRelationshipIds.add(f.relatedSubjectId);
    } else if (f.class === 'structural:dangling-parent' && f.relatedSubjectId) groupFor(f.relatedSubjectId).danglingChildIds.add(f.subjectId);
    else if (f.class === 'structural:converged-retract') groupFor(f.subjectId).converged = true;
  }
  return groups;
}

function currentDeltaId(head: Head, subjectId: UUID, attribute: string): UUID {
  const fact = head.facts.get(factMapKey(subjectId, attribute));
  if (!fact) throw new EngineError(`buildStructuralResolutions: ${subjectId}.${attribute} has no currently-asserting delta in the head it was found in`);
  return fact.deltaId;
}

/** The delta id `f` records for `side` — throws rather than asserting non-null, since a missing side's fact here would mean the caller mis-grouped a field that was never actually asserted on that side. */
function sideFactDeltaId(f: FieldDiff, side: 'ours' | 'theirs'): UUID {
  const fact = side === 'ours' ? f.ours : f.theirs;
  if (!fact) throw new EngineError(`buildStructuralResolutions: ${f.subjectId}.${f.attribute} has no ${side} fact despite being treated as a modified field`);
  return fact.deltaId;
}

function elementRestoreDelta(id: UUID, elementId: UUID, elementType: ElementType, previousDeltaId: UUID, sourceId: UUID): Delta {
  return { kind: 'element.restore', id, elementId, elementType, previousDeltaId, sourceId, confidence: 1 } as never;
}

function elementRetractDelta(id: UUID, elementId: UUID, elementType: ElementType, previousDeltaId: UUID, sourceId: UUID): Delta {
  return { kind: 'element.retract', id, elementId, elementType, previousDeltaId, sourceId, confidence: 1 } as never;
}

function elementUpdateParentIdDelta(id: UUID, elementId: UUID, elementType: ElementType, parentId: UUID | null, previousDeltaId: UUID, sourceId: UUID): Delta {
  return { kind: 'element.update', id, elementId, elementType, attribute: 'parentId', value: parentId, previousDeltaId, sourceId, confidence: 1 } as never;
}

function relationshipRetractDelta(id: UUID, relationshipId: UUID, relationshipType: RelationshipType, previousDeltaId: UUID, sourceId: UUID): Delta {
  return { kind: 'relationship.retract', id, relationshipId, relationshipType, previousDeltaId, sourceId, confidence: 1 } as never;
}

function relationshipRestoreDelta(id: UUID, relationshipId: UUID, relationshipType: RelationshipType, previousDeltaId: UUID, sourceId: UUID): Delta {
  return { kind: 'relationship.restore', id, relationshipId, relationshipType, previousDeltaId, sourceId, confidence: 1 } as never;
}

function relationshipUpdateRoleDelta(id: UUID, relationshipId: UUID, relationshipType: RelationshipType, role: string, previousDeltaId: UUID, sourceId: UUID): Delta {
  return { kind: 'relationship.update', id, relationshipId, relationshipType, attribute: 'role', value: role, previousDeltaId, sourceId, confidence: 1 } as never;
}

/**
 * ADR-021 §3.3/§4's whole builder in one call: every retraction-shaped
 * finding grouped per retracted element (one choice each, whichever of the
 * three classes it arrived as), one action per duplicate-relationship or
 * cardinality pair, and every converged-retract resolved automatically.
 * Deterministic given the same inputs and `mintId` sequence (rule 6, P-31).
 */
export function buildStructuralResolutions(review: MergeReview, choices: readonly StructuralChoice[], sourceId: UUID, mintId: () => UUID): BuiltStructuralResolutions {
  const { base, ours, theirs, fields } = review.threeWay;
  const { findings } = review.classification;
  const prepDeltas: Delta[] = [];
  const mergeDeltas: Delta[] = [];
  const resolvedConflicts: ResolvedStructuralConflictFields[] = [];

  const retractionChoiceByElement = new Map<UUID, RetractionChoice>();
  for (const c of choices) if (c.class === 'retraction') retractionChoiceByElement.set(c.elementId, c);

  const groups = groupRetractionFindings(findings);

  for (const [elementId, group] of groups) {
    const elementType = base.elements.get(elementId)?.elementType;
    if (!elementType) throw new EngineError(`buildStructuralResolutions: ${elementId} has no base state to reconstruct a restore from`);

    if (group.converged) {
      // ADR-021 §4.1's "converged retraction": automatic, never a card. `P`
      // restores using ours' own retract as the superseded delta (an
      // arbitrary but deterministic convention — both sides agree on the
      // outcome, so which one is "winning" doesn't change what the head
      // ends up holding); `M` needs no own deltas — replaying theirs'
      // exclusive retract onto the restored element reapplies it naturally.
      const oursRetractId = ours.retractedElements.get(elementId);
      const theirsRetractId = theirs.retractedElements.get(elementId);
      if (!oursRetractId || !theirsRetractId) {
        throw new EngineError(`buildStructuralResolutions: converged-retract finding for ${elementId} but a retract delta is missing on one side`);
      }
      const restoreId = mintId();
      prepDeltas.push(elementRestoreDelta(restoreId, elementId, elementType, oursRetractId, sourceId));
      resolvedConflicts.push({ winningDeltaId: oursRetractId, discardedDeltaId: theirsRetractId, resolutionDeltaId: restoreId, rationale: 'converged' });
      continue;
    }

    const choice = retractionChoiceByElement.get(elementId);
    if (!choice) throw new EngineError(`buildStructuralResolutions: no retraction choice for element ${elementId} (the branch may have moved since this choice was staged)`);

    const inOurs = existsIn(ours, elementId);
    const inTheirs = existsIn(theirs, elementId);
    if (inOurs === inTheirs) throw new EngineError(`buildStructuralResolutions: ${elementId} has a retraction choice but isn't one-sidedly retracted`);
    const retractedSide: 'ours' | 'theirs' = inOurs ? 'theirs' : 'ours';
    const keepingSide: 'ours' | 'theirs' = retractedSide === 'ours' ? 'theirs' : 'ours';
    const keepingHead = keepingSide === 'ours' ? ours : theirs;
    const retractedHead = retractedSide === 'ours' ? ours : theirs;
    const retractDeltaId = retractedHead.retractedElements.get(elementId);
    if (!retractDeltaId) throw new EngineError(`buildStructuralResolutions: ${elementId} retracted on ${retractedSide} but its retract delta is missing`);

    const modifiedFields = group.hasFieldModification
      ? fields.filter((f) => f.subjectId === elementId && f.attribute !== EXISTS_ATTRIBUTE && (keepingSide === 'ours' ? f.ours : f.theirs)?.deltaId !== f.base?.deltaId)
      : [];

    if (choice.action === 'keep-element') {
      // Case A (retractedSide === 'ours') and Case B (retractedSide === 'theirs') share the same "keep element" shape:
      // P: restore(E); M own: none (§4.1) — except Case B also needs its own dangling relationships (S_i) retracted in
      // P first, so C8 holds when X replays main's retract(E), and restored again in M once E itself is back.
      const restoreId = mintId();
      if (retractedSide === 'ours') {
        prepDeltas.push(elementRestoreDelta(restoreId, elementId, elementType, retractDeltaId, sourceId));
      } else {
        // Case B: retract our own dangling relationships (S_i) in P — C8 for main's replayed retract(E) — then restore E and them in M, in that order.
        const prepRetractIdBySubject = new Map<UUID, UUID>();
        for (const sId of group.danglingRelationshipIds) {
          const sRow = ours.relationships.get(sId);
          if (!sRow) throw new EngineError(`buildStructuralResolutions: dangling relationship ${sId} not found in ours`);
          const id = mintId();
          prepDeltas.push(relationshipRetractDelta(id, sId, sRow.relationshipType, sRow.existsDeltaId, sourceId));
          prepRetractIdBySubject.set(sId, id);
        }
        mergeDeltas.push(elementRestoreDelta(restoreId, elementId, elementType, retractDeltaId, sourceId));
        for (const sId of group.danglingRelationshipIds) {
          const sRow = ours.relationships.get(sId);
          const prepRetractId = prepRetractIdBySubject.get(sId);
          if (!sRow || prepRetractId === undefined) continue;
          const rrestoreId = mintId();
          mergeDeltas.push(relationshipRestoreDelta(rrestoreId, sId, sRow.relationshipType, prepRetractId, sourceId));
          resolvedConflicts.push({ winningDeltaId: sRow.existsDeltaId, discardedDeltaId: retractDeltaId, resolutionDeltaId: rrestoreId, rationale: 'keep-element' });
        }
        // Q: pre-existing relationships of E, still live on our own keeping side, gone on the retracting side — retracted alongside E (or independently; not decidable from history, ADR-021 §4.1's own note). Default: restore all.
        const excluded = new Set(choice.excludePreExistingRelationshipIds ?? []);
        for (const [qId, qRow] of base.relationships) {
          if (qRow.fromElementId !== elementId && qRow.toElementId !== elementId) continue;
          if (!ours.relationships.has(qId) || theirs.relationships.has(qId) || excluded.has(qId)) continue;
          const theirsRetractId = theirs.retractedRelationships.get(qId);
          if (!theirsRetractId) continue;
          const rrestoreId = mintId();
          mergeDeltas.push(relationshipRestoreDelta(rrestoreId, qId, qRow.relationshipType, theirsRetractId, sourceId));
          resolvedConflicts.push({ winningDeltaId: qRow.existsDeltaId, discardedDeltaId: theirsRetractId, resolutionDeltaId: rrestoreId, rationale: 'keep-element' });
        }
      }
      for (const f of modifiedFields) {
        const winningDeltaId = sideFactDeltaId(f, keepingSide);
        resolvedConflicts.push({ winningDeltaId, discardedDeltaId: retractDeltaId, resolutionDeltaId: restoreId, rationale: 'keep-element' });
      }
      for (const rId of group.danglingRelationshipIds) {
        if (retractedSide !== 'ours') continue; // Case B's S_i already recorded above with its own rrestore id.
        const rRow = keepingHead.relationships.get(rId);
        if (!rRow) continue;
        resolvedConflicts.push({ winningDeltaId: rRow.existsDeltaId, discardedDeltaId: retractDeltaId, resolutionDeltaId: restoreId, rationale: 'keep-element' });
      }
      for (const childId of group.danglingChildIds) {
        const winningDeltaId = currentDeltaId(keepingHead, childId, 'parentId');
        resolvedConflicts.push({ winningDeltaId, discardedDeltaId: retractDeltaId, resolutionDeltaId: restoreId, rationale: 'keep-element' });
      }
    } else {
      // keep-retraction: Case A restores E in P (so X's replay of main's
      // changes lands), then M retracts it again after cascading; Case B
      // needs no restore at all — X's replay of main's retract(E) already
      // succeeds once P retracts our own dangling relationships first.
      const parentBase = base.elements.get(elementId)?.parentId ?? null;
      if (retractedSide === 'ours') {
        const restoreId = mintId();
        prepDeltas.push(elementRestoreDelta(restoreId, elementId, elementType, retractDeltaId, sourceId));
        for (const rId of group.danglingRelationshipIds) {
          const rRow = keepingHead.relationships.get(rId);
          if (!rRow) continue;
          const id = mintId();
          mergeDeltas.push(relationshipRetractDelta(id, rId, rRow.relationshipType, rRow.existsDeltaId, sourceId));
          resolvedConflicts.push({ winningDeltaId: retractDeltaId, discardedDeltaId: rRow.existsDeltaId, resolutionDeltaId: id, rationale: 'keep-retraction' });
        }
        for (const childId of group.danglingChildIds) {
          const childType = keepingHead.elements.get(childId)?.elementType;
          if (!childType) continue;
          const discardedDeltaId = currentDeltaId(keepingHead, childId, 'parentId');
          const id = mintId();
          mergeDeltas.push(elementUpdateParentIdDelta(id, childId, childType, parentBase, discardedDeltaId, sourceId));
          resolvedConflicts.push({ winningDeltaId: retractDeltaId, discardedDeltaId, resolutionDeltaId: id, rationale: 'keep-retraction' });
        }
        const finalRetractId = mintId();
        mergeDeltas.push(elementRetractDelta(finalRetractId, elementId, elementType, restoreId, sourceId));
        for (const f of modifiedFields) {
          const discardedDeltaId = sideFactDeltaId(f, keepingSide);
          resolvedConflicts.push({ winningDeltaId: retractDeltaId, discardedDeltaId, resolutionDeltaId: finalRetractId, rationale: 'keep-retraction' });
        }
      } else {
        for (const sId of group.danglingRelationshipIds) {
          const sRow = ours.relationships.get(sId);
          if (!sRow) continue;
          const id = mintId();
          prepDeltas.push(relationshipRetractDelta(id, sId, sRow.relationshipType, sRow.existsDeltaId, sourceId));
          resolvedConflicts.push({ winningDeltaId: retractDeltaId, discardedDeltaId: sRow.existsDeltaId, resolutionDeltaId: id, rationale: 'keep-retraction' });
        }
        for (const childId of group.danglingChildIds) {
          const childType = ours.elements.get(childId)?.elementType;
          if (!childType) continue;
          const discardedDeltaId = currentDeltaId(ours, childId, 'parentId');
          const id = mintId();
          mergeDeltas.push(elementUpdateParentIdDelta(id, childId, childType, parentBase, discardedDeltaId, sourceId));
          resolvedConflicts.push({ winningDeltaId: retractDeltaId, discardedDeltaId, resolutionDeltaId: id, rationale: 'keep-retraction' });
        }
        for (const f of modifiedFields) {
          const discardedDeltaId = sideFactDeltaId(f, keepingSide);
          resolvedConflicts.push({ winningDeltaId: retractDeltaId, discardedDeltaId, resolutionDeltaId: null, rationale: 'keep-retraction' });
        }
      }
    }
  }

  // ---- duplicate-relationship: survivor pick (ADR-021 §4.2) ----
  // `relationshipId` is always *ours'* own copy of the pair, `relatedRelationshipId`
  // always *theirs'* (merge.ts's own "new on ours x new on theirs" loop, which
  // is where this finding — and this pairing — comes from). Ours' own copy
  // is retracted in P unconditionally, both choices, then restored in M if
  // it's the side that wins — the same shape `owns` cardinality already
  // uses just below, and for the same reason: V6 (SPEC §5.2, now also
  // checked inline by `apply()`'s own `relationship.create`/`restore`,
  // src/engine/deltas.ts) forbids two live relationships sharing
  // `(type, from, to)` even for the instant between X's replay of theirs'
  // own create and M's own resolution — leaving ours' copy live across
  // that replay, as the old single-retract-in-M shape did, would throw
  // there instead of resolving cleanly.
  for (const c of choices) {
    if (c.class !== 'duplicate-relationship') continue;
    const oursId = c.relationshipId;
    const theirsId = c.relatedRelationshipId;
    const oursRow = ours.relationships.get(oursId);
    const theirsRow = theirs.relationships.get(theirsId);
    if (!oursRow || !theirsRow) throw new EngineError(`buildStructuralResolutions: duplicate-relationship choice for ${oursId}/${theirsId} references an unknown relationship`);
    const prepId = mintId();
    prepDeltas.push(relationshipRetractDelta(prepId, oursId, oursRow.relationshipType, oursRow.existsDeltaId, sourceId));
    if (c.keep === 'ours') {
      const retractTheirsId = mintId();
      mergeDeltas.push(relationshipRetractDelta(retractTheirsId, theirsId, theirsRow.relationshipType, theirsRow.existsDeltaId, sourceId));
      const restoreOursId = mintId();
      mergeDeltas.push(relationshipRestoreDelta(restoreOursId, oursId, oursRow.relationshipType, prepId, sourceId));
      resolvedConflicts.push({ winningDeltaId: oursRow.existsDeltaId, discardedDeltaId: theirsRow.existsDeltaId, resolutionDeltaId: restoreOursId, rationale: 'survivor' });
    } else {
      resolvedConflicts.push({ winningDeltaId: theirsRow.existsDeltaId, discardedDeltaId: oursRow.existsDeltaId, resolutionDeltaId: prepId, rationale: 'survivor' });
    }
  }

  // ---- cardinality: primary/role pick (ADR-021 §4.3) ----
  for (const c of choices) {
    if (c.class !== 'cardinality') continue;
    const oId = c.relationshipId;
    const tId = c.relatedRelationshipId;
    const oRow = ours.relationships.get(oId);
    const tRow = theirs.relationships.get(tId);
    if (!oRow || !tRow) throw new EngineError(`buildStructuralResolutions: cardinality choice for ${oId}/${tId} references an unknown relationship`);
    const oRoleDeltaId = currentDeltaId(ours, oId, 'role');
    const tRoleDeltaId = currentDeltaId(theirs, tId, 'role');
    const isSupports = oRow.relationshipType === 'supports';

    if (isSupports) {
      const prepId = mintId();
      prepDeltas.push(relationshipUpdateRoleDelta(prepId, oId, 'supports', 'secondary', oRoleDeltaId, sourceId));
      if (c.keep === 'ours') {
        const demoteTId = mintId();
        mergeDeltas.push(relationshipUpdateRoleDelta(demoteTId, tId, 'supports', 'secondary', tRoleDeltaId, sourceId));
        const restoreOId = mintId();
        mergeDeltas.push(relationshipUpdateRoleDelta(restoreOId, oId, 'supports', 'primary', prepId, sourceId));
        resolvedConflicts.push({ winningDeltaId: oRoleDeltaId, discardedDeltaId: tRoleDeltaId, resolutionDeltaId: restoreOId, rationale: 'primary' });
      } else {
        resolvedConflicts.push({ winningDeltaId: tRoleDeltaId, discardedDeltaId: oRoleDeltaId, resolutionDeltaId: prepId, rationale: 'primary' });
      }
    } else {
      // owns (ADR-021 §4.3, resolved sub-question): no neutral role value —
      // P retracts R_o outright, both choices, since it would otherwise
      // block X's replay of R_t's promotion regardless of who eventually wins.
      const prepId = mintId();
      prepDeltas.push(relationshipRetractDelta(prepId, oId, 'owns', oRow.existsDeltaId, sourceId));
      if (c.keep === 'ours') {
        const retractTId = mintId();
        mergeDeltas.push(relationshipRetractDelta(retractTId, tId, 'owns', tRow.existsDeltaId, sourceId));
        const restoreOId = mintId();
        mergeDeltas.push(relationshipRestoreDelta(restoreOId, oId, 'owns', prepId, sourceId));
        resolvedConflicts.push({ winningDeltaId: oRoleDeltaId, discardedDeltaId: tRoleDeltaId, resolutionDeltaId: restoreOId, rationale: 'primary' });
      } else {
        resolvedConflicts.push({ winningDeltaId: tRoleDeltaId, discardedDeltaId: oRoleDeltaId, resolutionDeltaId: prepId, rationale: 'primary' });
      }
    }
  }

  return { prepDeltas, mergeDeltas, resolvedConflicts };
}
