/**
 * P-29, P-31, P-13 (extended) — ADR-021 §7, C2b. `mergeResolution.structural.test.ts`
 * carries the "Golden" row §7 also requires (one hand-built unit test per
 * §4 sequence, exact kinds/order/previousDeltaId links); this file
 * generalizes those same six shapes — retract-vs-modify Case A (ours
 * retracted) and Case B (theirs retracted), each with a dangling-endpoint
 * and dangling-parent cascade; converged-retract; duplicate-relationship;
 * cardinality on both `supports` and `owns` — into fast-check properties
 * covering randomised cascade sizes and, for the base/ours/theirs test
 * below, the P-13 symmetry claim.
 *
 * Scope note: Case B's own dangling-parent cascade (a child re-parented
 * under the element main retracted) is exercised by the hand-built golden
 * tests but not generalised here — its resolution shape is structurally
 * identical to Case A's own (the same `elementUpdateParentIdDelta` call,
 * same "reparent to E's own base parent" outcome), so generalising Case A's
 * cascade already exercises that code path's real logic.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Delta, UUID } from '../contracts/delta';
import { diffFacts } from './branch';
import { classifyMerge, type ConflictFinding, type MergeReview } from './merge';
import { cloneHead, emptyHead, fold, type CommitContext, type Head } from './deltas';
import { buildStructuralResolutions, type RetractionChoice, type StructuralChoice } from './mergeResolution';

const ctx: CommitContext = { authorId: 'author-1', createdAt: '2026-01-01T00:00:00.000Z' };
const SOURCE_ID = 'merge-resolution-source';

// ---------------------------------------------------------------------------
// Generic delta builders — see branches.ts's own module comment on the
// untyped-client boundary this codebase already accepts elsewhere; here the
// analogous boundary is `Delta`'s exact discriminated union, which a
// generic (elementType/attribute as a runtime string, not a literal type)
// helper can't satisfy structurally. Cast the whole literal, exactly the
// pattern mergeResolution.ts's own `elementRestoreDelta` etc. already use.
// ---------------------------------------------------------------------------

function createElement(id: UUID, elementId: UUID, elementType: string, name: string, parentId: UUID | null, attributes: Record<string, unknown> = {}): Delta {
  return { kind: 'element.create', id, elementId, elementType, name, parentId, attributes, sourceId: SOURCE_ID, confidence: 1 } as never;
}

function retractElement(id: UUID, elementId: UUID, elementType: string, previousDeltaId: UUID): Delta {
  return { kind: 'element.retract', id, elementId, elementType, previousDeltaId, sourceId: SOURCE_ID, confidence: 1 } as never;
}

function updateAttribute(id: UUID, elementId: UUID, elementType: string, attribute: string, value: unknown, previousDeltaId: UUID): Delta {
  return { kind: 'element.update', id, elementId, elementType, attribute, value, previousDeltaId, sourceId: SOURCE_ID, confidence: 1 } as never;
}

function createRelationship(id: UUID, relationshipId: UUID, relationshipType: string, fromElementId: UUID, toElementId: UUID, attributes: Record<string, unknown> = {}): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType, fromElementId, toElementId, attributes, sourceId: SOURCE_ID, confidence: 1 } as never;
}

function retractRelationship(id: UUID, relationshipId: UUID, relationshipType: string, previousDeltaId: UUID): Delta {
  return { kind: 'relationship.retract', id, relationshipId, relationshipType, previousDeltaId, sourceId: SOURCE_ID, confidence: 1 } as never;
}

function foldDeltas(deltas: Delta[]): Head {
  return fold(emptyHead(), deltas, ctx);
}

function buildReview(baseDeltas: Delta[], oursExtra: Delta[], theirsExtra: Delta[]): MergeReview {
  const base = foldDeltas(baseDeltas);
  const ours = fold(cloneHead(base), oursExtra, ctx);
  const theirs = fold(cloneHead(base), theirsExtra, ctx);
  const fields = diffFacts(base, ours, theirs);
  const classification = classifyMerge({ base, ours, theirs, fields });
  return { threeWay: { mergeBaseCommitId: 'base', base, ours, theirs, fields, upToDateWithMain: theirsExtra.length === 0 }, classification };
}

/** `cloneHead(ours) ⊕ prepDeltas ⊕ X ⊕ mergeDeltas` — the real refresh fold (ADR-021 §3.3). */
function replay(ours: Head, prepDeltas: Delta[], theirsExtra: Delta[], mergeDeltas: Delta[]): Head {
  const head = cloneHead(ours);
  fold(head, prepDeltas, ctx);
  fold(head, theirsExtra, ctx);
  fold(head, mergeDeltas, ctx);
  return head;
}

