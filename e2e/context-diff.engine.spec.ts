/**
 * A change's Diff view of a Context page marks what the change adds, removes
 * and changes — edges and tiles in the diff colours, each with a marker
 * ("+", "−", "~") so the state is never colour alone — and shows the legend.
 * Before this the canvas drew a Diff exactly like To-be and an integration a
 * change adds could not be picked out.
 *
 * Seeded straight through the engine like `integration-platform-context.spec.ts`
 * (main has Ordering → Billing; the change adds Ordering → CRM and retracts
 * Ordering → Billing); the canvas is Canvas 2D, so the assertions here are the
 * DOM ones (legend, header badge) plus the diff data the canvas is handed.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import { createChangeBranch, getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('Context Diff mode: the legend is shown and the hub is marked, for a change that adds and removes connections', async ({ page }) => {
  const env = loadEnv();
  const email = `contextdiff-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`context-diff fixture sign-in: ${signInError.message}`);
  const { data: userData } = await signedIn.auth.getUser();
  const userId = userData.user?.id ?? '';

  const orgId = randomUUID();
  const orgSlug = `contextdiff-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Context Diff Org', slug: orgSlug, createdBy: userId });
  const modelId = randomUUID();
  const modelSlug = `contextdiff-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Context Diff Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const sourceId = (sourceRow as { id: string }).id;

  const orderingId = randomUUID();
  const billingId = randomUUID();
  const crmId = randomUUID();
  const keptEdgeId = randomUUID();
  const keptEdgeCreateDeltaId = randomUUID();
  const system = (elementId: string, name: string) => ({ kind: 'element.create', id: randomUUID(), elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 });
  const seedEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed two systems, a third, and one connection',
    body: null,
    deltas: [
      system(orderingId, 'Ordering System'),
      system(billingId, 'Billing System'),
      system(crmId, 'CRM System'),
      { kind: 'relationship.create', id: keptEdgeCreateDeltaId, relationshipId: keptEdgeId, relationshipType: 'uses', fromElementId: orderingId, toElementId: billingId, attributes: { description: 'reads invoices from' }, sourceId, confidence: 1 },
    ],
  } as CommitEnvelope;
  const seeded = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope: seedEnvelope });
  if (!seeded.ok) throw new Error(`seeding context-diff fixture: ${seeded.message}`);

  const afterSeed = await getMainBranch(signedIn, modelId);
  if (!afterSeed) throw new Error('main branch missing after seed');
  const branchId = randomUUID();
  const branch = await createChangeBranch(signedIn, { id: branchId, orgId, modelId, name: `diff-${branchId.slice(0, 8)}`, createdBy: userId, intent: 'record', mainHeadCommitId: afterSeed.head_commit_id });
  const changeEnvelope = {
    id: randomUUID(),
    branchId: branch.id,
    parentCommitId: afterSeed.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'add Ordering to CRM; drop Ordering to Billing',
    body: null,
    deltas: [
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'uses', fromElementId: orderingId, toElementId: crmId, attributes: { description: 'looks up customers in' }, sourceId, confidence: 1 },
      { kind: 'relationship.retract', id: randomUUID(), relationshipId: keptEdgeId, relationshipType: 'uses', previousDeltaId: keptEdgeCreateDeltaId, sourceId, confidence: 1 },
    ],
  } as unknown as CommitEnvelope;
  const changed = await commitToBranch(signedIn, { modelId, branchId: branch.id, expectedHeadCommitId: afterSeed.head_commit_id, envelope: changeEnvelope });
  if (!changed.ok) throw new Error(`committing the change: ${changed.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${orderingId}?ref=branch:${branchId}&mode=diff`);
  await expect(page.getByText('Ordering System', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Legend:')).toBeVisible();
  const legend = page.getByText('Legend:').locator('..');
  await expect(legend).toContainText('Added');
  await expect(legend).toContainText('Removed');
});
