/**
 * The architect door's Health findings (Handoff 7d's architect-door
 * amendment, `docs/HANDOFF-7d-architect-door.md`, UI-principles §3.2):
 * systems not linked to a capability, capabilities with no owner,
 * attributes stale over `STALE_AFTER_MONTHS`, and the duplicates count
 * (already wired to 0, ADR-019). Seeds a realistic mix through the real
 * `commitToBranch` path from Node (ADR-018 — main already has a genesis
 * commit, no bootstrap needed), then drives the actual UI through the
 * browser.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('architect door: health findings name systems with no capability, capabilities with no owner, and stale attributes', async ({ page }) => {
  const env = loadEnv();

  const email = `healthfindings-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`health-findings fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`health-findings fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `healthfindings-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Health Findings Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `healthfindings-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Health Findings Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const ownedCapabilityId = randomUUID();
  const unownedCapabilityId = randomUUID();
  const ownedSystemId = randomUUID();
  const ownedSystemCreateDeltaId = randomUUID();
  const unownedSystemId = randomUUID(); // supports unownedCapability, but no primary owner
  const orphanSystemId = randomUUID(); // supports nothing at all
  const actorId = randomUUID();

  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed capabilities, systems, an actor, and a stale vendor fact',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: ownedCapabilityId, elementType: 'capability', name: 'Owned Capability', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: unownedCapabilityId, elementType: 'capability', name: 'Unowned Capability', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: ownedSystemCreateDeltaId, elementId: ownedSystemId, elementType: 'system', name: 'Well Owned System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: unownedSystemId, elementType: 'system', name: 'Unowned System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: orphanSystemId, elementType: 'system', name: 'Orphan System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: actorId, elementType: 'actor', name: 'Housing Digital Team', parentId: null, attributes: { subtype: 'team', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: ownedSystemId, toElementId: ownedCapabilityId, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: unownedSystemId, toElementId: unownedCapabilityId, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'owns', fromElementId: actorId, toElementId: ownedSystemId, attributes: { primary: true }, sourceId: seedSourceId, confidence: 1 },
      // A vendor fact over a year old — Unowned System's own "stale attribute".
      {
        kind: 'element.update',
        id: randomUUID(),
        elementId: unownedSystemId,
        elementType: 'system',
        attribute: 'vendor',
        value: 'Legacy Supplier Ltd',
        previousDeltaId: ownedSystemCreateDeltaId,
        sourceId: seedSourceId,
        confidence: 1,
        effectiveDate: '2024-01-01',
      },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding health-findings fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  // The org's creator is its owner, so the default door is already architect.
  await expect(page.getByRole('heading', { name: 'Health findings' })).toBeVisible();

  await expect(page.getByText('1 system not linked to a capability')).toBeVisible();
  await expect(page.getByText('Orphan System', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Review and link/ })).toBeVisible();

  await expect(page.getByText('1 capability with no owner')).toBeVisible();
  await expect(page.getByText('Unowned Capability', { exact: true })).toBeVisible();
  // The owned capability must not appear in the no-owner finding.
  await expect(page.getByText('Owned Capability', { exact: true })).toHaveCount(0);

  await expect(page.getByText('1 attribute stale over 12 months')).toBeVisible();
  await expect(page.getByText(/across 1 system · oldest \dy/)).toBeVisible();

  await expect(page.getByText('0 duplicates flagged')).toBeVisible();
});