/** V2 (SPEC §5.2), restricted to this file's own element types: a live element's `parentId`, if set, must reference a live capability. `apply()` itself never checks this (only C8/C9/C17 are enforced inline) — the one thing this property adds beyond "fold didn't throw". */
function assertV2(head: Head): void {
  for (const [id, el] of head.elements) {
    if (el.parentId === null) continue;
    const parent = head.elements.get(el.parentId);
    expect(parent, `V2: ${id}'s parentId ${el.parentId} does not reference a live element`).toBeDefined();
    expect(parent?.elementType, `V2: ${id}'s parent ${el.parentId} is not a capability`).toBe('capability');
  }
}

/** V6 (SPEC §5.2): no two live relationships share `(type, from, to)` — also never checked by `apply()` (that's exactly why duplicate-relationship is a conflict class in the first place). */
function assertV6(head: Head): void {
  const seen = new Set<string>();
  for (const rel of head.relationships.values()) {
    const key = `${rel.relationshipType}:${rel.fromElementId}:${rel.toElementId}`;
    expect(seen.has(key), `V6: duplicate live relationship ${key}`).toBe(false);
    seen.add(key);
  }
}

/** Every `resolved_conflicts` row references a delta id that actually exists in this refresh's own history (P-29's own wording: "in X, O's ancestry, P or M"). */
function assertResolvedConflictIdsKnown(resolvedConflicts: { winningDeltaId: UUID; discardedDeltaId: UUID; resolutionDeltaId: UUID | null }[], knownIds: ReadonlySet<UUID>): void {
  for (const rc of resolvedConflicts) {
    expect(knownIds.has(rc.winningDeltaId), `resolved_conflicts references unknown winning delta ${rc.winningDeltaId}`).toBe(true);
    expect(knownIds.has(rc.discardedDeltaId), `resolved_conflicts references unknown discarded delta ${rc.discardedDeltaId}`).toBe(true);
    if (rc.resolutionDeltaId !== null) expect(knownIds.has(rc.resolutionDeltaId), `resolved_conflicts references unknown resolution delta ${rc.resolutionDeltaId}`).toBe(true);
  }
}

/** C21 (ADR-021 §2a amendment 3 / §6): a `preparation` commit may only carry the mechanical shapes §3.3's own table derives from the findings — never a decision delta (those live in `M` only). */
const PREP_ALLOWED_KINDS = new Set(['element.restore', 'relationship.retract', 'relationship.update']);
function assertC21(prepDeltas: Delta[]): void {
  for (const d of prepDeltas) expect(PREP_ALLOWED_KINDS.has(d.kind), `preparation commit carries a disallowed delta kind ${d.kind} (C21)`).toBe(true);
}

interface StructuralScenario {
  review: MergeReview;
  ours: Head;
  theirsExtra: Delta[];
  choices: StructuralChoice[];
  knownIds: Set<UUID>;
  /** Asserts the scenario's own expected final state — computed independently of `buildStructuralResolutions`, from the generator's own construction (the actual oracle P-29 calls for). */
  checkOracle: (finalHead: Head) => void;
}

// ---- retract-vs-modify / dangling-endpoint / dangling-parent, Case A (ours retracted E) ----

