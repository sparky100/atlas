/**
 * Sprint C2 (Prompt 7b), ADR-006's amendment step 2: "the split respects
 * dependencies, computed before it is offered for confirmation: accepting
 * a relationship whose endpoint is an unaccepted new element pulls that
 * element into the split too... Retracting an element that other,
 * unaccepted deltas on the branch still depend on is blocked, with the
 * dependency named as the reason, rather than silently splitting it away."
 *
 * Pure: takes the branch's own deltas since its merge base (`branch.ts`'s
 * `listOwnDeltas`) and the merge base's own folded `Head` (for looking up
 * relationships that already exist in main and reference something the
 * branch retracts) — no I/O, so a closure preview can be computed and
 * shown before anything commits.
 *
 * Two different treatments for two different directions, deliberately not
 * symmetric:
 *  - **Pull-in** (a new relationship's new endpoint, a new child's new
 *    parent): silently included. These are additive — nothing is lost by
 *    including a bit more than the reviewer explicitly checked, and
 *    requiring them to tick every dependency by hand would just be
 *    busywork the UI can do for them.
 *  - **Block** (a retract whose dependent is *not* also being retracted):
 *    never silently resolved by pulling the dependent's own retraction in
 *    too — that would silently delete something the reviewer never
 *    selected. The retract is refused instead, with the dependency named,
 *    so the reviewer makes that call explicitly (by also selecting the
 *    dependent, or leaving the retract for a later split).
 *
 * The property this is built to satisfy (Prompt 7b step 1's own test):
 * folding `accepted ∪ pulledIn`'s own deltas over the merge base always
 * yields a head that passes C8 (no live relationship references a
 * retracted element) and C9 (every relationship's own type-triple stays
 * legal — trivially true here, since a split never changes a
 * relationship's own type or endpoints, only whether it's included at
 * all) — see splitClosure.property.test.ts, which checks this by actually
 * folding the result with the same `apply`/`fold` every other commit path
 * uses, not by re-deriving the guarantee by a separate argument.
 */
import { factKeyOf, type Delta, type UUID } from '../contracts/delta';
import type { OwnDeltaOrigin } from './branch';
import { cloneHead, factMapKey, fold, type CommitContext, type Head } from './deltas';

export type SplitSubjectType = 'element' | 'relationship';

export interface SplitBlockedRetract {
  /** The element whose retract can't be split off alone. */
  subjectId: UUID;
  /** The thing that still needs `subjectId` to exist. */
  dependentSubjectId: UUID;
  dependentSubjectType: SplitSubjectType;
  /** Whether the dependent is a pre-existing (already in main, untouched by this branch) relationship, or one the branch itself created/still keeps live. Display-relevant: a pre-existing dependent can never be resolved by *this* split (the branch has no delta for it at all) — an own-branch one can, by also selecting it. */
  dependentIsPreExisting: boolean;
}

export interface SplitClosureResult {
  /** The caller's own selection, plus anything pulled in, minus anything blocked — every id here is safe to include in the split's own fresh commit. */
  accepted: ReadonlySet<UUID>;
  /** Ids added beyond the caller's own selection, because something accepted needs them. Always a subset of `accepted`. */
  pulledIn: ReadonlySet<UUID>;
  /** A retract the caller selected that could not be included — removed from `accepted`. */
  blocked: SplitBlockedRetract[];
}

interface SubjectInfo {
  subjectId: UUID;
  subjectType: SplitSubjectType;
  /** A create delta for this subject appears among the branch's own deltas — as opposed to a subject that already existed at the merge base and is merely updated/retracted here. */
  createdOnBranch: boolean;
  /** The net effect of the branch's own deltas on this subject, by the branch's current head: retracted (its last lifecycle delta is a retract), or live (created/updated/restored, possibly after an earlier retract-then-restore). */
  netRetracted: boolean;
  /** Elements only: the parent id in effect after the branch's own updates — `undefined` for a relationship, or an element this branch never touches the parent of. */
  parentId?: UUID | null;
  /** Relationships only, and only when `createdOnBranch` — a pre-existing relationship's endpoints are read from the merge base head instead, never from here. */
  fromElementId?: UUID;
  toElementId?: UUID;
}

function subjectIdOf(delta: Delta): UUID {
  return 'elementId' in delta ? delta.elementId : delta.relationshipId;
}

function subjectTypeOf(delta: Delta): SplitSubjectType {
  return delta.kind.startsWith('element.') ? 'element' : 'relationship';
}

