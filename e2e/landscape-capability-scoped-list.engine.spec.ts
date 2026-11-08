/**
 * Sprint U4-2c item 2: "Capability-scoped landscape (/landscape?capability=X,
 * desktop and mobile): a flat list of the systems supporting X, sectioned
 * Primary / Also supports, child capabilities' systems included with the
 * child named ... No lanes, no cross-lane chips. Title 'Systems supporting
 * X (N)'." Real DOM throughout (`CapabilityLandscapeList.tsx`'s own module
 * comment) — no canvas coordinate math needed, unlike every lane-based
 * landscape e2e spec.
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

test('the capability-scoped landscape lists Primary and Also-supports systems, names the child capability for a rolled-up one, and omits zero usage', async ({ page }) => {
  const env = loadEnv();

  const email = `capability-landscape-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-landscape fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-landscape fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capability-landscape-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability Landscape Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `capability-landscape-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capability Landscape Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const rootId = randomUUID();
  const childId = randomUUID();
  const primarySystemId = randomUUID();
  const secondarySystemId = randomUUID();
  const childSystemId = randomUUID();
  const ownerId = randomUUID();

  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a capability, a child capability, and three supporting systems',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: rootId, elementType: 'capability', name: 'Billing', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: childId, elementType: 'capability', name: 'Invoicing', parentId: rootId, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: primarySystemId, elementType: 'system', name: 'Billing Platform', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: secondarySystemId, elementType: 'system', name: 'Legacy Ledger', parentId: null, attributes: { lifecycleStatus: 'retiring', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: childSystemId, elementType: 'system', name: 'Invoicing Service', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: ownerId, elementType: 'actor', name: 'Finance Team', parentId: null, attributes: { subtype: 'team', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: primarySystemId, toElementId: rootId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: secondarySystemId, toElementId: rootId, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
      // Rolled up through the child — never an exact match on `rootId` itself.
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: childSystemId, toElementId: childId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'uses', fromElementId: primarySystemId, toElementId: secondarySystemId, attributes: { description: 'reconciles ledger entries with' }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'owns', fromElementId: ownerId, toElementId: primarySystemId, attributes: { role: 'business' }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding capability-landscape fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape?capability=${rootId}`);

  // Never the lane-based canvas, on any width — item 2's own "no lanes".
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Systems supporting Billing (3)' })).toBeVisible();

  const primaryRow = page.locator('li').filter({ hasText: 'Billing Platform' });
  const secondaryRow = page.locator('li').filter({ hasText: 'Legacy Ledger' });
  const childRow = page.locator('li').filter({ hasText: 'Invoicing Service' });

  // Primary vs. Also supports sectioning.
  // A row is sectioned by its own edge's role — Invoicing Service's edge to
  // the child is `primary`, so it's Primary here (named "via Invoicing").
  await expect(page.getByRole('heading', { name: 'Main systems (2)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Other systems (1)' })).toBeVisible();

  // The child-capability rollup names its own capability, on a row that
  // has no direct edge to Billing itself.
  await expect(childRow.getByText('via Invoicing')).toBeVisible();
  await expect(primaryRow.getByText(/^via /)).toHaveCount(0);

  // Owner shown when recorded, "—" otherwise.
  await expect(primaryRow.getByRole('link', { name: 'Finance Team' })).toBeVisible();
  await expect(secondaryRow.getByText('—', { exact: true })).toBeVisible();

  // "uses N · used by N" only when non-zero — the seeded `uses` edge runs
  // Billing Platform → Legacy Ledger, so each shows its own side of it and
  // Invoicing Service (with none) shows nothing.
  await expect(primaryRow.getByText('uses 1 · used by 0')).toBeVisible();
  await expect(secondaryRow.getByText('uses 0 · used by 1')).toBeVisible();
  await expect(childRow.getByText(/uses \d+ · used by \d+/)).toHaveCount(0);

  // Context → navigates to the right system.
  await primaryRow.getByRole('link', { name: 'Context →' }).click();
  await expect(page).toHaveURL(new RegExp(`/context/${primarySystemId}`));
});

test('the capability-scoped landscape renders the same flat list at a 390px mobile width — no viewport split, unlike the lane-based landscape', async ({ page }) => {
  const env = loadEnv();

  const email = `capability-landscape-mobile-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-landscape-mobile fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-landscape-mobile fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capability-landscape-mobile-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability Landscape Mobile Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `capability-landscape-mobile-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capability Landscape Mobile Test Model', slug: modelSlug, createdBy: userId });

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
  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a capability with one supporting system',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: rootId, elementType: 'capability', name: 'Payments', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Payments Gateway', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: rootId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding capability-landscape-mobile fixture: ${seedResult.message}`);

  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape?capability=${rootId}`);

  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Systems supporting Payments (1)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Payments Gateway' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});
