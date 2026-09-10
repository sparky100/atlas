/**
 * Sprint U4-1 C1: "tailoring allows drag-to-reorder among siblings
 * (attribute update)". Implemented as move-left/right (L1) and move-up/
 * down (L2) buttons rather than a mouse drag gesture —
 * useCapabilityReorder.ts's own module comment explains why (no
 * drag-and-drop anywhere else in this codebase, no DnD library, and
 * buttons stay keyboard-/screen-reader-operable) — the *effect* (a
 * capability swaps places with an adjacent sibling, `attributes.order`
 * updated) is the same either way; SPEC-data-model.md §11 records a real
 * drag gesture as a reviewed, deliberate follow-up, not a gap in this item.
 *
 * Also covers the review follow-up that tightened C1: every capability
 * gets an `order` at creation now (useCapabilityCreate.ts), including a
 * hand-added one — so a brand-new capability can be moved immediately,
 * with no "not orderable yet" disabled state left anywhere.
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

test('reordering: move-right swaps two L1 capabilities, move-down swaps two L2 capabilities, and a hand-added capability can be moved immediately', async ({ page }) => {
  const env = loadEnv();

  const email = `capmap-reorder-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-map-reorder fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-map-reorder fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capmap-reorder-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability Map Reorder Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `capmap-reorder-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capability Map Reorder Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const rootAId = randomUUID();
  const rootBId = randomUUID();
  const childXId = randomUUID();
  const childYId = randomUUID();

  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed two ordered L1 capabilities, each with an ordered L2 child',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: rootAId, elementType: 'capability', name: 'Root Alpha', parentId: null, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: rootBId, elementType: 'capability', name: 'Root Beta', parentId: null, attributes: { order: 20 }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: childXId, elementType: 'capability', name: 'Child X', parentId: rootAId, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: childYId, elementType: 'capability', name: 'Child Y', parentId: rootAId, attributes: { order: 20 }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding capability-map-reorder fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByText('Root Alpha')).toBeVisible();

  // Sprint U4-2a item 3: the move buttons hide behind "Reorder mode" now
  // (off by default — see CapabilityMapView.tsx's own comment on why),
  // so they don't exist in the DOM at all until this is turned on.
  await page.getByLabel('Reorder mode').check();

  // --- L1: move Root Alpha right, swapping places with Root Beta ---
  // Every move button's own accessible name already names the capability
  // it moves ("Move Root Alpha right") — no need to scope into a
  // particular column/card container first.
  await page.getByRole('button', { name: 'Move Root Alpha right' }).click();

  // The swap is order-only (attributes.order), not a rename — Root Alpha
  // still reads "Root Alpha" after the move, just in the second position.
  // Both names are globally unique on this page, so querying every link
  // matching either name gives their real DOM (= display) order directly.
  await expect(async () => {
    const l1Order = await page.getByRole('link', { name: /^(Root Alpha|Root Beta)$/ }).allTextContents();
    expect(l1Order).toEqual(['Root Beta', 'Root Alpha']);
  }).toPass();

  // --- L2: move Child X down within Root Alpha's own column, swapping with Child Y ---
  await page.getByRole('button', { name: 'Move Child X down' }).click();

  await expect(async () => {
    const l2Order = await page.getByRole('link', { name: /^(Child X|Child Y)$/ }).allTextContents();
    expect(l2Order).toEqual(['Child Y', 'Child X']);
  }).toPass();

  // --- A hand-added capability gets an order at creation, and can be moved immediately ---
  // (the review follow-up that tightened C1: no "not orderable yet" state
  // survives to a freshly-created capability, seeded or hand-added alike).
  await page.getByRole('button', { name: '+ Add capability' }).click();
  await page.getByPlaceholder('Capability name').fill('Hand Added Root');
  // Leave the parent picker at its default ("Top level") — a new L1.
  await page.getByRole('button', { name: 'Add' }).click();

  // Lands after Root Beta and Root Alpha (order 10/21 after the swap above,
  // so the new capability gets 21) — last among the three L1s.
  await expect(async () => {
    const l1Order = await page.getByRole('link', { name: /^(Root Alpha|Root Beta|Hand Added Root)$/ }).allTextContents();
    expect(l1Order).toEqual(['Root Beta', 'Root Alpha', 'Hand Added Root']);
  }).toPass();

  await page.getByRole('button', { name: 'Move Hand Added Root left' }).click();

  await expect(async () => {
    const l1Order = await page.getByRole('link', { name: /^(Root Alpha|Root Beta|Hand Added Root)$/ }).allTextContents();
    expect(l1Order).toEqual(['Root Beta', 'Hand Added Root', 'Root Alpha']);
  }).toPass();
});