/** Classifies every subject the branch's own deltas touch, in delta order — the input every other function here works from. */
function classifyBranchSubjects(branchDeltas: readonly Delta[]): Map<UUID, SubjectInfo> {
  const bySubject = new Map<UUID, SubjectInfo>();
  for (const delta of branchDeltas) {
    const id = subjectIdOf(delta);
    let info = bySubject.get(id);
    if (!info) {
      info = { subjectId: id, subjectType: subjectTypeOf(delta), createdOnBranch: false, netRetracted: false };
      bySubject.set(id, info);
    }
    switch (delta.kind) {
      case 'element.create':
        info.createdOnBranch = true;
        info.netRetracted = false;
        info.parentId = delta.parentId;
        break;
      case 'element.update':
        if (delta.attribute === 'parentId') info.parentId = delta.value;
        break;
      case 'element.retract':
        info.netRetracted = true;
        break;
      case 'element.restore':
        info.netRetracted = false;
        break;
      case 'relationship.create':
        info.createdOnBranch = true;
        info.netRetracted = false;
        info.fromElementId = delta.fromElementId;
        info.toElementId = delta.toElementId;
        break;
      case 'relationship.update':
        break;
      case 'relationship.retract':
        info.netRetracted = true;
        break;
      case 'relationship.restore':
        info.netRetracted = false;
        break;
    }
  }
  return bySubject;
}

/**
 * The dependency-closure computation itself. `branchDeltas` is the
 * branch's own deltas since its merge base (`branch.ts`'s `listOwnDeltas`,
 * in the same seq order they were committed); `baseHead` is the merge
 * base's own folded `Head` (`branch.ts`'s `asIs`, or an equivalent fold) —
 * every relationship main already has, for the block check below.
 */
export function computeSplitClosure(branchDeltas: readonly Delta[], baseHead: Head, requestedSubjectIds: ReadonlySet<UUID>): SplitClosureResult {
  const bySubject = classifyBranchSubjects(branchDeltas);
  const included = new Set<UUID>();
  for (const id of requestedSubjectIds) if (bySubject.has(id)) included.add(id);

  // --- Pull-in: a new relationship's new endpoints; a new element's new parent. ---
  const pulledIn = new Set<UUID>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of included) {
      const info = bySubject.get(id);
      if (!info?.createdOnBranch) continue;
      const deps: UUID[] = [];
      if (info.subjectType === 'relationship') {
        if (info.fromElementId !== undefined) deps.push(info.fromElementId);
        if (info.toElementId !== undefined) deps.push(info.toElementId);
      } else if (info.parentId) {
        deps.push(info.parentId);
      }
      for (const depId of deps) {
        // Only a dependency this branch itself created needs pulling in —
        // one that already existed at the merge base is already in main,
        // needing nothing from this split.
        if (bySubject.get(depId)?.createdOnBranch && !included.has(depId)) {
          included.add(depId);
          pulledIn.add(depId);
          changed = true;
        }
      }
    }
  }

  // --- Block: a retract whose dependent — in the branch's own changeset,
  // or already live in main — isn't also being retracted by this split. ---
  const blocked: SplitBlockedRetract[] = [];
  for (const id of [...included]) {
    const info = bySubject.get(id);
    if (info?.subjectType !== 'element' || !info.netRetracted) continue;

    // Pre-existing relationships in main referencing this element — the
    // branch has no delta for these at all unless it also retracted them
    // (in which case they show up in `bySubject` too, and are excluded
    // below by their own `netRetracted` check).
    let dependent: { id: UUID; type: SplitSubjectType; preExisting: boolean } | undefined;
    for (const [relId, rel] of baseHead.relationships) {
      if (rel.fromElementId !== id && rel.toElementId !== id) continue;
      const relInfo = bySubject.get(relId);
      const retractedInSplit = relInfo?.netRetracted === true && included.has(relId);
      if (!retractedInSplit) {
        dependent = { id: relId, type: 'relationship', preExisting: true };
        break;
      }
    }

    // Relationships the branch itself created, referencing this element,
    // that remain live and would be included in the split.
    if (!dependent) {
      for (const [otherId, otherInfo] of bySubject) {
        if (otherInfo.subjectType !== 'relationship' || !otherInfo.createdOnBranch) continue;
        if (otherInfo.fromElementId !== id && otherInfo.toElementId !== id) continue;
        if (included.has(otherId) && !otherInfo.netRetracted) {
          dependent = { id: otherId, type: 'relationship', preExisting: false };
          break;
        }
      }
    }

    if (dependent) {
      included.delete(id);
      pulledIn.delete(id);
      blocked.push({ subjectId: id, dependentSubjectId: dependent.id, dependentSubjectType: dependent.type, dependentIsPreExisting: dependent.preExisting });
    }
  }

  return { accepted: included, pulledIn, blocked };
}

