/**
 * Property tests for apply/fold/invert over generated delta sequences
 * (Sprint F1 step 4; SPEC-data-model.md §6.2). Unlike
 * src/contracts/delta.property.test.ts (which generates independent,
 * unrelated deltas to exercise the wire/storage mapping), these tests build
 * coherent *sequences* — a create followed by a chain of updates with
 * correctly-linked `previousDeltaId`s — because that's what exercises
 * apply/fold's actual state-machine logic.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ELEMENT_TYPES, RELATIONSHIP_TYPES, type Delta, type DeltaKind, type ElementType, type LifecycleStatus, type RelationshipType, type UUID } from '../contracts/delta';
import { isRelationshipTripleAllowed, RELATIONSHIP_TYPE_RULES } from '../contracts/relationshipTypeRules';
import type { Json } from '../contracts/rows';
import { EngineError } from './errors';
import { cloneHead, emptyHead, factMapKey, fold, invert, type CommitContext, type Head } from './deltas';
import { canonicalizeHead, headHash } from './head';

const ctx: CommitContext = { authorId: 'author-1', createdAt: '2026-01-01T00:00:00.000Z' };
const uuid = fc.uuid();
const lifecycleStatuses: LifecycleStatus[] = ['planned', 'active', 'retiring', 'retired'];

// Values come back exactly after invert; provenance does not (a fresh
// delta always gets a fresh deltaId/author/etc — see the long comment on
// `invert` in deltas.ts). So comparisons after an invert use this —
// elements/relationships only, never facts — not full canonicalizeHead
// equality or headHash.
function valuesOnly(head: Head) {
  const { elements, relationships } = canonicalizeHead(head);
  // existsDeltaId is the LAST entry in each canonical tuple (SPEC §6.4's
  // ordering) and is provenance — which delta currently asserts this
  // subject exists — not a value, exactly like a fact's deltaId. It always
  // differs after a retract+restore (the restore mints its own id), so it
  // has to be stripped here for the same reason facts are excluded
  // entirely; this was found by this file's own exhaustive per-kind test
  // failing on element.retract/relationship.retract until fixed.
  return {
    elements: elements.map(([id, elementType, name, parentId, attributes]) => [id, elementType, name, parentId, attributes]),
    relationships: relationships.map(([id, relationshipType, fromElementId, toElementId, attributes]) => [id, relationshipType, fromElementId, toElementId, attributes]),
  };
}

/** One `system` element's life: a create, then a chain of updates with correctly-linked previousDeltaId, covering name/parentId/an-always-present attribute/optional-attributes-set-for-the-first-time (vendor, introduced, plannedEnd — the last two added in the same amendment that added them to SystemAttributes/ContainerAttributes). */
interface ElementScenario {
  elementId: UUID;
  deltas: Delta[];
}

const elementScenarioArb: fc.Arbitrary<ElementScenario> = fc
  .record({
    elementId: uuid,
    createId: uuid,
    name: fc.string({ minLength: 1, maxLength: 20 }),
    lifecycleStatus: fc.constantFrom(...lifecycleStatuses),
    includeVendorAtCreate: fc.boolean(),
    vendorAtCreate: fc.string({ minLength: 1, maxLength: 12 }),
    updates: fc.array(
      fc.record({
        id: uuid,
        target: fc.constantFrom(
          'name' as const,
          'lifecycleStatus' as const,
          'vendor' as const,
          'parentId' as const,
          'introduced' as const,
          'plannedEnd' as const,
        ),
        stringValue: fc.string({ minLength: 1, maxLength: 20 }),
        lifecycleValue: fc.constantFrom(...lifecycleStatuses),
        parentValue: fc.option(uuid, { nil: null }),
      }),
      { minLength: 0, maxLength: 5 },
    ),
    sourceId: uuid,
  })
  .map(({ elementId, createId, name, lifecycleStatus, includeVendorAtCreate, vendorAtCreate, updates, sourceId }) => {
    const attributes: Record<string, Json> = { lifecycleStatus, isExternal: false };
    if (includeVendorAtCreate) attributes.vendor = vendorAtCreate;
    const create: Delta = {
      kind: 'element.create',
      id: createId,
      elementId,
      elementType: 'system',
      name,
      parentId: null,
      attributes: attributes as never,
      sourceId,
      confidence: 1,
    };
    const deltas: Delta[] = [create];
    let previousDeltaId = createId;
    for (const u of updates) {
      const value = u.target === 'lifecycleStatus' ? u.lifecycleValue : u.target === 'parentId' ? u.parentValue : u.stringValue;
      const delta: Delta = {
        kind: 'element.update',
        id: u.id,
        elementId,
        elementType: 'system',
        attribute: u.target,
        value: value as never,
        previousDeltaId,
        sourceId,
        confidence: 1,
      };
      deltas.push(delta);
      previousDeltaId = u.id;
    }
    return { elementId, deltas };
  });

