/**
 * Merge conflict classification (SPEC-data-model.md §7.3): lifts
 * src/engine/branch.ts's per-fact-key three-way diff to the element level,
 * producing the conflict classes the review queue (UI-principles.md §5.3)
 * renders. Pure: takes already-folded `Head`s and an already-computed
 * `FieldDiff[]`, no I/O.
 *
 * Two classes from the spec's table are approximated or deferred here,
 * both documented at their point of use rather than silently skipped:
 *  - "identity" (weak, §8 rule 3's name+type+context match) uses exact
 *    normalised-name equality here, not the capture pipeline's fuzzy
 *    trigram similarity — a real, useful special case (an exact duplicate)
 *    that doesn't need §8's matching infrastructure to be worth flagging.
 *    Upgrading it to fuzzy matching later doesn't change this module's
 *    contract, only how many pairs it finds.
 *  - "identity (strong)" (matching `aliases` rows) needs the `aliases`
 *    table, which this pure engine module has no access to. It's an
 *    optional input (`aliasesByElementId`); omitting it just means this one
 *    check doesn't run, rather than faking a result.
 */

import { EXISTS_ATTRIBUTE, type UUID } from '../contracts/delta';
import { threeWayDiff, type FieldDiff, type ThreeWayDiff } from './branch';
import type { ElementRow, Head } from './deltas';
import type { CommitLoader } from './head';
import { IDENTITY_TRIGRAM_THRESHOLD, trigramSimilarity } from './trigram';

export type ConflictClass =
  | 'field-conflict'
  | 'structural:retract-vs-modify'
  | 'structural:dangling-endpoint'
  | 'structural:dangling-parent'
  | 'structural:duplicate-relationship'
  | 'structural:cardinality'
  | 'structural:converged-retract'
  | 'identity'
  | 'identity:strong';

export const BLOCKING_CONFLICT_CLASSES: readonly ConflictClass[] = [
  'field-conflict',
  'structural:retract-vs-modify',
  'structural:dangling-endpoint',
  'structural:dangling-parent',
  'structural:duplicate-relationship',
  'structural:cardinality',
];

export interface ConflictFinding {
  class: ConflictClass;
  blocking: boolean;
  subjectId: UUID;
  relatedSubjectId?: UUID;
  /** Set for `field-conflict` findings — one finding per contested field, matching SPEC §7.4's "one card per fact key". */
  attribute?: string;
  detail: string;
}

export interface MergeClassification {
  findings: ConflictFinding[];
  hasBlockingConflict: boolean;
  /** Subjects with at least one changed field, but no blocking or identity finding attached — SPEC §7.4's "Clean changes" section. */
  clean: UUID[];
}

export interface MergeClassifyInput {
  base: Head;
  ours: Head;
  theirs: Head;
  fields: readonly FieldDiff[];
}

export interface MergeClassifyOptions {
  /** Element id → its known alias values, for the "identity (strong)" check. Supply this once src/db can query `aliases`; omit to skip just that one check. */
  aliasesByElementId?: ReadonlyMap<UUID, readonly string[]>;
}

function finding(
  conflictClass: ConflictClass,
  blocking: boolean,
  subjectId: UUID,
  detail: string,
  extra?: { relatedSubjectId?: UUID; attribute?: string },
): ConflictFinding {
  return {
    class: conflictClass,
    blocking,
    subjectId,
    detail,
    ...(extra?.relatedSubjectId !== undefined ? { relatedSubjectId: extra.relatedSubjectId } : {}),
    ...(extra?.attribute !== undefined ? { attribute: extra.attribute } : {}),
  };
}

function existsIn(head: Head, id: UUID): boolean {
  return head.elements.has(id) || head.relationships.has(id);
}

/** New relative to `base`: present in `head`, absent (by id) in `base`. */
function newEntriesOf<T>(head: ReadonlyMap<UUID, T>, base: Head): [UUID, T][] {
  return [...head].filter(([id]) => !existsIn(base, id));
}