const SCRATCH_CTX: CommitContext = { authorId: 'split-scratch', createdAt: '1970-01-01T00:00:00.000Z' };

/** `create`/`retract`/`restore`, for either subject type — the delta kinds that toggle whether a subject exists at all, as opposed to an `update`'s attribute value. */
function isExistenceKind(kind: Delta['kind']): boolean {
  return kind !== 'element.update' && kind !== 'element.update_custom' && kind !== 'relationship.update' && kind !== 'relationship.update_custom';
}

/**
 * Would applying `delta` to `head` actually change anything? Used to drop
 * an existence-toggle that's redundant against the split's own
 * accumulating state (ADR-021 §5 item 4, below) — most often a
 * `preparation`-kind delta that was only ever mechanical scaffolding, but
 * checked structurally rather than by commit kind (see that function's own
 * doc comment for why).
 */
function wouldChangeState(head: Head, delta: Delta): boolean {
  switch (delta.kind) {
    case 'element.create':
    case 'relationship.create':
      return true;
    case 'element.retract':
      return head.elements.has(delta.elementId);
    case 'element.restore':
      return !head.elements.has(delta.elementId);
    case 'relationship.retract':
      return head.relationships.has(delta.relationshipId);
    case 'relationship.restore':
      return !head.relationships.has(delta.relationshipId);
    case 'element.update':
    case 'element.update_custom':
    case 'relationship.update':
    case 'relationship.update_custom': {
      const { subjectId, attribute } = factKeyOf(delta);
      return head.facts.get(factMapKey(subjectId, attribute))?.value !== delta.value;
    }
  }
}

/** ADR-021 §5 item 4's own ordering: element restores and creates, then relationship creates, then updates, then relationship retracts, then element retracts. */
function bucketOf(kind: Delta['kind']): number {
  switch (kind) {
    case 'element.restore':
    case 'element.create':
      return 1;
    case 'relationship.create':
      return 2;
    case 'element.update':
    case 'element.update_custom':
    case 'relationship.update':
    case 'relationship.update_custom':
      return 3;
    case 'relationship.retract':
      return 4;
    case 'element.retract':
      return 5;
    case 'relationship.restore':
      // Not named in the ADR's own list (its five buckets are written for
      // the shapes ADR-021 §4's own sequences actually produce, and a
      // relationship.restore there is always the *last* own-delta for its
      // subject already — §4.1 Case B's rrestore(S_i)/rrestore(Q)).
      // Grouped with the other "bring something back" bucket rather than
      // invented a sixth one for a single-caller shape.
      return 1;
  }
}