const caseAArb: fc.Arbitrary<StructuralScenario> = fc
  .record({
    action: fc.constantFrom<RetractionChoice['action']>('keep-retraction', 'keep-element'),
    relCount: fc.integer({ min: 0, max: 2 }),
    childCount: fc.integer({ min: 0, max: 2 }),
  })
  .map(({ action, relCount, childCount }) => {
    const baseDeltas: Delta[] = [createElement('root', 'root', 'capability', 'Root', null), createElement('d0', 'e', 'capability', 'E', 'root')];
    for (let i = 0; i < relCount; i += 1) baseDeltas.push(createElement(`f-create-${String(i)}`, `f${String(i)}`, 'system', `F${String(i)}`, null, { lifecycleStatus: 'active', isExternal: false }));
    for (let j = 0; j < childCount; j += 1) baseDeltas.push(createElement(`g-create-${String(j)}`, `g${String(j)}`, 'capability', `G${String(j)}`, null));

    const oursExtra: Delta[] = [retractElement('ours-retract-e', 'e', 'capability', 'd0')];

    const theirsExtra: Delta[] = [updateAttribute('theirs-update-e', 'e', 'capability', 'description', 'main changed this', 'd0')];
    for (let i = 0; i < relCount; i += 1) theirsExtra.push(createRelationship(`theirs-rel-${String(i)}`, `r${String(i)}`, 'supports', `f${String(i)}`, 'e'));
    for (let j = 0; j < childCount; j += 1) theirsExtra.push(updateAttribute(`theirs-reparent-${String(j)}`, `g${String(j)}`, 'capability', 'parentId', 'e', `g-create-${String(j)}`));

    const review = buildReview(baseDeltas, oursExtra, theirsExtra);
    const choices: StructuralChoice[] = [{ class: 'retraction', elementId: 'e', action }];
    const knownIds = new Set([...baseDeltas, ...oursExtra, ...theirsExtra].map((d) => d.id));

    return {
      review,
      ours: review.threeWay.ours,
      theirsExtra,
      choices,
      knownIds,
      checkOracle: (finalHead: Head) => {
        if (action === 'keep-retraction') {
          expect(finalHead.elements.has('e')).toBe(false);
          for (let i = 0; i < relCount; i += 1) expect(finalHead.relationships.has(`r${String(i)}`)).toBe(false);
          for (let j = 0; j < childCount; j += 1) expect(finalHead.elements.get(`g${String(j)}`)?.parentId).toBe('root');
        } else {
          expect(finalHead.elements.get('e')?.attributes.description).toBe('main changed this');
          for (let i = 0; i < relCount; i += 1) expect(finalHead.relationships.has(`r${String(i)}`)).toBe(true);
          for (let j = 0; j < childCount; j += 1) expect(finalHead.elements.get(`g${String(j)}`)?.parentId).toBe('e');
        }
      },
    };
  });

// ---- retract-vs-modify / dangling-endpoint, Case B (main retracted E) ----