describe('fold: create + update chain', () => {
  it('the live name/parentId always reflect the last update that touched them (last write wins)', () => {
    fc.assert(
      fc.property(elementScenarioArb, ({ elementId, deltas }) => {
        const head = fold(emptyHead(), deltas, ctx);
        const row = head.elements.get(elementId);
        expect(row).toBeDefined();

        const lastName = [...deltas].reverse().find((d) => d.kind === 'element.update' && d.attribute === 'name');
        const expectedName = lastName?.value ?? (deltas[0] as Extract<Delta, { kind: 'element.create' }>).name;
        expect(row?.name).toBe(expectedName);

        const lastParent = [...deltas].reverse().find((d) => d.kind === 'element.update' && d.attribute === 'parentId');
        const expectedParent = lastParent?.value ?? null;
        expect(row?.parentId).toBe(expectedParent);
      }),
    );
  });

  it("every live fact's deltaId is the id of the delta that most recently asserted it", () => {
    fc.assert(
      fc.property(elementScenarioArb, ({ elementId, deltas }) => {
        const head = fold(emptyHead(), deltas, ctx);
        for (const attribute of ['name', 'parentId', 'lifecycleStatus']) {
          const lastAssertion = [...deltas]
            .reverse()
            .find((d) => (d.kind === 'element.create' && attribute !== 'parentId' && attribute !== 'name') || (d.kind === 'element.update' && d.attribute === attribute));
          const fact = head.facts.get(factMapKey(elementId, attribute));
          expect(fact).toBeDefined();
          if (attribute === 'name' || attribute === 'parentId') {
            // create always seeds these; an update, if any, supersedes it.
            const lastUpdate = [...deltas].reverse().find((d) => d.kind === 'element.update' && d.attribute === attribute);
            expect(fact?.deltaId).toBe(lastUpdate ? lastUpdate.id : deltas[0]?.id);
          } else {
            expect(fact?.deltaId).toBe(lastAssertion?.id);
          }
        }
      }),
    );
  });

  it('a first-time update on an attribute absent at create is visible afterwards (no crash on the "no prior fact" path)', () => {
    const elementId = 'el-1';
    const create: Delta = {
      kind: 'element.create',
      id: 'd1',
      elementId,
      elementType: 'system',
      name: 'X',
      parentId: null,
      attributes: { lifecycleStatus: 'active', isExternal: false },
      sourceId: 'src',
      confidence: 1,
    };
    const update: Delta = {
      kind: 'element.update',
      id: 'd2',
      elementId,
      elementType: 'system',
      attribute: 'vendor',
      value: 'Acme',
      previousDeltaId: 'd1',
      sourceId: 'src',
      confidence: 1,
    };
    const head = fold(emptyHead(), [create, update], ctx);
    expect(head.elements.get(elementId)?.attributes.vendor).toBe('Acme');
  });
});

