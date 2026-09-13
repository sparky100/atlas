/**
 * Prompt 7k item 5 / the shared changes-discussion item: the prompt pack's
 * own named Playwright scenario: "remove a system with relationships in
 * one commit."
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { getOrCreateManualSource } from '../src/db/sources';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('removing a system from the model retracts every one of its relationships alongside it, in one commit', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'removeall', 'Field Devices Gateway');
  const { signedIn: owner, orgId, orgSlug, modelId, modelSlug, systemId, userId: ownerId, main } = fixture;

  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: ownerId });
  const capabilityId = randomUUID();
  const actorId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Metering', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: actorId, elementType: 'actor', name: 'Ops Team', parentId: null, attributes: { subtype: 'team', isExternal: false }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: capabilityId, attributes: { role: 'secondary' }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'owns', fromElementId: actorId, toElementId: systemId, attributes: { role: 'technical' }, sourceId: source.id, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed a capability, an owning actor, and two relationships', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seed capability/actor/relationships: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}?ref=main`);
  await expect(page.getByRole('heading', { name: 'Field Devices Gateway' })).toBeVisible();

  // The confirmation lists the element and both relationships being
  // retracted alongside it — real, listed content (CLAUDE.md rule 7), not
  // a bare confirm() string.
  await page.getByRole('button', { name: 'Element actions' }).click();
  await page.getByRole('button', { name: 'Remove from model…' }).click();
  await expect(page.getByText('Field Devices Gateway (the element itself)')).toBeVisible();
  await expect(page.getByText('Field Devices Gateway supports Metering')).toBeVisible();
  await expect(page.getByText('Field Devices Gateway owned by Ops Team')).toBeVisible();

  // `exact: true` — a plain substring match would also catch the header
  // menu's own "Remove from model…" item.
  await page.getByRole('button', { name: 'Remove from model', exact: true }).click();

  // One commit later, the element is gone from this ref entirely.
  await expect(page.getByText('This element is not present here', { exact: false })).toBeVisible({ timeout: 15_000 });

  // Its relationships went with it, in the same commit — Metering no
  // longer lists Field Devices Gateway as a supporter.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${capabilityId}?ref=main`);
  await expect(page.getByRole('heading', { name: 'Metering' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Field Devices Gateway' })).toHaveCount(0);
});
