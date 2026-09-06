/**
 * A generated 2,000-system/4,000-edge landscape (UI-principles.md §8.6,
 * ADR-015's Playwright perf test) — the fixture both perf tests in
 * `e2e/landscape-perf.spec.ts` use. Lives under `e2e/`, not `src/`: this is
 * test setup data, never reachable from a production code path
 * (CLAUDE.md rule 7).
 *
 * Deterministic throughout (CLAUDE.md rule 6: no `Math.random`, even in a
 * fixture) — every id and edge is a pure function of its index, so the
 * fixture (and the payload-size number it produces) is identical on every
 * CI run, not a new random shape each time.
 */
import type { Delta } from '../../src/contracts/delta';

export const CAPABILITY_COUNT = 10;
export const SYSTEM_COUNT = 2000;
export const EDGE_COUNT = 4000;

/** A valid, deterministic UUID: `namespace` (8 hex chars) identifies the entity kind, `index` fills the rest. Not `crypto.randomUUID()` — see module comment. */
function detUuid(namespace: string, index: number): string {
  return `${namespace}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

export function capabilityId(index: number): string {
  return detUuid('cccccccc', index);
}

export function systemId(index: number): string {
  return detUuid('55555555', index);
}

/**
 * The fixture's deltas: `CAPABILITY_COUNT` capabilities, `SYSTEM_COUNT`
 * systems (every tenth external), one `supports` edge per system spread
 * evenly across the capabilities (the landscape's lane assignment), and
 * `EDGE_COUNT` `uses`/`flows_to` edges between systems (the landscape's
 * rendered edges — §6.1: `supports` never renders as a landscape edge).
 */
export function generateLandscapeFixture(sourceId: string): Delta[] {
  const deltas: Delta[] = [];

  for (let c = 0; c < CAPABILITY_COUNT; c++) {
    deltas.push({
      kind: 'element.create',
      id: detUuid('d0000001', c),
      elementId: capabilityId(c),
      elementType: 'capability',
      name: `Capability ${String(c)}`,
      parentId: null,
      attributes: {},
      sourceId,
      confidence: 1,
    });
  }

  for (let s = 0; s < SYSTEM_COUNT; s++) {
    deltas.push({
      kind: 'element.create',
      id: detUuid('d0000002', s),
      elementId: systemId(s),
      elementType: 'system',
      name: `System ${String(s).padStart(4, '0')}`,
      parentId: null,
      attributes: { lifecycleStatus: 'active', isExternal: s % 10 === 0 },
      sourceId,
      confidence: 1,
    });
    deltas.push({
      kind: 'relationship.create',
      id: detUuid('d0000003', s),
      relationshipId: detUuid('80000001', s),
      relationshipType: 'supports',
      fromElementId: systemId(s),
      toElementId: capabilityId(s % CAPABILITY_COUNT),
      attributes: {},
      sourceId,
      confidence: 1,
    });
  }

  for (let e = 0; e < EDGE_COUNT; e++) {
    const from = e % SYSTEM_COUNT;
    let to = (from * 7 + 13 + Math.floor(e / SYSTEM_COUNT) * 11) % SYSTEM_COUNT;
    if (to === from) to = (to + 1) % SYSTEM_COUNT;
    deltas.push({
      kind: 'relationship.create',
      id: detUuid('d0000004', e),
      relationshipId: detUuid('80000002', e),
      relationshipType: e % 2 === 0 ? 'uses' : 'flows_to',
      fromElementId: systemId(from),
      toElementId: systemId(to),
      attributes: {},
      sourceId,
      confidence: 1,
    });
  }

  return deltas;
}

/** The `element.create` delta id for `systemId(0)` — the one `singleAttributeEditDelta` below edits. */
export function firstSystemCreateDeltaId(): string {
  return detUuid('d0000002', 0);
}

/** One more delta on top of the fixture: a single-attribute edit to one system, for the payload-size assertion (ADR-015). */
export function singleAttributeEditDelta(sourceId: string): Delta {
  return {
    kind: 'element.update',
    id: detUuid('d0000005', 0),
    elementId: systemId(0),
    elementType: 'system',
    attribute: 'vendor',
    value: 'Acme Corp',
    previousDeltaId: firstSystemCreateDeltaId(),
    sourceId,
    confidence: 1,
  };
}
