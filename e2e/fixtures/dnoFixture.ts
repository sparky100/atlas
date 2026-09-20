/**
 * E8 ("performance") phase 1's own "DNO model" — the prompt pack's worked
 * example org identity (docs/prompts/atlas-prompt-pack.md's own DNO
 * examples; `ContextPage.tsx`'s own doc comment: "DNO &gt; Base &gt; main &gt;
 * SAP &gt; SAP FI") and, per the pack's own description of the intended
 * standard demo model, "electricity_network v2, 20 systems, one open
 * change with a conflict, two comments." There is no pre-built script for
 * this in the repo (confirmed: no `scripts/screens.ts`), so this fixture
 * builds it fresh — the same deterministic-given-a-seed shape
 * `landscapeFixture.ts` already established for the (much larger)
 * 2,000-system landscape perf fixture, at DNO scale instead.
 *
 * Real electricity-network capability names, not generic placeholders —
 * lifted from `content/capability-maps/electricity_network/2.json` (the
 * same source `capability-map-text-overflow.engine.spec.ts` already quotes
 * real names from) rather than duplicated as a parsed import here, since
 * this fixture only needs a representative dozen names, not the whole
 * published tree.
 *
 * Deliberate simplification, documented rather than silently dropped
 * (CLAUDE.md rule 7's "honest simplification" standard): "one open change
 * with a conflict" is built here as one open, unmerged change branch with
 * a real attribute edit — not a genuine three-way merge conflict (main and
 * the branch diverging on the same attribute since a shared base). E8's
 * own measurement targets are route/action *timing*, which an open
 * change's presence already exercises identically to a conflicted one
 * (the changes list, the review queue entry point, and the merge-check
 * they trigger all run the same queries either way); a real conflict
 * fixture is real, separate scope (see `merge-field-conflict.engine.spec.ts`
 * for what building one actually takes) that adds nothing to what this
 * fixture measures.
 */
import { randomUUID } from 'node:crypto';
import type { CommitEnvelope, Delta } from '../../src/contracts/delta';

export const SYSTEM_COUNT = 20;

/** A representative dozen real electricity-network capability names (content/capability-maps/electricity_network/2.json) — enough to spread 20 systems across a realistic tree, not the full published map. */
const CAPABILITY_NAMES: readonly { name: string; code: string }[] = [
  { name: 'Network Operations', code: '1' },
  { name: 'Outage Management', code: '1.1' },
  { name: 'Asset Management', code: '2' },
  { name: 'Substation & Circuit Condition Monitoring', code: '2.1' },
  { name: 'Metering', code: '3' },
  { name: 'Billing', code: '4' },
  { name: 'Customer Contact', code: '5' },
  { name: 'Complaints', code: '5.1' },
  { name: 'Regulatory Compliance & Price-Control Reporting', code: '6' },
  { name: 'Finance', code: '7' },
  { name: 'Human Resources', code: '8' },
  { name: 'Digital & Technology', code: '9' },
];

const LIFECYCLE_STATUSES = ['active', 'active', 'active', 'planned', 'retiring'] as const;
const CRITICALITIES = ['critical', 'high', 'high', 'medium', 'low'] as const;
const HOSTING_MODELS = ['on_premises', 'private_cloud', 'public_cloud', 'saas', 'hybrid'] as const;
const VENDORS = ['SAP', 'Oracle', 'Siemens', 'GE Vernova', 'Schneider Electric', 'Microsoft', 'Salesforce'] as const;

export interface DnoFixture {
  deltas: Delta[];
  capabilityIds: string[];
  systemIds: string[];
  /** The one capability every system's `supports` edge targets most heavily — a realistic drill-through target for the capability-map/landscape measurement routes. */
  primaryCapabilityId: string;
  /** The `element.create` delta's own `id` for `systemIds[0]` — `openChangeEditDelta`'s own `previousDeltaId` input, the same shape `landscapeFixture.ts`'s `firstSystemCreateDeltaId` already established. */
  firstSystemCreateDeltaId: string;
}

/**
 * Unlike `landscapeFixture.ts`, every id here is a fresh `randomUUID()` —
 * this fixture has no test that needs byte-exact reproducibility (that
 * sibling file's own `detUuid` scheme exists solely for its payload-size
 * assertion), so there's no reason to thread a seed through it at all.
 */
