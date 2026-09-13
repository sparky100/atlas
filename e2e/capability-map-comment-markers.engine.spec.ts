/**
 * M1 close-out item 2: "Capability map: markers on tiles (bottom-right,
 * same rule) and the panel, per the corner rule in UI-principles §6.1."
 *
 * Two L2 tiles, one with an open thread (the ink marker), one with every
 * thread resolved (the hollow marker) — `docs/HANDOFF-M1b-comments.md`'s
 * own bottom-right corner rule, now on `CapabilityTile` (L2 cards and L3
 * tiles both use it — `CapabilityMapView.tsx`'s own module comment)
 * alongside the landscape's canvas-drawn version of the same marker.
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
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

test('capability map: an ink marker for an open thread, a hollow marker for an all-resolved one, both open the comments panel', async ({ page }) => {
  const env = loadEnv();

  const email = `capmap-markers-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capmap-markers fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capmap-markers fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capmap-markers-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capmap Markers Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `capmap-markers-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capmap Markers Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  // Two L1 columns, each with one L2 capability — plain siblings at L1 so
  // both tiles render without needing to expand anything.
  const openThreadCapId = randomUUID();
  const resolvedThreadCapId = randomUUID();
  const openThreadParentId = randomUUID();
  const resolvedThreadParentId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: openThreadParentId, elementType: 'capability', name: 'Open Thread Group', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: openThreadCapId, elementType: 'capability', name: 'Has An Open Thread', parentId: openThreadParentId, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: resolvedThreadParentId, elementType: 'capability', name: 'Resolved Thread Group', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: resolvedThreadCapId, elementType: 'capability', name: 'Has Only A Resolved Thread', parentId: resolvedThreadParentId, attributes: {}, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed two capability groups',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding capmap-markers fixture: ${seedResult.message}`);

  const openThreadBody = 'Is this the right owner for this one?';
  await createComment(signedIn, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: openThreadCapId, body: openThreadBody, authorId: userId });
  const resolvedRoot = await createComment(signedIn, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: resolvedThreadCapId, body: 'Already handled, closing this out.', authorId: userId });
  await resolveComment(signedIn, { commentId: resolvedRoot.id, resolvedBy: userId });

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByText('Has An Open Thread')).toBeVisible();

  // The ink marker — bottom-right, an open thread's own count.
  const openThreadTile = page.locator('div').filter({ hasText: 'Has An Open Thread' }).last();
  const inkMarker = openThreadTile.getByRole('button', { name: '1 unresolved comment' });
  await expect(inkMarker).toBeVisible();

  // The hollow marker — bottom-right, no count (every thread resolved).
  const resolvedThreadTile = page.locator('div').filter({ hasText: 'Has Only A Resolved Thread' }).last();
  const hollowMarker = resolvedThreadTile.getByRole('button', { name: 'All comments resolved' });
  await expect(hollowMarker).toBeVisible();

  // Clicking either marker opens the panel scoped to that capability, not
  // its own element page (the tile's own primary link would do that
  // instead — CapabilityTile.tsx's own `e.preventDefault()` on the marker
  // click is what keeps the two from firing together).
  await inkMarker.click();
  await expect(page).toHaveURL(/\/capability-map$/);
  const panel = page.getByRole('complementary', { name: 'Comments on Has An Open Thread' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(openThreadBody)).toBeVisible();
  await panel.getByRole('button', { name: 'Close comments panel' }).click();
  await expect(panel).not.toBeVisible();

  await hollowMarker.click();
  await expect(page.getByRole('complementary', { name: 'Comments on Has Only A Resolved Thread' })).toBeVisible();
});
