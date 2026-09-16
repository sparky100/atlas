/**
 * P-33 (new — ADR-019, E7): "merge two elements, then undo, restores the
 * identical state." Also exercises RT-6's own engine-testable half (SPEC
 * §10): the survivor carries every relationship the loser had, deduplicated
 * per S-6, with the two cardinality collisions ADR-021 §4.3 already named a
 * convention for (`supports.role='primary'` demotes to `'secondary'`;
 * `owns` has no neutral value, so the losing edge is dropped) reused here
 * rather than invented fresh. RT-6's own `aliases`/`element_merges` half
 * needs a real Supabase and is covered by the (not yet written)
 * integration test instead.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Delta, UUID } from '../contracts/delta';
import { cloneHead, emptyHead, fold, type CommitContext, type Head } from './deltas';
import { buildMergeElementsDeltas, buildUndoMergeElementsDeltas } from './mergeElements';

const ctx: CommitContext = { authorId: 'author-1', createdAt: '2026-01-01T00:00:00.000Z' };
const SOURCE_ID = 'merge-elements-source';

function createElement(id: UUID, elementId: UUID, elementType: string, name: string, parentId: UUID | null = null, attributes: Record<string, unknown> = {}): Delta {
  return { kind: 'element.create', id, elementId, elementType, name, parentId, attributes, sourceId: SOURCE_ID, confidence: 1 } as never;
}

function createRelationship(id: UUID, relationshipId: UUID, relationshipType: string, fromElementId: UUID, toElementId: UUID, attributes: Record<string, unknown> = {}): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType, fromElementId, toElementId, attributes, sourceId: SOURCE_ID, confidence: 1 } as never;
}

interface Scenario {
  head: Head;
  survivorId: UUID;
  loserId: UUID;
}

interface ScenarioParams {
  plainRelCount: number;
  childCount: number;
  hasDedupCollision: boolean;
  hasSupportsCollision: boolean;
  hasOwnsCollision: boolean;
  hasSelfLoop: boolean;
}

function buildScenario(params: ScenarioParams): Scenario {
  const deltas: Delta[] = [
    createElement('d-survivor', 'survivor', 'system', 'Survivor', null, { lifecycleStatus: 'active', isExternal: false }),
    createElement('d-loser', 'loser', 'system', 'Loser', null, { lifecycleStatus: 'active', isExternal: false }),
    createElement('d-capA', 'capA', 'capability', 'A'),
    createElement('d-capB', 'capB', 'capability', 'B'),
    createElement('d-owner1', 'owner1', 'actor', 'Owner 1', null, { subtype: 'team', isExternal: false }),
    createElement('d-owner2', 'owner2', 'actor', 'Owner 2', null, { subtype: 'team', isExternal: false }),
  ];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${String((seq += 1))}`;

  for (let i = 0; i < params.plainRelCount; i += 1) {
    const targetId = `f-${String(i)}`;
    deltas.push(createElement(nextId('f-create'), targetId, 'system', `F${String(i)}`, null, { lifecycleStatus: 'active', isExternal: false }));
    deltas.push(createRelationship(nextId('f-rel'), `r-${String(i)}`, 'uses', targetId, 'loser'));
  }

  for (let j = 0; j < params.childCount; j += 1) {
    deltas.push(createElement(nextId('g-create'), `g-${String(j)}`, 'system', `G${String(j)}`, 'loser'));
  }

  if (params.hasDedupCollision) {
    // A plain S-6 duplicate, deliberately on a relationship type/target the
    // cardinality scenarios below never touch (`uses` a fresh element `h`),
    // so this flag combines cleanly with either cardinality flag without
    // the fixture itself accidentally starting from an already-invalid
    // (duplicate) state.
    deltas.push(createElement(nextId('h-create'), 'h', 'system', 'H', null, { lifecycleStatus: 'active', isExternal: false }));
    deltas.push(createRelationship(nextId('dup-survivor'), 'rel-dup-survivor', 'uses', 'survivor', 'h'));
    deltas.push(createRelationship(nextId('dup-loser'), 'rel-dup-loser', 'uses', 'loser', 'h'));
  }

  if (params.hasSupportsCollision) {
    deltas.push(createRelationship(nextId('sup-survivor'), 'rel-sup-survivor', 'supports', 'survivor', 'capA', { role: 'primary' }));
    deltas.push(createRelationship(nextId('sup-loser'), 'rel-sup-loser', 'supports', 'loser', 'capB', { role: 'primary' }));
  }

  if (params.hasOwnsCollision) {
    deltas.push(createRelationship(nextId('owns-survivor'), 'rel-owns-survivor', 'owns', 'owner1', 'survivor', { role: 'business' }));
    deltas.push(createRelationship(nextId('owns-loser'), 'rel-owns-loser', 'owns', 'owner2', 'loser', { role: 'business' }));
  }

  if (params.hasSelfLoop) {
    deltas.push(createRelationship(nextId('loop'), 'rel-loop', 'uses', 'loser', 'survivor'));
  }

  const head = fold(emptyHead(), deltas, ctx);
  return { head, survivorId: 'survivor', loserId: 'loser' };
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    plainRelCount: fc.integer({ min: 0, max: 2 }),
    childCount: fc.integer({ min: 0, max: 2 }),
    hasDedupCollision: fc.boolean(),
    hasSupportsCollision: fc.boolean(),
    hasOwnsCollision: fc.boolean(),
    hasSelfLoop: fc.boolean(),
  })
  .map(buildScenario);

/** V6 (SPEC §5.2): no two live relationships share `(type, from, to)` — `apply()` itself never checks this, matching the same gap the ADR-021 property suite already found. */
function assertNoDuplicateRelationships(head: Head): void {
  const seen = new Set<string>();
  for (const rel of head.relationships.values()) {
    const key = `${rel.relationshipType}:${rel.fromElementId}:${rel.toElementId}`;
    expect(seen.has(key), `V6: duplicate live relationship ${key}`).toBe(false);
    seen.add(key);
  }
}

