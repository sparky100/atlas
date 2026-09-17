/**
 * S1 item 13: "'Backfill capability order' owner action in the overflow
 * menu." One click, on a model with two order-less L1 capabilities,
 * writes a real `order` for both, reported back to the user — and the
 * action itself is owner-only (`canBackfillCapabilityOrder`), unlike the
 * `canEdit`-gated rest of this menu, so an architect on the same model
 * never sees it at all.
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

test('Backfill capability order: an owner sees and can run it; an architect on the same model does not see it at all', async ({ browser }) => {
  const env = loadEnv();

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const ownerEmail = `capmap-backfill-owner-${randomUUID()}@example.test`;
  const ownerPassword = `${randomUUID()}Aa1!`;
  await ownerPage.goto('/sign-in');
  await ownerPage.getByText("Don't have an account? Create one").click();
  await ownerPage.getByLabel('Email').fill(ownerEmail);
  await ownerPage.getByLabel('Password').fill(ownerPassword);
  await ownerPage.getByRole('button', { name: 'Create account' }).click();
  await expect(ownerPage.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const owner = createSupabaseClient(env);
  const { error: ownerSignInError } = await owner.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword });
  if (ownerSignInError) throw new Error(`capmap-backfill fixture owner sign-in: ${ownerSignInError.message}`);
  const { data: ownerData, error: getOwnerError } = await owner.auth.getUser();
  if (getOwnerError) throw new Error(`capmap-backfill fixture: could not read the owner user: ${getOwnerError.message}`);
  const ownerId = ownerData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capmap-backfill-${orgId.slice(0, 8)}`;
  await createOrganisation(owner, { id: orgId, name: 'Capability Map Backfill Test Org', slug: orgSlug, createdBy: ownerId });

  const modelId = randomUUID();
  const modelSlug = `capmap-backfill-model-${modelId.slice(0, 8)}`;
  await createModel(owner, { id: modelId, orgId, name: 'Capability Map Backfill Test Model', slug: modelSlug, createdBy: ownerId });

  const main = await getMainBranch(owner, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await owner.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: ownerId, created_by: ownerId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await owner.from('sources').select('id').eq('model_id', modelId).eq('user_id', ownerId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  // Two order-less L1 capabilities — simulates content seeded before order
  // was assigned at creation (useCapabilityCreate.ts), which is exactly
  // what this action exists to repair for a whole model at once.
  const capAId = randomUUID();
  const capBId = randomUUID();
  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed two order-less L1 capabilities',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: capAId, elementType: 'capability', name: 'Backfill Alpha', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: capBId, elementType: 'capability', name: 'Backfill Beta', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding capmap-backfill fixture: ${seedResult.message}`);

  // An architect on the same org/model — added directly, same
  // `model-settings-archive.spec.ts` pattern.
  const architectContext = await browser.newContext();
  const architectPage = await architectContext.newPage();
  const architectEmail = `capmap-backfill-architect-${randomUUID()}@example.test`;
  const architectPassword = `${randomUUID()}Aa1!`;
  await architectPage.goto('/sign-in');
  await architectPage.getByText("Don't have an account? Create one").click();
  await architectPage.getByLabel('Email').fill(architectEmail);
  await architectPage.getByLabel('Password').fill(architectPassword);
  await architectPage.getByRole('button', { name: 'Create account' }).click();
  await expect(architectPage.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const architectAuth = createSupabaseClient(env);
  const { error: architectSignInError } = await architectAuth.auth.signInWithPassword({ email: architectEmail, password: architectPassword });
  if (architectSignInError) throw new Error(`capmap-backfill fixture architect sign-in: ${architectSignInError.message}`);
  const { data: architectData, error: getArchitectError } = await architectAuth.auth.getUser();
  if (getArchitectError) throw new Error(`capmap-backfill fixture: could not read the architect user: ${getArchitectError.message}`);
  const { error: memberError } = await owner.from('members').insert({ org_id: orgId, user_id: architectData.user.id, role: 'architect', invited_by: ownerId });
  if (memberError) throw new Error(`capmap-backfill fixture: could not add architect: ${memberError.message}`);

  // --- Architect: the overflow menu has Export, but never Backfill. ---
  await architectPage.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(architectPage.getByText('Backfill Alpha')).toBeVisible();
  await architectPage.getByRole('button', { name: 'Capability map actions' }).click();
  await expect(architectPage.getByRole('button', { name: 'Export as starter map' })).toBeVisible();
  await expect(architectPage.getByRole('button', { name: 'Backfill capability order' })).toHaveCount(0);

  // --- Owner: sees it, runs it, gets a real count back. ---
  await ownerPage.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(ownerPage.getByText('Backfill Alpha')).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Capability map actions' }).click();
  const backfillButton = ownerPage.getByRole('button', { name: 'Backfill capability order' });
  await expect(backfillButton).toBeVisible();
  await backfillButton.click();
  await expect(ownerPage.getByText('Backfilled order for 2 capabilities.')).toBeVisible();

  // Idempotent — running it again reports nothing left to do.
  await backfillButton.click();
  await expect(ownerPage.getByText('every capability already has an order — nothing to backfill')).toBeVisible();

  // The two capabilities are now genuinely orderable — Reorder mode's own
  // move buttons work immediately, with no on-the-fly fallback needed any
  // more (a plain swap of two already-ordered siblings).
  // Close the overflow menu (its own toggle again) before it can overlap
  // the "Reorder mode" toggle, now in the Inspector's own Filters section.
  await ownerPage.getByRole('button', { name: 'Capability map actions' }).click();
  await ownerPage.getByLabel('Reorder mode').check();
  // Alphabetical tiebreak among the order-less pair (findOrderBackfillCandidates'
  // own comment) put Alpha before Beta — "move Alpha right" is the one
  // enabled button of the pair (Beta's own "right" has no next sibling).
  await ownerPage.getByRole('button', { name: 'Move Backfill Alpha right' }).click();
  await expect(async () => {
    const order = await ownerPage.getByRole('link', { name: /^(Backfill Alpha|Backfill Beta)$/ }).allTextContents();
    expect(order).toEqual(['Backfill Beta', 'Backfill Alpha']);
  }).toPass();
});