const caseBArb: fc.Arbitrary<StructuralScenario> = fc
  .record({
    action: fc.constantFrom<RetractionChoice['action']>('keep-retraction', 'keep-element'),
    newRelCount: fc.integer({ min: 0, max: 2 }),
    preExistingCount: fc.integer({ min: 0, max: 2 }),
  })
  .map(({ action, newRelCount, preExistingCount }) => {
    const baseDeltas: Delta[] = [createElement('d0', 'e', 'system', 'E', null, { lifecycleStatus: 'active', isExternal: false })];
    for (let i = 0; i < newRelCount; i += 1) baseDeltas.push(createElement(`y-create-${String(i)}`, `y${String(i)}`, 'system', `Y${String(i)}`, null, { lifecycleStatus: 'active', isExternal: false }));
    for (let k = 0; k < preExistingCount; k += 1) {
      baseDeltas.push(createElement(`x-create-${String(k)}`, `x${String(k)}`, 'system', `X${String(k)}`, null, { lifecycleStatus: 'active', isExternal: false }));
      baseDeltas.push(createRelationship(`q-create-${String(k)}`, `q${String(k)}`, 'uses', 'e', `x${String(k)}`));
    }

    const oursExtra: Delta[] = [updateAttribute('ours-update-e', 'e', 'system', 'description', 'branch changed this', 'd0')];
    for (let i = 0; i < newRelCount; i += 1) oursExtra.push(createRelationship(`ours-rel-${String(i)}`, `s${String(i)}`, 'uses', `y${String(i)}`, 'e'));

    // Main's own retract(e) needs C8 to hold on its own exclusive history —
    // every pre-existing relationship of `e` main can see must be retracted
    // first, in the same commit-equivalent list (fold applies theirsExtra
    // in array order here, standing in for "theirs' own exclusive commits
    // in seq order").
    const theirsExtra: Delta[] = [];
    for (let k = 0; k < preExistingCount; k += 1) theirsExtra.push(retractRelationship(`theirs-retract-q-${String(k)}`, `q${String(k)}`, 'uses', `q-create-${String(k)}`));
    theirsExtra.push(retractElement('theirs-retract-e', 'e', 'system', 'd0'));

    const review = buildReview(baseDeltas, oursExtra, theirsExtra);
    const choices: StructuralChoice[] = [{ class: 'retraction', elementId: 'e', action }];
    const knownIds = new Set([...baseDeltas, ...oursExtra, ...theirsExtra].map((d) => d.id));

    return {
      review,
      ours: review.threeWay.ours,
      theirsExtra,
      choices,
      knownIds,
      checkOracle: (finalHead: Head) => {
        if (action === 'keep-element') {
          expect(finalHead.elements.get('e')?.attributes.description).toBe('branch changed this');
          for (let i = 0; i < newRelCount; i += 1) expect(finalHead.relationships.has(`s${String(i)}`)).toBe(true);
          for (let k = 0; k < preExistingCount; k += 1) expect(finalHead.relationships.has(`q${String(k)}`)).toBe(true);
        } else {
          expect(finalHead.elements.has('e')).toBe(false);
          for (let i = 0; i < newRelCount; i += 1) expect(finalHead.relationships.has(`s${String(i)}`)).toBe(false);
          for (let k = 0; k < preExistingCount; k += 1) expect(finalHead.relationships.has(`q${String(k)}`)).toBe(false);
        }
      },
    };
  });

// ---- converged-retract: both sides retracted E, automatic, never a card ----

const convergedArb: fc.Arbitrary<StructuralScenario> = fc.constant(null).map(() => {
  const baseDeltas: Delta[] = [createElement('d0', 'e', 'capability', 'E', null)];
  const oursExtra: Delta[] = [retractElement('ours-retract-e', 'e', 'capability', 'd0')];
  const theirsExtra: Delta[] = [retractElement('theirs-retract-e', 'e', 'capability', 'd0')];
  const review = buildReview(baseDeltas, oursExtra, theirsExtra);
  const knownIds = new Set([...baseDeltas, ...oursExtra, ...theirsExtra].map((d) => d.id));
  return {
    review,
    ours: review.threeWay.ours,
    theirsExtra,
    choices: [] as StructuralChoice[],
    knownIds,
    checkOracle: (finalHead: Head) => {
      expect(finalHead.elements.has('e')).toBe(false);
    },
  };
});

// ---- duplicate-relationship: both sides created the same (type, from, to) ----

const duplicateArb: fc.Arbitrary<StructuralScenario> = fc.constantFrom<'ours' | 'theirs'>('ours', 'theirs').map((keep) => {
  const baseDeltas: Delta[] = [createElement('d0', 'a', 'system', 'A', null, { lifecycleStatus: 'active', isExternal: false }), createElement('d1', 'b', 'system', 'B', null, { lifecycleStatus: 'active', isExternal: false })];
  const oursExtra: Delta[] = [createRelationship('ours-rel', 'rel-ours', 'uses', 'a', 'b')];
  const theirsExtra: Delta[] = [createRelationship('theirs-rel', 'rel-theirs', 'uses', 'a', 'b')];
  const review = buildReview(baseDeltas, oursExtra, theirsExtra);
  const choices: StructuralChoice[] = [{ class: 'duplicate-relationship', relationshipId: 'rel-ours', relatedRelationshipId: 'rel-theirs', keep }];
  const knownIds = new Set([...baseDeltas, ...oursExtra, ...theirsExtra].map((d) => d.id));
  return {
    review,
    ours: review.threeWay.ours,
    theirsExtra,
    choices,
    knownIds,
    checkOracle: (finalHead: Head) => {
      expect(finalHead.relationships.has('rel-ours')).toBe(keep === 'ours');
      expect(finalHead.relationships.has('rel-theirs')).toBe(keep === 'theirs');
    },
  };
});

