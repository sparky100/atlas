/**
 * V2b's Inspector, Capability map rollout: this view had no click-to-focus
 * concept of its own (every row's primary link navigates straight to the
 * element page), so the decided way in is a second small inline button
 * per row (`onInspectClick`, `CapabilityMapView.tsx`'s own `InspectButton`,
 * UI-principles.md §2.0/§6.5) that opens the Inspector scoped to that
 * capability without following the row's own primary link. For a domain
 * (L1), this button lives in the domain's own expanded body, not its
 * collapsed summary row — the same place its pre-redesign mobile
 * accordion already put it, now the only interaction model at every
 * width. This spec proves that button, and that Selection/Connections
 * show the capability's own direct facts (never rolled up the way a
 * domain's own aggregate tone is).
 *
 * The "collapse the panel and reload, it stays collapsed" scenario is not
 * repeated here — `inspector_collapsed` is one shared preference across
 * every view the Inspector appears on, already proven end-to-end by
 * e2e/landscape-inspector.spec.ts.
 *
 * Same "needs a real Supabase" limitation as e2e/capability-map.spec.ts.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('capability map inspector: the per-tile Inspect button opens Selection/Connections without navigating', async ({ page }) => {
  const env = loadEnv();

  const email = `capmap-inspector-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-map-inspector fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-map-inspector fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capmap-inspector-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability Map Inspector Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `capmap-inspector-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capability Map Inspector Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const rootId = randomUUID();
  const systemId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: rootId, elementType: 'capability', name: 'Housing', parentId: null, attributes: { code: '1' }, sourceId: seedSourceId, confidence: 1 },
    {
      kind: 'element.create',
      id: randomUUID(),
      elementId: systemId,
      elementType: 'system',
      name: 'Housing Portal',
      parentId: null,
      attributes: { lifecycleStatus: 'active', criticality: 'critical', isExternal: false },
      sourceId: seedSourceId,
      confidence: 1,
    },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: rootId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
  ];

  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: genesisCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed one L1 capability with a critical supporting system', body: null, deltas };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding the capability-map-inspector fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByText('Housing', { exact: true })).toBeVisible();

  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector.getByText('Nothing inspected.')).toBeVisible();

  // A domain's own Inspect button lives in its expanded body, not the
  // collapsed summary row.
  await page.getByRole('button', { name: /Housing/ }).click();
  await page.getByRole('button', { name: 'Inspect Housing' }).click();

  // Still on the capability map — the Inspect button never followed the
  // tile's own primary link.
  await expect(page).toHaveURL(new RegExp(`/o/${orgSlug}/m/${modelSlug}/capability-map`));
  await expect(inspector.getByText('Housing', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Capability (L1)')).toBeVisible();
  await expect(inspector.getByText('critical', { exact: true })).toBeVisible();
  await expect(inspector.getByRole('link', { name: 'Housing Portal' })).toBeVisible();
});
