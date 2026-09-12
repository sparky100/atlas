/**
 * S1 item 12: "Comments: markers and panel on the mobile landscape list and
 * the capability-scoped list." Same shape as
 * `capability-map-comment-markers.spec.ts`'s own two-tile fixture (one open
 * thread, one all-resolved) — here, two systems on the mobile
 * (`LandscapeMobileList.tsx`) and capability-scoped
 * (`CapabilityLandscapeList.tsx`) list renderers instead of two capability
 * tiles.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { createComment, resolveComment } from '../src/db/comments';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

async function seedFixture(orgPrefix: string) {
  const env = loadEnv();

  const email = `${orgPrefix}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  const signedIn = createSupabaseClient(env);
  return { env, email, password, signedIn };
}

test('landscape mobile list: an ink marker for an open thread, a hollow marker for an all-resolved one, both open the comments panel', async ({ page }) => {
  const { email, password, signedIn } = await seedFixture('landscape-mobile-markers');

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`landscape-mobile-markers fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`landscape-mobile-markers fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `landscape-mobile-markers-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Landscape Mobile Markers Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `landscape-mobile-markers-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Landscape Mobile Markers Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const capabilityId = randomUUID();
  const openThreadSystemId = randomUUID();
  const resolvedThreadSystemId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Billing Capability', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: openThreadSystemId, elementType: 'system', name: 'Has An Open Thread', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: resolvedThreadSystemId, elementType: 'system', name: 'Has Only A Resolved Thread', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: openThreadSystemId, toElementId: capabilityId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: resolvedThreadSystemId, toElementId: capabilityId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: genesisCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed two systems in one capability', body: null, deltas };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding landscape-mobile-markers fixture: ${seedResult.message}`);

  const openThreadBody = 'Is this the right owner for this one?';
  await createComment(signedIn, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: openThreadSystemId, body: openThreadBody, authorId: userId });
  const resolvedRoot = await createComment(signedIn, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: resolvedThreadSystemId, body: 'Already handled, closing this out.', authorId: userId });
  await resolveComment(signedIn, { commentId: resolvedRoot.id, resolvedBy: userId });

  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  await expect(page.locator('canvas')).toHaveCount(0);

  await page.getByRole('button', { name: /Billing Capability/ }).click();

  const inkMarker = page.getByRole('button', { name: '1 unresolved comment' });
  await expect(inkMarker).toBeVisible();
  const hollowMarker = page.getByRole('button', { name: 'All comments resolved' });
  await expect(hollowMarker).toBeVisible();

  // Clicking a marker opens the panel scoped to that system, not its own
  // element page — the row's own link would do that instead.
  await inkMarker.click();
  const panel = page.getByRole('complementary', { name: 'Comments on Has An Open Thread' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(openThreadBody)).toBeVisible();
  await panel.getByRole('button', { name: 'Close comments panel' }).click();
  await expect(panel).not.toBeVisible();

  await hollowMarker.click();
  await expect(page.getByRole('complementary', { name: 'Comments on Has Only A Resolved Thread' })).toBeVisible();
});

test('capability-scoped landscape list: an ink marker for an open thread, a hollow marker for an all-resolved one, both open the comments panel', async ({ page }) => {
  const { email, password, signedIn } = await seedFixture('capability-list-markers');

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-list-markers fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-list-markers fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capability-list-markers-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability List Markers Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `capability-list-markers-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capability List Markers Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const rootId = randomUUID();
  const openThreadSystemId = randomUUID();
  const resolvedThreadSystemId = randomUUID();
  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a capability with two supporting systems',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: rootId, elementType: 'capability', name: 'Billing', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: openThreadSystemId, elementType: 'system', name: 'Has An Open Thread', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: resolvedThreadSystemId, elementType: 'system', name: 'Has Only A Resolved Thread', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: openThreadSystemId, toElementId: rootId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: resolvedThreadSystemId, toElementId: rootId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding capability-list-markers fixture: ${seedResult.message}`);

  const openThreadBody = 'Is this the right owner for this one?';
  await createComment(signedIn, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: openThreadSystemId, body: openThreadBody, authorId: userId });
  const resolvedRoot = await createComment(signedIn, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: resolvedThreadSystemId, body: 'Already handled, closing this out.', authorId: userId });
  await resolveComment(signedIn, { commentId: resolvedRoot.id, resolvedBy: userId });

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape?capability=${rootId}`);
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Systems supporting Billing (2)' })).toBeVisible();

  const openThreadRow = page.locator('li').filter({ hasText: 'Has An Open Thread' });
  const resolvedThreadRow = page.locator('li').filter({ hasText: 'Has Only A Resolved Thread' });

  const inkMarker = openThreadRow.getByRole('button', { name: '1 unresolved comment' });
  await expect(inkMarker).toBeVisible();
  const hollowMarker = resolvedThreadRow.getByRole('button', { name: 'All comments resolved' });
  await expect(hollowMarker).toBeVisible();

  await inkMarker.click();
  const panel = page.getByRole('complementary', { name: 'Comments on Has An Open Thread' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(openThreadBody)).toBeVisible();
  await panel.getByRole('button', { name: 'Close comments panel' }).click();
  await expect(panel).not.toBeVisible();

  await hollowMarker.click();
  await expect(page.getByRole('complementary', { name: 'Comments on Has Only A Resolved Thread' })).toBeVisible();
});