describe('retract/restore (P-4: reversible)', () => {
  it('restoring immediately after retracting recovers the same elements/relationships/facts, with original provenance', () => {
    fc.assert(
      fc.property(elementScenarioArb, uuid, uuid, ({ elementId, deltas }, retractId, restoreId) => {
        const beforeRetract = fold(emptyHead(), deltas, ctx);
        const rowBefore = beforeRetract.elements.get(elementId);
        const factsBefore = new Map([...beforeRetract.facts].filter(([k]) => k.startsWith(`${elementId} `)));
        expect(rowBefore).toBeDefined();

        const lastId = deltas[deltas.length - 1]?.id;
        if (!lastId) return;
        const retract: Delta = { kind: 'element.retract', id: retractId, elementId, elementType: 'system', previousDeltaId: lastId, sourceId: 'src', confidence: 1 };
        const restore: Delta = { kind: 'element.restore', id: restoreId, elementId, elementType: 'system', previousDeltaId: retractId, sourceId: 'src', confidence: 1 };
        const after = fold(cloneHead(beforeRetract), [retract, restore], ctx);

        const rowAfter = after.elements.get(elementId);
        expect(rowAfter?.name).toBe(rowBefore?.name);
        expect(rowAfter?.parentId).toBe(rowBefore?.parentId);
        expect(rowAfter?.attributes).toEqual(rowBefore?.attributes);

        // Every attribute fact keeps its ORIGINAL provenance (deltaId), not the restore's.
        for (const [key, fact] of factsBefore) {
          if (key.endsWith(' $exists')) continue; // $exists legitimately gets new provenance from the restore itself
          expect(after.facts.get(key)).toEqual(fact);
        }
      }),
    );
  });

  it('a retracted element is gone from elements/facts, but its history survives for restore', () => {
    fc.assert(
      fc.property(elementScenarioArb, uuid, ({ elementId, deltas }, retractId) => {
        const before = fold(emptyHead(), deltas, ctx);
        const lastId = deltas[deltas.length - 1]?.id;
        if (!lastId) return;
        const retract: Delta = { kind: 'element.retract', id: retractId, elementId, elementType: 'system', previousDeltaId: lastId, sourceId: 'src', confidence: 1 };
        const after = fold(cloneHead(before), [retract], ctx);
        expect(after.elements.has(elementId)).toBe(false);
        expect([...after.facts.keys()].some((k) => k.startsWith(`${elementId} `))).toBe(false);
        expect(after.retractedElements.get(elementId)).toBe(retractId);
      }),
    );
  });
});

describe('C8: element.retract and live relationships (Sprint C1-H item 3)', () => {
  /**
   * One `system` element (`elementId`), between 1 and 4 `uses` relationships
   * from it to distinct other `system` elements, and a per-relationship
   * coin flip for whether that relationship is retracted *before*
   * `elementId`'s own retract, all within one commit (one `fold` call, one
   * delta array) — exactly the "earlier in the same commit" shape C8
   * requires and `deltas.ts`'s own `element.retract` case now checks.
   */
  const retractScenarioArb = fc
    .record({
      elementId: uuid,
      targetIds: fc.uniqueArray(uuid, { minLength: 1, maxLength: 4 }),
      retractedBefore: fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }),
    })
    .map(({ elementId, targetIds, retractedBefore }) => ({
      elementId,
      // One flag per target, regardless of which array fast-check made longer.
      relationships: targetIds.map((toElementId, i) => ({ relationshipId: `rel-${String(i)}`, toElementId, retractBefore: retractedBefore[i % retractedBefore.length] ?? false })),
    }))
    .filter(({ elementId, relationships }) => !relationships.some((r) => r.toElementId === elementId)); // fromElementId !== toElementId — not what this test is about

  function buildDeltas(elementId: UUID, relationships: { relationshipId: UUID; toElementId: UUID; retractBefore: boolean }[]): Delta[] {
    const deltas: Delta[] = [{ kind: 'element.create', id: `create-${elementId}`, elementId, elementType: 'system', name: 'A', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: 'src', confidence: 1 }];
    for (const r of relationships) {
      deltas.push({
        kind: 'element.create',
        id: `create-${r.toElementId}`,
        elementId: r.toElementId,
        elementType: 'system',
        name: 'B',
        parentId: null,
        attributes: { lifecycleStatus: 'active', isExternal: false },
        sourceId: 'src',
        confidence: 1,
      });
      deltas.push({
        kind: 'relationship.create',
        id: `create-${r.relationshipId}`,
        relationshipId: r.relationshipId,
        relationshipType: 'uses',
        fromElementId: elementId,
        toElementId: r.toElementId,
        attributes: {},
        sourceId: 'src',
        confidence: 1,
      });
    }
    // Retractions for the "before" subset, then the element's own retract —
    // this ordering (not the relationships' creation order) is what makes
    // this "earlier in the same commit" for C8's purposes.
    for (const r of relationships) {
      if (r.retractBefore) {
        deltas.push({ kind: 'relationship.retract', id: `retract-${r.relationshipId}`, relationshipId: r.relationshipId, relationshipType: 'uses', previousDeltaId: `create-${r.relationshipId}`, sourceId: 'src', confidence: 1 });
      }
    }
    deltas.push({ kind: 'element.retract', id: `retract-${elementId}`, elementId, elementType: 'system', previousDeltaId: `create-${elementId}`, sourceId: 'src', confidence: 1 });
    return deltas;
  }

  it('rejects the retract whenever any relationship touching the element is still live at that point', () => {
    fc.assert(
      fc.property(retractScenarioArb, ({ elementId, relationships }) => {
        fc.pre(relationships.some((r) => !r.retractBefore)); // at least one left live
        const deltas = buildDeltas(elementId, relationships);
        expect(() => fold(emptyHead(), deltas, ctx)).toThrow(/C8/);
      }),
    );
  });

  it('accepts the retract once every relationship touching the element was retracted earlier in the same commit', () => {
    fc.assert(
      fc.property(retractScenarioArb, ({ elementId, relationships }) => {
        const allRetractedFirst = relationships.map((r) => ({ ...r, retractBefore: true }));
        const deltas = buildDeltas(elementId, allRetractedFirst);
        const after = fold(emptyHead(), deltas, ctx);
        expect(after.elements.has(elementId)).toBe(false);
        expect(after.retractedElements.has(elementId)).toBe(true);
        for (const r of allRetractedFirst) {
          expect(after.relationships.has(r.relationshipId)).toBe(false);
        }
      }),
    );
  });
});