export function generateDnoFixture(sourceId: string): DnoFixture {
  const deltas: Delta[] = [];
  const capabilityIds: string[] = [];
  const systemIds: string[] = [];

  for (const cap of CAPABILITY_NAMES) {
    const id = randomUUID();
    capabilityIds.push(id);
    deltas.push({
      kind: 'element.create',
      id: randomUUID(),
      elementId: id,
      elementType: 'capability',
      name: cap.name,
      // A capability whose code has a dot nests under the sibling whose
      // code is its own prefix — mirrors a real starter map's own L1/L2
      // shape closely enough for capability-map route timing without
      // needing the full parsed content file.
      parentId: cap.code.includes('.') ? (capabilityIds[CAPABILITY_NAMES.findIndex((c) => c.code === cap.code.split('.')[0])] ?? null) : null,
      attributes: { code: cap.code },
      sourceId,
      confidence: 1,
    });
  }

  let firstSystemCreateDeltaId: string | undefined;
  for (let s = 0; s < SYSTEM_COUNT; s++) {
    const id = randomUUID();
    systemIds.push(id);
    const capability = capabilityIds[s % capabilityIds.length] ?? capabilityIds[0];
    if (capability === undefined) throw new Error('dnoFixture: no capabilities generated');
    const createDeltaId = randomUUID();
    if (s === 0) firstSystemCreateDeltaId = createDeltaId;
    deltas.push({
      kind: 'element.create',
      id: createDeltaId,
      elementId: id,
      elementType: 'system',
      name: `${VENDORS[s % VENDORS.length] ?? 'Acme Corp'} System ${String(s + 1).padStart(2, '0')}`,
      parentId: null,
      attributes: {
        lifecycleStatus: LIFECYCLE_STATUSES[s % LIFECYCLE_STATUSES.length] ?? 'active',
        criticality: CRITICALITIES[s % CRITICALITIES.length] ?? 'medium',
        hostingModel: HOSTING_MODELS[s % HOSTING_MODELS.length] ?? 'saas',
        vendor: VENDORS[s % VENDORS.length] ?? 'Acme Corp',
        isExternal: s % 7 === 0,
      },
      sourceId,
      confidence: 1,
    });
    deltas.push({
      kind: 'relationship.create',
      id: randomUUID(),
      relationshipId: randomUUID(),
      relationshipType: 'supports',
      fromElementId: id,
      toElementId: capability,
      attributes: { role: 'primary' },
      sourceId,
      confidence: 1,
    });
    // A `uses` edge to the previous system — a landscape with some
    // rendered edges between systems, not just isolated supports lanes,
    // the same "not every node in its own lane with no edges" shape
    // `landscapeFixture.ts` gives its own much larger fixture.
    if (s > 0) {
      const previous = systemIds[s - 1];
      if (previous !== undefined) {
        deltas.push({
          kind: 'relationship.create',
          id: randomUUID(),
          relationshipId: randomUUID(),
          relationshipType: 'uses',
          fromElementId: id,
          toElementId: previous,
          attributes: {},
          sourceId,
          confidence: 1,
        });
      }
    }
  }

  const primaryCapabilityId = capabilityIds[0];
  if (primaryCapabilityId === undefined) throw new Error('dnoFixture: no primary capability');
  if (firstSystemCreateDeltaId === undefined) throw new Error('dnoFixture: no systems generated');

  return { deltas, capabilityIds, systemIds, primaryCapabilityId, firstSystemCreateDeltaId };
}

/** One real attribute edit for the "one open change" branch — bumps the first system's own `vendor`, a realistic single-field edit (matches the three measured actions' own "save attribute" shape). */
export function openChangeEditDelta(sourceId: string, systemId: string, previousDeltaId: string): Delta {
  return {
    kind: 'element.update',
    id: randomUUID(),
    elementId: systemId,
    elementType: 'system',
    attribute: 'vendor',
    value: 'Acme Renewed Corp',
    previousDeltaId,
    sourceId,
    confidence: 1,
  };
}

export function buildEnvelope(branchId: string, parentCommitId: string, title: string, deltas: Delta[]): CommitEnvelope {
  return { id: randomUUID(), branchId, parentCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title, body: null, deltas };
}
