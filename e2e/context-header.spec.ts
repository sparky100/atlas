/**
 * Sprint U4-2b item 12: "Header shows 'Supports: <capabilities, primary
 * first>' and 'Owned by: <team>' with links; empty state reads 'No
 * connections to other systems or actors yet' with the add link." Also
 * the sprint's own combined Playwright line: "context header for a system
 * with supports but no uses." Prompt 7k item 2 relabels the owner line by
 * role ("Business owner: <team>" etc, `ContextView.tsx`'s own comment) —
 * this test's fixture owns edge and assertion are updated to match, the
 * underlying "owned-by is a header line, not a drawn edge" behaviour this
 * item originally built is otherwise unchanged.
 *
 * Two systems in one fixture: one supports two capabilities (primary
 * second, to prove sort order isn't insertion order) and is owned by a
 * team, with no uses/flows_to edges at all — the exact "supports but no
 * uses" scenario, which should show both header lines *and* the empty
 * state together (src/ui/context/ContextView.tsx's own module comment:
 * the empty state is about system/actor connections specifically, not
 * about supports). The other has no relationships of any kind, to prove
 * the header lines are correctly absent when there's nothing to show.
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

test('context header: a system with supports but no uses shows "Supports:" (primary first) and "Owned by:", both linked, alongside the no-connections empty state', async ({ page }) => {
  const env = loadEnv();

  const email = `context-header-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`context-header fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`context-header fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `context-header-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Context Header Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `context-header-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Context Header Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const capAlphaId = randomUUID();
  const capZetaId = randomUUID();
  const systemId = randomUUID();
  const teamId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: capAlphaId, elementType: 'capability', name: 'Alpha Capability', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: capZetaId, elementType: 'capability', name: 'Zeta Capability', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Billing Service', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: teamId, elementType: 'actor', name: 'Platform Team', parentId: null, attributes: { subtype: 'team', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    // Alphabetically Alpha would sort first — Zeta is marked primary, so it
    // must appear first in the rendered "Supports:" line despite that.
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: capAlphaId, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: capZetaId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'owns', fromElementId: teamId, toElementId: systemId, attributes: { role: 'business' }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: genesisCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed a system with supports and an owner, but no uses', body: null, deltas };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding context-header fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${systemId}?ref=main`);
  await expect(page.getByRole('heading', { name: 'Billing Service' })).toBeVisible();

  // "Supports:", primary (Zeta) first, both linked.
  const supportsLine = page.getByText('Supports:', { exact: false });
  await expect(supportsLine).toBeVisible();
  const zetaLink = supportsLine.getByRole('link', { name: 'Zeta Capability' });
  const alphaLink = supportsLine.getByRole('link', { name: 'Alpha Capability' });
  await expect(zetaLink).toBeVisible();
  await expect(alphaLink).toBeVisible();
  const supportsText = await supportsLine.innerText();
  expect(supportsText.indexOf('Zeta')).toBeLessThan(supportsText.indexOf('Alpha'));

  // "Business owner:" (Prompt 7k item 2: owns.role replaces owns.primary —
  // the header now labels owners by role rather than a bare "Owned by:"), linked.
  const ownedByLine = page.getByText('Business owner:', { exact: false });
  await expect(ownedByLine).toBeVisible();
  await expect(ownedByLine.getByRole('link', { name: 'Platform Team' })).toBeVisible();

  // No uses/flows_to/owns-something-else connections at all — the empty
  // state still shows, alongside (not instead of) the two lines above.
  await expect(page.getByText('No connections to other systems or actors yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add a relationship on the element page →' })).toBeVisible();

  // Each link actually navigates to that element's own page.
  await zetaLink.click();
  await expect(page).toHaveURL(new RegExp(`/e/${capZetaId}\\?ref=main`));
  await expect(page.getByRole('heading', { name: 'Zeta Capability' })).toBeVisible();
});

test('context header: a system with no relationships at all shows neither "Supports:" nor "Owned by:"', async ({ page }) => {
  const env = loadEnv();

  const email = `context-header-empty-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`context-header-empty fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`context-header-empty fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `context-header-empty-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Context Header Empty Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `context-header-empty-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Context Header Empty Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const systemId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Isolated Service', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: genesisCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed an isolated system', body: null, deltas };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding context-header-empty fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${systemId}?ref=main`);
  await expect(page.getByRole('heading', { name: 'Isolated Service' })).toBeVisible();

  await expect(page.getByText('Supports:', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Owned by:', { exact: false })).toHaveCount(0);
  await expect(page.getByText('No connections to other systems or actors yet.')).toBeVisible();
});
