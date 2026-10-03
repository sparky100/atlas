/**
 * Capability rollup (Sprint U4-2, "capability rollup", decided): a
 * level-1 tile's system count and its "N/M supported" fraction are a
 * rollup over the capability's own subtree (itself plus every L2/L3
 * descendant), deduped by system — computed once by
 * `src/ui/capabilityMap/capabilityRollup.ts` and called by every surface
 * that renders a level-1 tile, replacing each one's own former ad hoc
 * count. This spec seeds a level-1 capability with six children, exactly
 * one of which is supported by one system, and proves the same rolled-up
 * numbers — "1" system, "1/7" capabilities supported (the L1 itself plus
 * its six children) — appear consistently across all four surfaces: the
 * director door, the capability map desktop, the capability map mobile
 * accordion, and the capability-scoped landscape (`/landscape?capability=`).
 *
 * Deep-linking, seeded directly via `commitToBranch` (not a click-only
 * golden path) — same "needs a real Supabase" limitation as
 * e2e/capability-map.spec.ts, hence `.engine.spec.ts`.
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

test('capability rollup: the same "1 system, 1/7 supported" rollup appears on the director door, capability map desktop, capability map mobile, and the capability-scoped landscape', async ({ page }) => {
  const env = loadEnv();

  const email = `caprollup-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-rollup fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-rollup fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `caprollup-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability Rollup Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `caprollup-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capability Rollup Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  // One level-1 capability, six children — only the first child gets a
  // supporting system. Subtree size = 7 (the L1 itself + 6 children); one
  // of the 7 has a direct supporter — "1/7 supported", "1 system", the
  // exact rollup this spec proves is consistent everywhere.
  const rootId = randomUUID();
  const childIds = Array.from({ length: 6 }, () => randomUUID());
  const systemId = randomUUID();

  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: rootId, elementType: 'capability', name: 'Digital Services', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    ...childIds.map(
      (childId, index): Delta => ({ kind: 'element.create', id: randomUUID(), elementId: childId, elementType: 'capability', name: `Child ${String(index + 1)}`, parentId: rootId, attributes: {}, sourceId: seedSourceId, confidence: 1 }),
    ),
    { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Housing Portal', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    // The only supporting edge in the whole subtree, on one of the six
    // children (never the L1 itself) — proving the rollup actually walks
    // descendants, not just the L1's own direct edges.
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: childIds[0] as string, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
  ];

  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a level-1 capability with six children, one supported',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding capability-rollup fixture: ${seedResult.message}`);

  // 1) Director door.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  // The org's creator is its owner, so the default door is architect —
  // switch to director, same precedent as e2e/director-door.engine.spec.ts.
  await page.getByRole('button', { name: 'Overview' }).click();
  const directorTile = page.getByRole('link', { name: /Digital Services/ });
  await expect(directorTile).toBeVisible();
  await expect(directorTile.getByText('1 system', { exact: false })).toBeVisible();
  await expect(directorTile.getByText('1/7 supported')).toBeVisible();

  // 2) Capability map (capability map density redesign: the domain row's
  // own coverage sentence and supporting-system count are both always
  // visible, collapsed or not — no expand needed to see the rollup).
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByText('Digital Services', { exact: true })).toBeVisible();
  await expect(page.getByText('1 of 7 capabilities have a supporting system')).toBeVisible();
  await expect(page.getByText('1 system', { exact: true })).toBeVisible();

  // 3) Same page, narrower viewport (<768px) — one accordion model at
  // every width post-redesign, not a separate mobile layout.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByText('Digital Services', { exact: true })).toBeVisible();
  await expect(page.getByText('1 of 7 capabilities have a supporting system')).toBeVisible();
  await expect(page.getByText('1 system', { exact: true })).toBeVisible();

  // 4) Capability-scoped landscape (`/landscape?capability=`).
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape?capability=${rootId}`);
  await expect(page.getByText('Systems supporting Digital Services (1)')).toBeVisible();
  await expect(page.getByText('1/7 capabilities supported')).toBeVisible();
  await expect(page.getByText('Housing Portal')).toBeVisible();
});