/**
 * The split's own fresh deltas (ADR-006 amendment step 2: "writes one
 * fresh commit whose deltas are the closure's effect folded over the
 * merge base... never copied delta rows"). For every subject in
 * `closure.accepted`, replays that subject's own branch deltas verbatim
 * — same `id`... no: a *fresh* `id` (CLAUDE.md rule 6 — no `Math.random`)
 * — and `previousDeltaId` re-pointed to whatever this split's own
 * accumulating state (starting from `baseHead`, the current merge base)
 * currently asserts for that fact key, not the original branch's own
 * chain (which the split's fresh commit has no ancestry relationship
 * with). Deltas for subjects not in `closure.accepted` are dropped
 * entirely — they stay behind on the original branch, untouched (rule 1:
 * "the remainder... stays on the original branch").
 *
 * `origins` (`branch.ts`'s `listOwnDeltaOrigins`) carries each delta's
 * originating commit kind — needed not because the kind itself matters to
 * this function (it doesn't check it directly), but because only
 * `listOwnDeltaOrigins`, not the plain `listOwnDeltas`, has the per-commit
 * granularity this needs to reconstruct chronological order across a
 * branch that has been through one or more resolved refreshes.
 *
 * ADR-021 §5 item 4, §1.3.3's own bug: after a structurally-resolved
 * refresh, a subject's own existence can be toggled more than once within
 * the branch's own history — retracted, then a `preparation` commit
 * restores it so main's exclusive commits could replay, then the `merge`
 * commit's own decision either re-retracts it (keep-retraction) or leaves
 * it restored (keep-element). Naively replaying every one of those steps
 * verbatim, in original order, over the *current* merge base (which, after
 * the refresh, already reflects main's own state) fails in both
 * directions: the base may already hold what an earlier step assumed it
 * didn't (a redundant `restore`), or a later step may re-establish exactly
 * what an earlier one already achieved (two retracts of the same subject).
 * Three passes fix this without needing a full net-effect diff rebuild —
 * every surviving delta is still one of the branch's own real delta rows,
 * just fewer of them and correctly re-anchored:
 *
 * 1. **Collapse each subject's own existence-toggle chain** (`create`/
 *    `retract`/`restore`, on either subject type) to just its
 *    chronologically *last* delta — the one that actually determines the
 *    branch's own current existence state for that subject, however many
 *    commits (manual, preparation, merge) touched it along the way.
 *    Attribute `update`s are never collapsed — always kept, verbatim, in
 *    original order, preserving per-attribute provenance exactly as
 *    before; only existence toggling is a candidate.
 * 2. **Order across subjects by dependency** (the bucket order above),
 *    stable within each bucket — a real, separate concern from step 1:
 *    even after collapsing, a relationship retract may still need to run
 *    before the element retract it made valid.
 * 3. **Re-anchor and drop what's still redundant.** Mint a fresh id, and
 *    look up `previousDeltaId` against this split's own accumulating state
 *    (a scratch clone of `baseHead`, using the real `apply`/`fold` so this
 *    stays consistent with every other fold in the codebase) rather than
 *    the branch's own historical chain, which the split has no ancestry
 *    relationship with. Before that: if the survivor from step 1 is
 *    *itself* still a no-op against the accumulating state (ADR-021 §4.1
 *    Case A's "keep element" — the branch's own restore ends up asserting
 *    exactly what the new base already holds, once main's own concurrent
 *    state is the starting point rather than the branch's original,
 *    pre-refresh one), it's dropped too — silently, not an error, since
 *    "already true" is exactly what it was trying to establish.
 */
export function buildSplitDeltas(origins: readonly OwnDeltaOrigin[], closure: SplitClosureResult, baseHead: Head, mintId: () => UUID): Delta[] {
  const accepted = origins.filter((o) => closure.accepted.has(subjectIdOf(o.delta)));

  const lastExistenceIndexBySubject = new Map<UUID, number>();
  accepted.forEach((o, i) => {
    if (isExistenceKind(o.delta.kind)) lastExistenceIndexBySubject.set(subjectIdOf(o.delta), i);
  });
  const collapsed = accepted.filter((o, i) => !isExistenceKind(o.delta.kind) || lastExistenceIndexBySubject.get(subjectIdOf(o.delta)) === i);

  const ordered = collapsed
    .map((o, i) => ({ o, i }))
    .sort((a, b) => bucketOf(a.o.delta.kind) - bucketOf(b.o.delta.kind) || a.i - b.i)
    .map(({ o }) => o.delta);

  const scratch = cloneHead(baseHead);
  const idMap = new Map<UUID, UUID>();
  const result: Delta[] = [];
  for (const delta of ordered) {
    if (isExistenceKind(delta.kind) && !wouldChangeState(scratch, delta)) continue;

    const freshId = mintId();
    idMap.set(delta.id, freshId);
    const rest = { ...delta, id: freshId };
    if ('previousDeltaId' in rest) {
      const mapped = idMap.get(rest.previousDeltaId);
      if (mapped) {
        rest.previousDeltaId = mapped;
      } else {
        // Not part of this split's own replayed set — anchor against
        // whatever this fact key currently asserts on the scratch head
        // (which starts as `baseHead` and accumulates every delta this
        // split has emitted so far), rather than blindly keeping the
        // original branch-historical id. For an ordinary key nothing here
        // has touched, that's exactly the original id anyway (baseHead's
        // own currently-asserting delta for an untouched key never
        // changed); for a key a collapsed-away delta had touched, this is
        // what actually makes the reference valid again.
        const { subjectId, attribute } = factKeyOf(delta);
        const currentFact = scratch.facts.get(factMapKey(subjectId, attribute));
        if (currentFact) rest.previousDeltaId = currentFact.deltaId;
      }
    }
    fold(scratch, [rest], SCRATCH_CTX);
    result.push(rest);
  }
  return result;
}
