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
import type { Delta, LifecycleStatus, UUID } from '../contracts/delta';
import type { Json } from '../contracts/rows';
import { cloneHead, emptyHead, factMapKey, fold, invert, type CommitContext, type Head } from './deltas';
import { canonicalizeHead, headHash } from './head';

const ctx: CommitContext = { authorId: 'author-1', createdAt: '2026-01-01T00:00:00.000Z' };
const uuid = fc.uuid();
const lifecycleStatuses: LifecycleStatus[] = ['planned', 'active', 'retiring', 'retired'];

/** One `system` element's life: a create, then a chain of updates with correctly-linked previousDeltaId, covering name/parentId/an-always-present attribute/an-optional-attribute-set-for-the-first-time. */
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
        target: fc.constantFrom('name' as const, 'lifecycleStatus' as const, 'vendor' as const, 'parentId' as const),
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

describe('invert', () => {
  // Values come back exactly; provenance does not (a fresh delta always
  // gets a fresh deltaId/author/etc — see the long comment on `invert` in
  // deltas.ts). So this compares elements/relationships only, never facts.
  function valuesOnly(head: Head) {
    const { elements, relationships } = canonicalizeHead(head);
    return { elements, relationships };
  }

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
