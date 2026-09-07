/**
 * A generated 2,000-system/4,000-edge landscape (UI-principles.md §8.6,
 * ADR-015's Playwright perf test) — the fixture both perf tests in
 * `e2e/landscape-perf.spec.ts` use. Lives under `e2e/`, not `src/`: this is
 * test setup data, never reachable from a production code path
 * (CLAUDE.md rule 7).
 *
 * Deterministic *given a `runSeed`* (CLAUDE.md rule 6: no `Math.random`,
 * even in a fixture — a seeded generator explicitly injected is exactly the
 * carve-out that rule names) — every id and edge is a pure function of
 * `(runSeed, index)`, so the fixture is reproducible within one run and the
 * payload-size test's own byte count stays exact for a fixed seed, but two
 * different runs (or a Playwright retry re-seeding the same still-live
 * local Supabase, Sprint C1-H item 1's own `deltas_pkey` collision) don't
 * generate identical `deltas.id`s (globally unique, not scoped per model)
 * and collide. Callers that need reproducibility (the payload-size test)
 * pass a fixed seed; callers seeding a real database per test run
 * (`landscape-perf.spec.ts`'s fps test) pass a fresh one, minted with
 * `crypto.randomUUID()` at the test's own top level exactly like every
 * other per-run id in that file (org/model/user ids) already is — rule 6's
 * ban is on `Math.random` inside anything that must *stay* reproducible,
 * not on generating a fresh run identity for something that shouldn't.
 */
import type { Delta } from '../../src/contracts/delta';

export const CAPABILITY_COUNT = 10;
export const SYSTEM_COUNT = 2000;
export const EDGE_COUNT = 4000;

/** A fixed seed for callers that need the exact same fixture (and so the exact same payload byte count) on every run — the payload-size test's own budget assertion depends on this being stable. */
export const FIXED_RUN_SEED = '0000';

/** Normalises any string into exactly 4 lowercase hex digits for `detUuid`'s seed segment — `crypto.randomUUID()`'s own hex is already valid input, just longer. */
function normaliseSeed(runSeed: string): string {
  const hex = runSeed.toLowerCase().replace(/[^0-9a-f]/g, '');
  return (hex + '0000').slice(0, 4);
}

/** A valid, deterministic-given-`runSeed` UUID: `namespace` (8 hex chars) identifies the entity kind, `runSeed` (4 hex chars) scopes it to one fixture-generation run, `index` fills the rest. Not `crypto.randomUUID()` for the id itself — see module comment. */
function detUuid(namespace: string, runSeed: string, index: number): string {
  return `${namespace}-${normaliseSeed(runSeed)}-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

export function capabilityId(runSeed: string, index: number): string {
  return detUuid('cccccccc', runSeed, index);
}

export function systemId(runSeed: string, index: number): string {
  return detUuid('55555555', runSeed, index);
}

/**
 * The fixture's deltas: `CAPABILITY_COUNT` capabilities, `SYSTEM_COUNT`
 * systems (every tenth external), one `supports` edge per system spread
 * evenly across the capabilities (the landscape's lane assignment), and
 * `EDGE_COUNT` `uses`/`flows_to` edges between systems (the landscape's
 * rendered edges — §6.1: `supports` never renders as a landscape edge).
 */
export function generateLandscapeFixture(sourceId: string, runSeed: string): Delta[] {
  const deltas: Delta[] = [];

  for (let c = 0; c < CAPABILITY_COUNT; c++) {
    deltas.push({
      kind: 'element.create',
      id: detUuid('d0000001', runSeed, c),
      elementId: capabilityId(runSeed, c),
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
      id: detUuid('d0000002', runSeed, s),
      elementId: systemId(runSeed, s),
      elementType: 'system',
      name: `System ${String(s).padStart(4, '0')}`,
      parentId: null,
      attributes: { lifecycleStatus: 'active', isExternal: s % 10 === 0 },
      sourceId,
      confidence: 1,
    });
    deltas.push({
      kind: 'relationship.create',
      id: detUuid('d0000003', runSeed, s),
      relationshipId: detUuid('80000001', runSeed, s),
      relationshipType: 'supports',
      fromElementId: systemId(runSeed, s),
      toElementId: capabilityId(runSeed, s % CAPABILITY_COUNT),
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
      id: detUuid('d0000004', runSeed, e),
      relationshipId: detUuid('80000002', runSeed, e),
      relationshipType: e % 2 === 0 ? 'uses' : 'flows_to',
      fromElementId: systemId(runSeed, from),
      toElementId: systemId(runSeed, to),
      attributes: {},
      sourceId,
      confidence: 1,
    });
  }

  return deltas;
}

/** The `element.create` delta id for `systemId(runSeed, 0)` — the one `singleAttributeEditDelta` below edits. */
export function firstSystemCreateDeltaId(runSeed: string): string {
  return detUuid('d0000002', runSeed, 0);
}

/** One more delta on top of the fixture: a single-attribute edit to one system, for the payload-size assertion (ADR-015). */
export function singleAttributeEditDelta(sourceId: string, runSeed: string): Delta {
  return {
    kind: 'element.update',
    id: detUuid('d0000005', runSeed, 0),
    elementId: systemId(runSeed, 0),
    elementType: 'system',
    attribute: 'vendor',
    value: 'Acme Corp',
    previousDeltaId: firstSystemCreateDeltaId(runSeed),
    sourceId,
    confidence: 1,
  };
}
