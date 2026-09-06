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
import type { FieldDiff } from './branch';
import type { Head } from './deltas';

export type ConflictClass =
  | 'field-conflict'
  | 'structural:retract-vs-modify'
  | 'structural:dangling-endpoint'
  | 'structural:dangling-parent'
  | 'structural:duplicate-relationship'
  | 'structural:cardinality'
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

const normalizeName = (name: string): string => name.trim().toLowerCase();

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
  const oneSidedRetractions = new Map<UUID, { retractedSide: 'ours' | 'theirs'; keepingSide: 'ours' | 'theirs' }>();
  for (const subjectId of subjectsTouched) {
    if (!existsIn(base, subjectId)) continue;
    const inOurs = existsIn(ours, subjectId);
    const inTheirs = existsIn(theirs, subjectId);
    if (inOurs !== inTheirs) {
      oneSidedRetractions.set(subjectId, { retractedSide: inOurs ? 'theirs' : 'ours', keepingSide: inOurs ? 'ours' : 'theirs' });
    }
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

  // ---- structural: duplicate-relationship / cardinality — compare relationships new on both sides. ----
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
      if (orow.relationshipType === 'owns' && trow.relationshipType === 'owns' && orow.toElementId === trow.toElementId && orow.attributes.primary === true && trow.attributes.primary === true) {
        findings.push(
          finding('structural:cardinality', true, oid, `both sides created a primary owns relationship targeting ${orow.toElementId}`, { relatedSubjectId: tid }),
        );
        blockingSubjects.add(oid);
        blockingSubjects.add(tid);
      }
    }
  }

  // ---- identity (weak): both sides created an element of the same type, same normalised name, same parent. ----
  const newElsOurs = newEntriesOf(ours.elements, base);
  const newElsTheirs = newEntriesOf(theirs.elements, base);
  for (const [oid, orow] of newElsOurs) {
    for (const [tid, trow] of newElsTheirs) {
      if (oid === tid) continue;
      if (orow.elementType === trow.elementType && normalizeName(orow.name) === normalizeName(trow.name) && orow.parentId === trow.parentId) {
        findings.push(finding('identity', false, oid, `both sides created a ${orow.elementType} named "${orow.name}"`, { relatedSubjectId: tid }));
        identitySubjects.add(oid);
        identitySubjects.add(tid);
      }
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

  const clean = [...subjectsTouched].filter((id) => !blockingSubjects.has(id) && !identitySubjects.has(id));

  return { findings, hasBlockingConflict: findings.some((f) => f.blocking), clean };
}