// ---- cardinality: supports.role primary pick ----

const cardinalitySupportsArb: fc.Arbitrary<StructuralScenario> = fc.constantFrom<'ours' | 'theirs'>('ours', 'theirs').map((keep) => {
  const baseDeltas: Delta[] = [
    createElement('d0', 'sys', 'system', 'System', null, { lifecycleStatus: 'active', isExternal: false }),
    createElement('d1', 'capA', 'capability', 'A', null),
    createElement('d2', 'capB', 'capability', 'B', null),
  ];
  const oursExtra: Delta[] = [createRelationship('ours-rel', 'rel-ours', 'supports', 'sys', 'capA', { role: 'primary' })];
  const theirsExtra: Delta[] = [createRelationship('theirs-rel', 'rel-theirs', 'supports', 'sys', 'capB', { role: 'primary' })];
  const review = buildReview(baseDeltas, oursExtra, theirsExtra);
  const choices: StructuralChoice[] = [{ class: 'cardinality', relationshipId: 'rel-ours', relatedRelationshipId: 'rel-theirs', keep }];
  const knownIds = new Set([...baseDeltas, ...oursExtra, ...theirsExtra].map((d) => d.id));
  return {
    review,
    ours: review.threeWay.ours,
    theirsExtra,
    choices,
    knownIds,
    checkOracle: (finalHead: Head) => {
      expect(finalHead.relationships.has('rel-ours')).toBe(true);
      expect(finalHead.relationships.has('rel-theirs')).toBe(true);
      expect(finalHead.relationships.get('rel-ours')?.attributes.role).toBe(keep === 'ours' ? 'primary' : 'secondary');
      expect(finalHead.relationships.get('rel-theirs')?.attributes.role).toBe(keep === 'ours' ? 'secondary' : 'primary');
    },
  };
});

// ---- cardinality: owns.role pick (retract/restore, no neutral value) ----

const cardinalityOwnsArb: fc.Arbitrary<StructuralScenario> = fc.constantFrom<'ours' | 'theirs'>('ours', 'theirs').map((keep) => {
  const baseDeltas: Delta[] = [
    createElement('d0', 'owner1', 'actor', 'Team A', null, { subtype: 'team', isExternal: false }),
    createElement('d1', 'owner2', 'actor', 'Team B', null, { subtype: 'team', isExternal: false }),
    createElement('d2', 'target', 'system', 'Target', null, { lifecycleStatus: 'active', isExternal: false }),
  ];
  const oursExtra: Delta[] = [createRelationship('ours-rel', 'rel-ours', 'owns', 'owner1', 'target', { role: 'business' })];
  const theirsExtra: Delta[] = [createRelationship('theirs-rel', 'rel-theirs', 'owns', 'owner2', 'target', { role: 'business' })];
  const review = buildReview(baseDeltas, oursExtra, theirsExtra);
  const choices: StructuralChoice[] = [{ class: 'cardinality', relationshipId: 'rel-ours', relatedRelationshipId: 'rel-theirs', keep }];
  const knownIds = new Set([...baseDeltas, ...oursExtra, ...theirsExtra].map((d) => d.id));
  return {
    review,
    ours: review.threeWay.ours,
    theirsExtra,
    choices,
    knownIds,
    checkOracle: (finalHead: Head) => {
      expect(finalHead.relationships.has('rel-ours')).toBe(keep === 'ours');
      expect(finalHead.relationships.has('rel-theirs')).toBe(keep === 'theirs');
    },
  };
});