/**
 * Trim + lower-case, no fancier normalisation than that — the identity
 * check this module's own `classifyMerge` uses is deliberately exact,
 * not fuzzy (see `trigramSimilarity`'s own call site below for where
 * fuzziness enters instead). Exported so the capture pipeline's own
 * exact-name comparisons (`src/capture/normalise.ts`, `importRowSchema.ts`)
 * reuse this exact definition rather than drifting from it with a second,
 * slightly-different one.
 */
export const normalizeName = (name: string): string => name.trim().toLowerCase();

/** A non-empty, trimmed, lower-cased string, or `undefined` for anything else (absent, blank, or not a string at all — `attributes` is loosely typed `Json`). */
function normalizedContextString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Every actor with a live `owns` relationship into `elementId` — E7's "owner" context signal; ownership in this schema is a relationship, not an attribute, so this reads `head.relationships` rather than `head.elements`. */
function ownerActorIds(head: Head, elementId: UUID): Set<UUID> {
  const ids = new Set<UUID>();
  for (const rel of head.relationships.values()) {
    if (rel.relationshipType === 'owns' && rel.toElementId === elementId) ids.add(rel.fromElementId);
  }
  return ids;
}

/**
 * E7's own "name + context: owner, vendor, description" — corroboration
 * for a fuzzy name match, additive over the pre-E7 baseline (same
 * `parentId`) rather than a replacement for it: capabilities/containers
 * keep matching exactly as before (SPEC §8 point 3's own "the proposed
 * parent resolves to the same parent," reused here); systems and actors
 * (SPEC §8's own "the context is the type alone" — no parent worth
 * comparing) get a real signal from `vendor`/`description`/a shared owning
 * actor instead of falling back to name-and-type alone. Any one signal
 * agreeing is enough — this is corroboration for an already-fuzzy name
 * match, not a second independent gate.
 */
function identityContextCorroborates(ours: Head, theirs: Head, oid: UUID, tid: UUID, orow: ElementRow, trow: ElementRow): boolean {
  // `!== null` matters: most systems/actors have no parent at all, so
  // `null === null` would trivially "corroborate" every one of them,
  // defeating the point of requiring context for exactly the element
  // types SPEC §8 itself says have none worth comparing.
  if (orow.parentId !== null && orow.parentId === trow.parentId) return true;

  const oVendor = normalizedContextString((orow.attributes as Record<string, unknown>).vendor);
  const tVendor = normalizedContextString((trow.attributes as Record<string, unknown>).vendor);
  if (oVendor !== undefined && oVendor === tVendor) return true;

  const oDescription = normalizedContextString((orow.attributes as Record<string, unknown>).description);
  const tDescription = normalizedContextString((trow.attributes as Record<string, unknown>).description);
  if (oDescription !== undefined && oDescription === tDescription) return true;

  const oOwners = ownerActorIds(ours, oid);
  const tOwners = ownerActorIds(theirs, tid);
  for (const id of oOwners) if (tOwners.has(id)) return true;

  return false;
}

