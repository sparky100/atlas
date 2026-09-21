/**
 * ADR-001 amendment, PR6: the capability map's "Lifecycle exposure"
 * colour-by (`lifecycleExposure`, `src/ui/capabilityMap/metrics.ts`) and
 * the architect door's "critical-exposed" health finding
 * (`findCriticalExposedSystems`, `src/db/healthFindings.ts`) both now clear
 * once a live `replaces` edge points at the exposed system — existence
 * only, regardless of the replacement's own health.
 *
 * Deliberately seeded via a raw `replaces` edge, never through the Retire…
 * UI flow: Retire's own "replaced by" picker also *transfers* the retiring
 * element's `supports` edges onto the replacement (PR3), which would clear
 * exposure on its own (the exposed system stops supporting the capability
 * at all) and never actually exercise this PR's own new check — a
 * capability whose only supporting system is the *retiring* one, still
 * linked, with nothing but a `replaces` edge pointing at it.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { getOrCreateManualSource } from '../src/db/sources';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('a replaces edge clears both the capability map\'s lifecycle exposure colour-by and the critical-exposed health finding', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'replaces-exposure', 'Legacy Critical System');
  const { signedIn: owner, orgId, orgSlug, modelId, modelSlug, systemId, createDeltaId, userId: ownerId, main } = fixture;

  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: ownerId });
  const capabilityId = randomUUID();
  const replacementId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Grid Balancing', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: replacementId, elementType: 'system', name: 'New Balancing Platform', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: capabilityId, attributes: { role: 'primary' }, sourceId: source.id, confidence: 1 },
    // Critical, past its own planned end — exposed by every existing rule
    // this PR doesn't touch (criticality + plannedEnd), so the only thing
    // that can clear either finding below is the replaces edge itself.
    { kind: 'element.update', id: randomUUID(), elementId: systemId, elementType: 'system', attribute: 'criticality', value: 'critical', previousDeltaId: createDeltaId, sourceId: source.id, confidence: 1 },
    { kind: 'element.update', id: randomUUID(), elementId: systemId, elementType: 'system', attribute: 'plannedEnd', value: '2026-01-01', previousDeltaId: createDeltaId, sourceId: source.id, confidence: 1 },
  ];
  const seedEnvelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed a critical exposed system supporting a capability, and its replacement', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seed capability/system/replacement: ${seedResult.message}`);

  // 1. Baseline: both findings read exposed before the replaces edge exists.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await page.getByLabel('Colour by').selectOption('metric:lifecycleExposure');
  await expect(page.getByText('Grid Balancing', { exact: true })).toBeVisible();
  await expect(page.getByText('exposed')).toBeVisible();

  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await expect(page.getByText('1 critical system exposed with no planned replacement')).toBeVisible();

  // 2. Add the replaces edge itself — direct, not through Retire…, and
  // without touching the existing supports edge at all.
  const currentMain = await getMainBranch(owner, modelId);
  if (!currentMain) throw new Error('main branch missing after seed');
  const replacesDeltas: Delta[] = [
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'replaces', fromElementId: replacementId, toElementId: systemId, attributes: {}, sourceId: source.id, confidence: 1 },
  ];
  const replacesEnvelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: currentMain.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'record the real replacement', body: null, deltas: replacesDeltas };
  const replacesResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: currentMain.head_commit_id, envelope: replacesEnvelope });
  if (!replacesResult.ok) throw new Error(`seed replaces edge: ${replacesResult.message}`);

  // 3. Both findings clear — the capability's only supporting system is
  // still the exposed one (never transferred), and it's still critical
  // with the same past plannedEnd; only the replaces edge changed.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await page.getByLabel('Colour by').selectOption('metric:lifecycleExposure');
  await expect(page.getByText('Grid Balancing', { exact: true })).toBeVisible();
  await expect(page.getByText('exposed')).toHaveCount(0);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await expect(page.getByText('1 critical system exposed with no planned replacement')).toHaveCount(0);
});