const scenarioArb: fc.Arbitrary<StructuralScenario> = fc.oneof(caseAArb, caseBArb, convergedArb, duplicateArb, cardinalitySupportsArb, cardinalityOwnsArb);

describe('P-29: buildStructuralResolutions — generative oracle property (ADR-021 §7, C2b)', () => {
  it('for every structural class, both retraction directions, both cardinality types, and every legal choice: resolves cleanly and matches the independently-computed expected state', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        let seq = 0;
        const mintId = () => `resolution-${String((seq += 1))}`;
        const { prepDeltas, mergeDeltas, resolvedConflicts } = buildStructuralResolutions(scenario.review, scenario.choices, SOURCE_ID, mintId);

        assertC21(prepDeltas);

        let finalHead: Head | undefined;
        expect(() => {
          finalHead = replay(scenario.ours, prepDeltas, scenario.theirsExtra, mergeDeltas);
        }).not.toThrow();
        if (!finalHead) throw new Error('unreachable: replay did not throw but produced no head');

        assertV2(finalHead);
        assertV6(finalHead);

        const allKnownIds = new Set(scenario.knownIds);
        for (const d of prepDeltas) allKnownIds.add(d.id);
        for (const d of mergeDeltas) allKnownIds.add(d.id);
        assertResolvedConflictIdsKnown(resolvedConflicts, allKnownIds);

        scenario.checkOracle(finalHead);
      }),
      { numRuns: 300 },
    );
  });
});

describe('P-31: determinism (ADR-021 §7, rule 6)', () => {
  it('two runs of buildStructuralResolutions over the same inputs and mintId sequence produce identical prepDeltas, mergeDeltas and resolvedConflicts', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const run = () => {
          let seq = 0;
          const mintId = () => `id-${String((seq += 1))}`;
          return buildStructuralResolutions(scenario.review, scenario.choices, SOURCE_ID, mintId);
        };
        expect(run()).toEqual(run());
      }),
      { numRuns: 200 },
    );
  });
});

describe('P-13 (extended): swapping ours/theirs swaps the direction of every structural finding, subject set unchanged (ADR-021 §5 item 2, §7)', () => {
  // duplicate-relationship/cardinality/identity findings are found by
  // iterating "new on ours" × "new on theirs" pairs (src/engine/merge.ts) —
  // swapping ours/theirs swaps which side is iterated first, so the pair
  // itself reverses (subjectId ↔ relatedSubjectId). retract-vs-modify/
  // dangling-endpoint/dangling-parent/converged-retract findings are keyed
  // off "whichever side is missing the subject," which is itself swap-
  // invariant — the same element is found retracted either way, so those
  // classes' subjectId/relatedSubjectId never swap at all. Both are
  // "direction swapped" in ADR-021's sense; only the concrete key shape
  // differs, hence the two branches below.
  const PAIRWISE_CLASSES = new Set<ConflictFinding['class']>(['structural:duplicate-relationship', 'structural:cardinality', 'identity', 'identity:strong']);

  function canonicalize(findings: readonly ConflictFinding[]): string[] {
    return findings
      .map((f) => {
        if (PAIRWISE_CLASSES.has(f.class) && f.relatedSubjectId !== undefined) {
          const pair = [f.subjectId, f.relatedSubjectId].sort();
          return `${f.class}|${pair.join(',')}|${f.attribute ?? ''}|${String(f.blocking)}`;
        }
        return `${f.class}|${f.subjectId}|${f.relatedSubjectId ?? ''}|${f.attribute ?? ''}|${String(f.blocking)}`;
      })
      .sort();
  }

  it('classifyMerge(base, ours, theirs) and classifyMerge(base, theirs, ours) find the same findings, direction-normalised', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { base, ours, theirs } = scenario.review.threeWay;
        const forward = classifyMerge({ base, ours, theirs, fields: diffFacts(base, ours, theirs) });
        const backward = classifyMerge({ base, ours: theirs, theirs: ours, fields: diffFacts(base, theirs, ours) });
        expect(canonicalize(forward.findings)).toEqual(canonicalize(backward.findings));
      }),
      { numRuns: 300 },
    );
  });
});