export function classifyMerge(input: MergeClassifyInput, options: MergeClassifyOptions = {}): MergeClassification {
  const { base, ours, theirs, fields } = input;
  const findings: ConflictFinding[] = [];

  const subjectsTouched = new Set<UUID>();
  const fieldsBySubject = new Map<UUID, FieldDiff[]>();
  for (const f of fields) {
    subjectsTouched.add(f.subjectId);
    const list = fieldsBySubject.get(f.subjectId);
    if (list) list.push(f);
    else fieldsBySubject.set(f.subjectId, [f]);
  }

  const blockingSubjects = new Set<UUID>();
  const identitySubjects = new Set<UUID>();
  const nonBlockingStructuralSubjects = new Set<UUID>();

  // ---- field-conflict: subject exists on both sides, some non-existence field disagrees. ----
  for (const [subjectId, subjectFields] of fieldsBySubject) {
    if (!existsIn(ours, subjectId) || !existsIn(theirs, subjectId)) continue;
    for (const f of subjectFields) {
      if (f.attribute === EXISTS_ATTRIBUTE || f.classification !== 'FIELD_CONFLICT') continue;
      findings.push(finding('field-conflict', true, subjectId, `both sides changed "${f.attribute}" to different values`, { attribute: f.attribute }));
      blockingSubjects.add(subjectId);
    }
  }

  // ---- one-sided retractions: existed at base, exists on exactly one side now. ----
  // Both sides retracting the same subject (existed at base, gone on both) is
  // its own case — "converged existence" (ADR-021 §1.3.1) — a plain refresh
  // with zero conflicts used to throw here (replaying the other side's
  // retract onto a head where this side already removed it), so it gets a
  // non-blocking finding purely so the resolution builder has something to
  // attach its automatic `restore`-then-replay fix-up to (ADR-021 §4.1's
  // "converged retraction" — never a card, resolved without asking).
  const oneSidedRetractions = new Map<UUID, { retractedSide: 'ours' | 'theirs'; keepingSide: 'ours' | 'theirs' }>();
  for (const subjectId of subjectsTouched) {
    if (!existsIn(base, subjectId)) continue;
    const inOurs = existsIn(ours, subjectId);
    const inTheirs = existsIn(theirs, subjectId);
    if (inOurs === inTheirs) {
      if (!inOurs) {
        findings.push(finding('structural:converged-retract', false, subjectId, 'both sides retracted this element'));
        nonBlockingStructuralSubjects.add(subjectId);
      }
      continue;
    }
    oneSidedRetractions.set(subjectId, { retractedSide: inOurs ? 'theirs' : 'ours', keepingSide: inOurs ? 'ours' : 'theirs' });
  }

  for (const [subjectId, { retractedSide, keepingSide }] of oneSidedRetractions) {
    const keepingHead = keepingSide === 'ours' ? ours : theirs;

    // structural: retract-vs-modify — the keeping side actually asserted a
    // new fact for some (non-existence) attribute, not just carried the
    // base value forward. Checked directly against `f.base`/`f.ours`/
    // `f.theirs`'s deltaId, NOT `f.classification`: retracting a subject
    // clears every one of its facts, so from the per-key diff's point of
    // view the retracting side "changed" every attribute too (to absent) —
    // meaning a real modification on the keeping side reads as
    // FIELD_CONFLICT there (both sides differ from base), not OURS/THEIRS.
    // Relying on the classification label would make this check never
    // fire; comparing deltaIds directly sidesteps that entirely.
    const subjectFields = fieldsBySubject.get(subjectId) ?? [];
    const realModification = subjectFields.some((f) => {
      if (f.attribute === EXISTS_ATTRIBUTE) return false;
      const keepingFact = keepingSide === 'ours' ? f.ours : f.theirs;
      return keepingFact?.deltaId !== f.base?.deltaId;
    });
    if (realModification) {
      findings.push(finding('structural:retract-vs-modify', true, subjectId, `retracted on ${retractedSide}, modified on ${keepingSide}`));
      blockingSubjects.add(subjectId);
    }

    // structural: dangling-endpoint — a relationship newly created on the
    // keeping side references the retracted subject as an endpoint.
    for (const [relId, rel] of newEntriesOf(keepingHead.relationships, base)) {
      if (rel.fromElementId === subjectId || rel.toElementId === subjectId) {
        findings.push(
          finding('structural:dangling-endpoint', true, subjectId, `a relationship created on ${keepingSide} references the element retracted on ${retractedSide}`, {
            relatedSubjectId: relId,
          }),
        );
        blockingSubjects.add(subjectId);
      }
    }
  }

  // structural: dangling-parent — a parentId change (create or reparent) on
  // one side points at an element retracted on the other.
  for (const f of fields) {
    if (f.attribute !== 'parentId' || (f.classification !== 'OURS' && f.classification !== 'THEIRS')) continue;
    const side: 'ours' | 'theirs' = f.classification === 'OURS' ? 'ours' : 'theirs';
    const newParentId = (side === 'ours' ? f.ours : f.theirs)?.value;
    if (typeof newParentId !== 'string') continue;
    const retraction = oneSidedRetractions.get(newParentId);
    if (retraction?.keepingSide === side) {
      findings.push(
        finding('structural:dangling-parent', true, f.subjectId, `re-parented under an element retracted on ${retraction.retractedSide}`, { relatedSubjectId: newParentId }),
      );
      blockingSubjects.add(f.subjectId);
    }
  }

  // ---- structural: duplicate-relationship — compare relationships new on both sides. ----
  const newRelsOurs = newEntriesOf(ours.relationships, base);
  const newRelsTheirs = newEntriesOf(theirs.relationships, base);
  for (const [oid, orow] of newRelsOurs) {
    for (const [tid, trow] of newRelsTheirs) {
      if (oid === tid) continue;
      if (orow.relationshipType === trow.relationshipType && orow.fromElementId === trow.fromElementId && orow.toElementId === trow.toElementId) {
        findings.push(
          finding('structural:duplicate-relationship', true, oid, `both sides independently created a ${orow.relationshipType} relationship ${orow.fromElementId} -> ${orow.toElementId}`, {
            relatedSubjectId: tid,
          }),
        );
        blockingSubjects.add(oid);
        blockingSubjects.add(tid);
      }
    }
  }

  // ---- structural: cardinality (ADR-021 §5 item 2) ----
  // A `role` field newly asserted on one side — whether the relationship is
  // brand new (its initial attributes are still "new relative to base" per
  // the per-key diff, SPEC §7.2) or an existing relationship promoted to a
  // new role — collides with the same anchor+value newly asserted on the
  // other side, on a *different* relationship. Covers both cardinality
  // shapes in one pass: `supports.role = 'primary'` (anchor = fromElementId,
  // the only value with a cardinality limit — 'secondary' has none) and
  // `owns.role` of any value (anchor = toElementId, each role capped
  // independently, Prompt 7k item 2). Only OURS/THEIRS-classified fields
  // qualify: a promotion nobody opposed. Both-sides-changed-the-same-
  // relationship's role is FIELD_CONFLICT (different values) or CONVERGED
  // (same value) — a single relationship's own field conflict, not a
  // collision between two relationships, and not this check's concern.
  // A pre-existing primary/role holder neither side touched never appears
  // here (its field classification is UNCHANGED) — and needs no finding:
  // whichever side promotes a new holder must, by C17, have first demoted
  // or retracted the old one within its own commit history, so replaying
  // that side's exclusive commits in order demotes it before promoting the
  // new one, with no collision ever reaching `apply`.
  const cardinalityCandidates = new Map<string, { side: 'ours' | 'theirs'; relationshipId: UUID; value: string }[]>();
  for (const f of fields) {
    if (f.attribute !== 'role' || (f.classification !== 'OURS' && f.classification !== 'THEIRS')) continue;
    const side: 'ours' | 'theirs' = f.classification === 'OURS' ? 'ours' : 'theirs';
    const sideHead = side === 'ours' ? ours : theirs;
    const rel = sideHead.relationships.get(f.subjectId);
    if (!rel) continue;
    const value = (side === 'ours' ? f.ours : f.theirs)?.value;
    let anchorElementId: UUID | undefined;
    let candidateValue: string | undefined;
    if (rel.relationshipType === 'supports' && value === 'primary') {
      anchorElementId = rel.fromElementId;
      candidateValue = value;
    } else if (rel.relationshipType === 'owns' && typeof value === 'string') {
      anchorElementId = rel.toElementId;
      candidateValue = value;
    }
    if (!anchorElementId || candidateValue === undefined) continue;
    const key = `${rel.relationshipType}:${anchorElementId}:${candidateValue}`;
    const entry = { side, relationshipId: f.subjectId, value: candidateValue };
    const list = cardinalityCandidates.get(key);
    if (list) list.push(entry);
    else cardinalityCandidates.set(key, [entry]);
  }
  for (const candidates of cardinalityCandidates.values()) {
    const oursEntries = candidates.filter((c) => c.side === 'ours');
    const theirsEntries = candidates.filter((c) => c.side === 'theirs');
    for (const o of oursEntries) {
      const orow = ours.relationships.get(o.relationshipId);
      if (!orow) continue;
      for (const t of theirsEntries) {
        if (o.relationshipId === t.relationshipId) continue;
        const noun = orow.relationshipType === 'supports' ? 'a primary supports' : `an owns (${o.value})`;
        findings.push(
          finding('structural:cardinality', true, o.relationshipId, `both sides asserted ${noun} relationship on the same anchor`, { relatedSubjectId: t.relationshipId }),
        );
        blockingSubjects.add(o.relationshipId);
        blockingSubjects.add(t.relationshipId);
      }
    }
  }

  // ---- identity (weak): both sides created an element of the same type, with a fuzzy-matching name and corroborating context (E7 — trigram similarity ≥ IDENTITY_TRIGRAM_THRESHOLD, replacing the exact-name-equality this check used before). ----
  const newElsOurs = newEntriesOf(ours.elements, base);
  const newElsTheirs = newEntriesOf(theirs.elements, base);
  for (const [oid, orow] of newElsOurs) {
    for (const [tid, trow] of newElsTheirs) {
      if (oid === tid) continue;
      if (orow.elementType !== trow.elementType) continue;
      const nameSimilarity = trigramSimilarity(normalizeName(orow.name), normalizeName(trow.name));
      if (nameSimilarity < IDENTITY_TRIGRAM_THRESHOLD) continue;
      // An exact name match keeps the pre-E7 rule unchanged (same parentId,
      // including the trivial null-vs-null case for systems/actors) — only a
      // genuinely fuzzy match needs identityContextCorroborates's stronger bar.
      if (nameSimilarity === 1) {
        if (orow.parentId !== trow.parentId) continue;
      } else if (!identityContextCorroborates(ours, theirs, oid, tid, orow, trow)) {
        continue;
      }
      const detail = orow.name === trow.name ? `both sides created a ${orow.elementType} named "${orow.name}"` : `both sides created a similarly-named ${orow.elementType} ("${orow.name}" / "${trow.name}")`;
      findings.push(finding('identity', false, oid, detail, { relatedSubjectId: tid }));
      identitySubjects.add(oid);
      identitySubjects.add(tid);
    }
  }

  // ---- identity (strong): matching alias, only if the caller supplied alias data. ----
  if (options.aliasesByElementId) {
    const aliasesOf = (id: UUID) => options.aliasesByElementId?.get(id) ?? [];
    for (const [oid] of newElsOurs) {
      for (const [tid] of newElsTheirs) {
        if (oid === tid) continue;
        if (aliasesOf(oid).some((a) => aliasesOf(tid).includes(a))) {
          findings.push(finding('identity:strong', false, oid, 'both sides created an element sharing a known alias', { relatedSubjectId: tid }));
          identitySubjects.add(oid);
          identitySubjects.add(tid);
        }
      }
    }
  }

  const clean = [...subjectsTouched].filter((id) => !blockingSubjects.has(id) && !identitySubjects.has(id) && !nonBlockingStructuralSubjects.has(id));

  return { findings, hasBlockingConflict: findings.some((f) => f.blocking), clean };
}

export interface MergeReview {
  threeWay: ThreeWayDiff;
  classification: MergeClassification;
}

/**
 * The review queue's whole computation in one call (Sprint C1 step 7):
 * `threeWayDiff` then `classifyMerge` on its own output — every caller
 * that needs a branch's merge review (submitting a request, viewing the
 * queue, re-checking after a refresh) wants both together, not one without
 * the other.
 */
export function computeMergeReview(branchHeadCommitId: UUID, mainHeadCommitId: UUID, loader: CommitLoader, options: MergeClassifyOptions = {}): MergeReview {
  const threeWay = threeWayDiff(branchHeadCommitId, mainHeadCommitId, loader);
  const classification = classifyMerge({ base: threeWay.base, ours: threeWay.ours, theirs: threeWay.theirs, fields: threeWay.fields }, options);
  return { threeWay, classification };
}