/** C17-equivalent (SPEC §5.2): at most one live `supports.role='primary'` per `fromElementId`, and at most one live `owns` edge per `(toElementId, role)` — the two cardinality limits a merge could otherwise silently violate by re-pointing both sides onto the survivor. */
function assertCardinalityHolds(head: Head): void {
  const primarySupportsFrom = new Set<UUID>();
  const ownsRoleByTo = new Set<string>();
  for (const rel of head.relationships.values()) {
    if (rel.relationshipType === 'supports' && rel.attributes.role === 'primary') {
      expect(primarySupportsFrom.has(rel.fromElementId), `two live primary supports edges from ${rel.fromElementId}`).toBe(false);
      primarySupportsFrom.add(rel.fromElementId);
    }
    if (rel.relationshipType === 'owns' && typeof rel.attributes.role === 'string') {
      const key = `${rel.toElementId}:${rel.attributes.role}`;
      expect(ownsRoleByTo.has(key), `two live owns edges into ${rel.toElementId} with role ${rel.attributes.role}`).toBe(false);
      ownsRoleByTo.add(key);
    }
  }
}

/** A delta-id-independent view of a head's real content — what "restores exactly" and "merges cleanly" both actually mean (never the specific delta ids involved, which are minted fresh on every write and never reused, by design). */
function stateSnapshot(head: Head) {
  const elements = [...head.elements.entries()]
    .map(([id, el]) => ({ id, elementType: el.elementType, name: el.name, parentId: el.parentId, attributes: el.attributes }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const relationships = [...head.relationships.entries()]
    .map(([id, rel]) => ({ id, relationshipType: rel.relationshipType, fromElementId: rel.fromElementId, toElementId: rel.toElementId, attributes: rel.attributes }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { elements, relationships };
}

describe('buildMergeElementsDeltas', () => {
  it('for every combination of dedup/cardinality/self-loop/children: merges cleanly, never duplicates a relationship, never violates cardinality, and re-parents every child', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        let seq = 0;
        const mintId = () => `merge-${String((seq += 1))}`;
        const { deltas } = buildMergeElementsDeltas(scenario.head, scenario.survivorId, scenario.loserId, SOURCE_ID, mintId);

        const finalHead = cloneHead(scenario.head);
        expect(() => fold(finalHead, deltas, ctx)).not.toThrow();

        expect(finalHead.elements.has(scenario.loserId)).toBe(false);
        assertNoDuplicateRelationships(finalHead);
        assertCardinalityHolds(finalHead);

        for (const [id, el] of scenario.head.elements) {
          if (el.parentId === scenario.loserId) expect(finalHead.elements.get(id)?.parentId).toBe(scenario.survivorId);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('P-33: merge then undo restores the identical state (ADR-019, E7)', () => {
  it('for every combination this scenario covers: buildUndoMergeElementsDeltas exactly reverses buildMergeElementsDeltas', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const before = stateSnapshot(scenario.head);

        let mergeSeq = 0;
        const mergeMintId = () => `merge-${String((mergeSeq += 1))}`;
        const { deltas: mergeDeltas } = buildMergeElementsDeltas(scenario.head, scenario.survivorId, scenario.loserId, SOURCE_ID, mergeMintId);

        const afterMerge = cloneHead(scenario.head);
        fold(afterMerge, mergeDeltas, ctx);
        expect(afterMerge.elements.has(scenario.loserId)).toBe(false); // sanity: the merge actually happened.

        let undoSeq = 0;
        const undoMintId = () => `undo-${String((undoSeq += 1))}`;
        const { deltas: undoDeltas } = buildUndoMergeElementsDeltas(mergeDeltas, scenario.loserId, SOURCE_ID, undoMintId);

        const afterUndo = cloneHead(afterMerge);
        expect(() => fold(afterUndo, undoDeltas, ctx)).not.toThrow();

        expect(stateSnapshot(afterUndo)).toEqual(before);
      }),
      { numRuns: 300 },
    );
  });
});
