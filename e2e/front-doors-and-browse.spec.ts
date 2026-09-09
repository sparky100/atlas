/**
 * Sprint U3b's core user path (UI-principles §3), director door updated
 * for Handoff 7d (`docs/HANDOFF-7d-director-door.md`): the two front
 * doors, the element browse table, and the mobile header collapse. Seeds
 * a small model (two systems — one `retiring`, to exercise the director
 * door's weakness grid — one capability, one `supports` edge) through the
 * real `commitToBranch` path from Node (main already has a real genesis
 * commit, ADR-018 — no bootstrap needed), then drives the actual UI
 * through the browser.
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

test('front doors and browse: both doors render for a seeded model, switching persists, search opens an element, table filters, mobile shows the collapsed menu', async ({ page }) => {
  const env = loadEnv();

  const email = `frontdoors-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`front-doors fixture sign-in: ${signInError.message}`);

  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`front-doors fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `frontdoors-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Front Doors Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `frontdoors-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Front Doors Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const capabilityId = randomUUID();
  const activeSystemId = randomUUID();
  const retiringSystemId = randomUUID();
  const relationshipId = randomUUID();

  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed capability, two systems, one supports edge',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Billing', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      {
        kind: 'element.create',
        id: randomUUID(),
        elementId: activeSystemId,
        elementType: 'system',
        name: 'Payment Gateway',
        parentId: null,
        attributes: { lifecycleStatus: 'active', isExternal: false },
        sourceId: seedSourceId,
        confidence: 1,
      },
      {
        kind: 'element.create',
        id: randomUUID(),
        elementId: retiringSystemId,
        elementType: 'system',
        name: 'Legacy Mainframe',
        parentId: null,
        attributes: { lifecycleStatus: 'retiring', isExternal: false },
        sourceId: seedSourceId,
        confidence: 1,
      },
      {
        kind: 'relationship.create',
        id: randomUUID(),
        relationshipId,
        relationshipType: 'supports',
        fromElementId: retiringSystemId,
        toElementId: capabilityId,
        attributes: { role: 'secondary' },
        sourceId: seedSourceId,
        confidence: 1,
      },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding front-doors fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);

  // Sprint U4-2a item 6: the desktop header now collapses behind the same
  // single avatar menu mobile already used — "Sign out"/theme/density sit
  // behind it, not open in the bar, even at this default (desktop) width.
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).not.toBeVisible();

  // The org's creator is its owner, so the default door is architect
  // (UI-principles §3: "Owners and Architects get the architect door").
  await expect(page.getByRole('heading', { name: 'My branches' })).toBeVisible();

  // Switching to the director door renders the weakness grid (Handoff 7d):
  // the exposed capability's own tile, naming the retiring system that
  // exposes it, plus the "N capabilities exposed" summary chip.
  await page.getByRole('button', { name: 'Director view' }).click();
  await expect(page.getByRole('heading', { name: 'Where are we weak' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Billing/ })).toBeVisible();
  await expect(page.getByText('1 capability exposed')).toBeVisible();
  await expect(page.getByText('lifecycle exposure')).toBeVisible();
  await expect(page.getByText('Legacy Mainframe')).toBeVisible();

  // Switching persists: reloading the page keeps the director door, not
  // just the in-memory toggle state.
  await page.reload();
  await expect(page.getByRole('link', { name: /Billing/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Director view' })).toHaveAttribute('aria-pressed', 'true');

  // The search box is search-first and opens an existing element rather
  // than creating a duplicate.
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('Payment Gateway');
  await page.getByRole('link', { name: /Payment Gateway/ }).click();
  await expect(page.getByRole('heading', { name: 'Payment Gateway' })).toBeVisible();

  // The element browse table, reachable from both doors, filters by type.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/elements`);
  await expect(page.getByRole('link', { name: /Billing/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Payment Gateway/ })).toBeVisible();
  await page.getByRole('combobox').selectOption('capability');
  await expect(page.getByRole('link', { name: /Payment Gateway/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Billing/ })).toBeVisible();

  // Mobile: the header's email/theme/density/sign-out collapse behind a
  // menu button instead of sitting in the bar unconditionally.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  const menuToggle = page.getByRole('button', { name: 'Account menu' });
  await expect(menuToggle).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
  await menuToggle.click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
});