describe('invert', () => {
  it('apply(d) then apply(invert(d, headBefore)) restores the prior element/relationship values', () => {
    fc.assert(
      fc.property(elementScenarioArb, uuid, ({ deltas }, invertId) => {
        const last = deltas[deltas.length - 1];
        if (!last) return;
        const priorDeltas = deltas.slice(0, -1);
        const headBefore = fold(emptyHead(), priorDeltas, ctx);
        const valuesBefore = valuesOnly(headBefore);

        const headAfter = fold(cloneHead(headBefore), [last], ctx);
        const inverse = invert(last, headBefore, { id: invertId, sourceId: 'undo-source', confidence: 1 });
        const headUndone = fold(headAfter, [inverse], ctx);

        expect(valuesOnly(headUndone)).toEqual(valuesBefore);
      }),
    );
  });

  it('for a create, apply(d) then apply(invert(d)) fully erases the element, matching an untouched head byte-for-byte (nothing survives a create+retract to carry mismatched provenance)', () => {
    fc.assert(
      fc.property(elementScenarioArb, uuid, ({ deltas }, invertId) => {
        const create = deltas[0];
        if (create?.kind !== 'element.create') return;
        const headAfter = fold(emptyHead(), [create], ctx);
        const inverse = invert(create, emptyHead(), { id: invertId, sourceId: 'undo', confidence: 1 });
        const headUndone = fold(headAfter, [inverse], ctx);
        expect(headHash(headUndone)).toBe(headHash(emptyHead()));
      }),
    );
  });

  it('inverting a create produces a retract of the same element', () => {
    fc.assert(
      fc.property(elementScenarioArb, uuid, ({ elementId, deltas }, invertId) => {
        const create = deltas[0];
        if (create?.kind !== 'element.create') return;
        const inverse = invert(create, emptyHead(), { id: invertId, sourceId: 'undo', confidence: 1 });
        expect(inverse).toMatchObject({ kind: 'element.retract', elementId, previousDeltaId: create.id });
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Exhaustive, one-fixture-per-kind coverage of apply + invert.
//
// Everything above generates coherent *sequences* over a couple of
// representative kinds (mostly element.create/update, since that's what a
// realistic scenario looks like) — good for finding state-machine bugs, but
// nothing forces every one of the eight DeltaKinds to actually be exercised
// by fold/invert somewhere. `fixturesByKind` closes that gap: it is typed
// `Record<DeltaKind, ...>`, so if `Delta` ever grows a ninth kind (the merge
// delta this amendment deliberately does not add yet), this object literal
// stops compiling until a fixture is added for it — and the test below
// iterates this map's own keys, not a separately hand-typed list, so a new
// fixture is automatically exercised the moment it's added.
// ---------------------------------------------------------------------------

interface KindFixture {
  /** A minimal, valid `Head` for `delta` to be applied against. */
  headBefore: Head;
  delta: Delta;
  /** What `invert(delta, ...)` must produce for this kind — checked directly, not just "doesn't throw". */
  expectedInverseKind: DeltaKind;
}

const FIXTURE_SOURCE = 'fixture-src';

function createSystemDelta(id: UUID, elementId: UUID): Delta {
  return {
    kind: 'element.create',
    id,
    elementId,
    elementType: 'system',
    name: 'Fixture System',
    parentId: null,
    attributes: { lifecycleStatus: 'active', isExternal: false },
    sourceId: FIXTURE_SOURCE,
    confidence: 1,
  };
}

function createActorDelta(id: UUID, elementId: UUID): Delta {
  return {
    kind: 'element.create',
    id,
    elementId,
    elementType: 'actor',
    name: 'Fixture Actor',
    parentId: null,
    attributes: { subtype: 'person', isExternal: false },
    sourceId: FIXTURE_SOURCE,
    confidence: 1,
  };
}

function createOwnsDelta(id: UUID, relationshipId: UUID): Delta {
  return {
    kind: 'relationship.create',
    id,
    relationshipId,
    relationshipType: 'owns',
    fromElementId: 'fixture-actor',
    toElementId: 'fixture-target',
    attributes: { primary: true },
    sourceId: FIXTURE_SOURCE,
    confidence: 1,
  };
}

/**
 * `owns`'s endpoints (an actor and a system, C9's allowed triple for `owns`)
 * folded first — every relationship fixture below needs both to exist
 * before `createOwnsDelta` can pass apply()'s C9 check (Sprint H1).
 */
function ownsEndpointsHead(): Head {
  return fold(emptyHead(), [createActorDelta('d-actor', 'fixture-actor'), createSystemDelta('d-target', 'fixture-target')], ctx);
}

const fixturesByKind: Record<DeltaKind, () => KindFixture> = {
  'element.create': () => ({
    headBefore: emptyHead(),
    delta: createSystemDelta('d-create', 'el-1'),
    expectedInverseKind: 'element.retract',
  }),
  'element.update': () => ({
    headBefore: fold(emptyHead(), [createSystemDelta('d-create', 'el-1')], ctx),
    delta: {
      kind: 'element.update',
      id: 'd-update',
      elementId: 'el-1',
      elementType: 'system',
      attribute: 'lifecycleStatus',
      value: 'retiring',
      previousDeltaId: 'd-create',
      sourceId: FIXTURE_SOURCE,
      confidence: 1,
    },
    expectedInverseKind: 'element.update',
  }),
  'element.retract': () => ({
    headBefore: fold(emptyHead(), [createSystemDelta('d-create', 'el-1')], ctx),
    delta: { kind: 'element.retract', id: 'd-retract', elementId: 'el-1', elementType: 'system', previousDeltaId: 'd-create', sourceId: FIXTURE_SOURCE, confidence: 1 },
    expectedInverseKind: 'element.restore',
  }),
  'element.restore': () => ({
    headBefore: fold(
      emptyHead(),
      [createSystemDelta('d-create', 'el-1'), { kind: 'element.retract', id: 'd-retract', elementId: 'el-1', elementType: 'system', previousDeltaId: 'd-create', sourceId: FIXTURE_SOURCE, confidence: 1 }],
      ctx,
    ),
    delta: { kind: 'element.restore', id: 'd-restore', elementId: 'el-1', elementType: 'system', previousDeltaId: 'd-retract', sourceId: FIXTURE_SOURCE, confidence: 1 },
    expectedInverseKind: 'element.retract',
  }),
  'relationship.create': () => ({
    headBefore: ownsEndpointsHead(),
    delta: createOwnsDelta('d-rcreate', 'rel-1'),
    expectedInverseKind: 'relationship.retract',
  }),
  'relationship.update': () => ({
    headBefore: fold(ownsEndpointsHead(), [createOwnsDelta('d-rcreate', 'rel-1')], ctx),
    delta: {
      kind: 'relationship.update',
      id: 'd-rupdate',
      relationshipId: 'rel-1',
      relationshipType: 'owns',
      attribute: 'primary',
      value: false,
      previousDeltaId: 'd-rcreate',
      sourceId: FIXTURE_SOURCE,
      confidence: 1,
    },
    expectedInverseKind: 'relationship.update',
  }),
  'relationship.retract': () => ({
    headBefore: fold(ownsEndpointsHead(), [createOwnsDelta('d-rcreate', 'rel-1')], ctx),
    delta: { kind: 'relationship.retract', id: 'd-rretract', relationshipId: 'rel-1', relationshipType: 'owns', previousDeltaId: 'd-rcreate', sourceId: FIXTURE_SOURCE, confidence: 1 },
    expectedInverseKind: 'relationship.restore',
  }),
  'relationship.restore': () => ({
    headBefore: fold(
      ownsEndpointsHead(),
      [createOwnsDelta('d-rcreate', 'rel-1'), { kind: 'relationship.retract', id: 'd-rretract', relationshipId: 'rel-1', relationshipType: 'owns', previousDeltaId: 'd-rcreate', sourceId: FIXTURE_SOURCE, confidence: 1 }],
      ctx,
    ),
    delta: { kind: 'relationship.restore', id: 'd-rrestore', relationshipId: 'rel-1', relationshipType: 'owns', previousDeltaId: 'd-rretract', sourceId: FIXTURE_SOURCE, confidence: 1 },
    expectedInverseKind: 'relationship.retract',
  }),
};

describe('every DeltaKind: apply + invert (exhaustive over DeltaKind at compile time)', () => {
  for (const kind of Object.keys(fixturesByKind) as DeltaKind[]) {
    it(kind, () => {
      const { headBefore, delta, expectedInverseKind } = fixturesByKind[kind]();

      const headAfter = fold(cloneHead(headBefore), [delta], ctx);

      const inverse = invert(delta, headBefore, { id: 'undo', sourceId: 'undo-source', confidence: 1 });
      expect(inverse.kind).toBe(expectedInverseKind);

      const headUndone = fold(cloneHead(headAfter), [inverse], ctx);
      expect(valuesOnly(headUndone)).toEqual(valuesOnly(headBefore));
    });
  }

  it('has exactly one fixture per DeltaKind (catches an accidentally-duplicated key silently shadowing another)', () => {
    expect(Object.keys(fixturesByKind).length).toBe(8);
  });
});

describe('order-independence for disjoint elements (P-3)', () => {
  it('folding two unrelated element scenarios in either order gives the same canonical hash', () => {
    fc.assert(
      fc.property(elementScenarioArb, elementScenarioArb, (a, b) => {
        fc.pre(a.elementId !== b.elementId);
        const forward = fold(fold(emptyHead(), a.deltas, ctx), b.deltas, ctx);
        const backward = fold(fold(emptyHead(), b.deltas, ctx), a.deltas, ctx);
        expect(headHash(forward)).toBe(headHash(backward));
      }),
    );
  });
});

describe('canonicalizeHead / headHash', () => {
  it('is deterministic: folding the same deltas twice gives the same hash (P-1)', () => {
    fc.assert(
      fc.property(elementScenarioArb, ({ deltas }) => {
        const h1 = fold(emptyHead(), deltas, ctx);
        const h2 = fold(emptyHead(), deltas, ctx);
        expect(headHash(h1)).toBe(headHash(h2));
      }),
    );
  });

  it('does not depend on Map insertion order', () => {
    fc.assert(
      fc.property(elementScenarioArb, elementScenarioArb, (a, b) => {
        fc.pre(a.elementId !== b.elementId);
        const h1: Head = fold(fold(emptyHead(), a.deltas, ctx), b.deltas, ctx);
        const h2: Head = fold(fold(emptyHead(), b.deltas, ctx), a.deltas, ctx);
        expect(canonicalizeHead(h1)).toEqual(canonicalizeHead(h2));
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// C9: relationship.create enforces RELATIONSHIP_TYPE_RULES (Sprint H1).
//
// Before this sprint, nothing checked this at all — apply() created a
// relationship between any two elements regardless of type (see
// docs/AUDIT-2026-09-U2.md §6.2). These tests cover the three angles the
// sprint asked for: every documented triple is accepted, a sample of
// non-triples is rejected, and a property test over the full
// (relationshipType, fromType, toType) space agrees with
// isRelationshipTripleAllowed exactly, not just on the examples above.
// ---------------------------------------------------------------------------

describe('C9: relationship.create enforces RELATIONSHIP_TYPE_RULES', () => {
  function minimalAttributesFor(elementType: ElementType): Record<string, Json> {
    switch (elementType) {
      case 'capability':
        return {};
      case 'system':
        return { lifecycleStatus: 'active', isExternal: false };
      case 'container':
        return { isExternal: false };
      case 'component':
        return {};
      case 'actor':
        return { subtype: 'person', isExternal: false };
    }
  }

  function elementCreateDelta(id: UUID, elementId: UUID, elementType: ElementType): Delta {
    return {
      kind: 'element.create',
      id,
      elementId,
      elementType,
      name: `Fixture ${elementType}`,
      parentId: null,
      attributes: minimalAttributesFor(elementType) as never,
      sourceId: 'src',
      confidence: 1,
    };
  }

  /** A head with one `fromType` element (`from-el`) and one `toType` element (`to-el`) already created — what C9 needs to look their types up. */
  function headWithEndpoints(fromType: ElementType, toType: ElementType): Head {
    return fold(emptyHead(), [elementCreateDelta('d-from', 'from-el', fromType), elementCreateDelta('d-to', 'to-el', toType)], ctx);
  }

  function relationshipCreateDelta(relationshipType: RelationshipType): Delta {
    return {
      kind: 'relationship.create',
      id: 'd-rel',
      relationshipId: 'rel-1',
      relationshipType,
      fromElementId: 'from-el',
      toElementId: 'to-el',
      attributes: (relationshipType === 'owns' ? { primary: true } : {}) as never,
      sourceId: 'src',
      confidence: 1,
    };
  }

  it('every triple in RELATIONSHIP_TYPE_RULES is accepted', () => {
    for (const rule of RELATIONSHIP_TYPE_RULES) {
      const head = headWithEndpoints(rule.fromType, rule.toType);
      expect(() => fold(head, [relationshipCreateDelta(rule.relationshipType)], ctx)).not.toThrow();
    }
  });

  it('a sample of triples not in RELATIONSHIP_TYPE_RULES is rejected, with a message naming C9', () => {
    const examples: [RelationshipType, ElementType, ElementType][] = [
      ['uses', 'actor', 'capability'],
      ['supports', 'capability', 'system'],
      ['owns', 'system', 'system'],
      ['flows_to', 'component', 'component'],
    ];
    for (const [relationshipType, fromType, toType] of examples) {
      expect(isRelationshipTripleAllowed(relationshipType, fromType, toType)).toBe(false);
      const head = headWithEndpoints(fromType, toType);
      expect(() => fold(head, [relationshipCreateDelta(relationshipType)], ctx)).toThrow(EngineError);
      expect(() => fold(head, [relationshipCreateDelta(relationshipType)], ctx)).toThrow(/RELATIONSHIP_TYPE_RULES \(C9\)/);
    }
  });

  it('property: apply() accepts a triple if and only if it is in RELATIONSHIP_TYPE_RULES, over the whole (relationshipType, fromType, toType) space', () => {
    fc.assert(
      fc.property(fc.constantFrom(...RELATIONSHIP_TYPES), fc.constantFrom(...ELEMENT_TYPES), fc.constantFrom(...ELEMENT_TYPES), (relationshipType, fromType, toType) => {
        const head = headWithEndpoints(fromType, toType);
        const attempt = () => fold(head, [relationshipCreateDelta(relationshipType)], ctx);
        if (isRelationshipTripleAllowed(relationshipType, fromType, toType)) {
          expect(attempt).not.toThrow();
        } else {
          expect(attempt).toThrow(EngineError);
        }
      }),
    );
  });

  it('also rejects when an endpoint does not exist at all, before it can even check the triple', () => {
    const delta = relationshipCreateDelta('uses');
    expect(() => fold(emptyHead(), [delta], ctx)).toThrow(/fromElementId .* does not exist/);
  });
});
