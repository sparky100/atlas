/**
 * Sprint M1b (`docs/HANDOFF-M1b-comments.md`) end-to-end smoke: the
 * element-page thread lifecycle (6a — post, resolve, reopen) and the
 * landscape's own marker + panel (5a — click the marker, not the node, to
 * open the panel scoped to that system; the panel wraps the same
 * CommentsSection the element page uses).
 *
 * Same "needs a real Supabase" limitation as e2e/element-header.spec.ts —
 * not run in this authoring sandbox (Docker Hub blocked); written and
 * validated by tsc/eslint only.
 *
 * The canvas is Canvas 2D, not DOM (LandscapeCanvas.tsx's own module
 * comment) — the marker click below uses the exact same
 * `computeLandscapeLayout` technique e2e/landscape-navigation.spec.ts
 * already established, offset into the node's own bottom-right corner
 * (LandscapeCanvas.tsx's `COMMENT_MARKER_INSET`/`_WIDTH`/`_HEIGHT`) rather
 * than its centre, converted from world to screen coordinates via the
 * canvas's own live `data-scale`/`data-tx`/`data-ty` transform (Landscape
 * canvas, structural, item 1: the canvas now fits the whole diagram to
 * view on load, so the transform is never a plain identity
 * `{scale:1,tx:0,ty:0}` by the time this fixture's one-system diagram has
 * rendered).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import type { ElementsHeadRow } from '../src/contracts/rows';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';
import { computeLandscapeLayout, NODE_HEIGHT, NODE_WIDTH } from '../src/ui/landscape/layout';

test('comments: post/resolve/reopen a thread on the element page, then find it via the landscape marker and panel', async ({ page }) => {
  const env = loadEnv();

  const email = `comments-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`comments fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`comments fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `comments-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Comments Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `comments-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Comments Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const systemId = randomUUID();
  const systemName = 'Claims Processing';
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed Claims Processing',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: systemName, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding Claims Processing: ${seedResult.message}`);

  // --- 6a: the element page's own Comments section ---
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await expect(page.getByRole('heading', { name: systemName })).toBeVisible();

  // CollapsibleSection.tsx renders its title inside a disclosure <button>,
  // not a semantic heading — scope by the section element containing that
  // button, matched on its own accessible name (title + meta together).
  const commentsSection = page.locator('section').filter({ has: page.getByRole('button', { name: /^Comments/ }) });
  await commentsSection.scrollIntoViewIfNeeded();
  await expect(commentsSection.getByText('Comments are conversation, not governance', { exact: false })).toBeVisible();

  const threadBody = 'Should this system stay external-facing after Q3?';
  await commentsSection.getByPlaceholder('Write a comment…').fill(threadBody);
  await commentsSection.getByRole('button', { name: 'Post' }).click();
  await expect(commentsSection.getByText(threadBody)).toBeVisible();

  // Resolve it, then reopen it — the thread collapses behind "N resolved"
  // and comes back out from under it (CommentThread.tsx's own Resolve/
  // Reopen actions, `atlas.guard_comment_update`'s "a contributor resolves
  // only a thread they themselves started" — this is that same author).
  await commentsSection.getByRole('button', { name: 'Resolve' }).click();
  await expect(commentsSection.getByText('1 resolved thread · show')).toBeVisible();
  await expect(commentsSection.getByText(threadBody)).not.toBeVisible();
  await commentsSection.getByText('1 resolved thread · show').click();
  await expect(commentsSection.getByText(threadBody)).toBeVisible();
  await commentsSection.getByRole('button', { name: 'Reopen' }).click();
  await expect(commentsSection.getByText('1 resolved thread', { exact: false })).not.toBeVisible();
  await expect(commentsSection.getByText(threadBody)).toBeVisible();

  // --- 5a: the landscape's own marker + panel ---
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('aria-label', /1 systems/, { timeout: 30_000 });

  const systemRow: ElementsHeadRow = {
    element_id: systemId,
    element_type: 'system',
    name: systemName,
    parent_id: null,
    attributes: { lifecycleStatus: 'active', isExternal: false },
    exists_delta_id: randomUUID(),
  };
  const layout = computeLandscapeLayout([systemRow], [], new Map());
  const node = layout.nodes.find((n) => n.elementId === systemId);
  if (!node) throw new Error('computeLandscapeLayout did not place the seeded system');

  // The marker's own geometry (LandscapeCanvas.tsx): an 18x16 plate inset
  // 4px into the node's bottom-right corner, in world space — converted to
  // screen coordinates via the canvas's own live fit-to-view transform
  // (item 1), never assumed to be identity. This waits for the batched
  // unresolved-count RPC to land (the marker isn't drawn until then) by
  // polling the click itself via Playwright's built-in retrying assertion
  // on the panel it should open.
  const markerWorldX = node.x + NODE_WIDTH - 4 - 9;
  const markerWorldY = node.y + NODE_HEIGHT - 4 - 8;
  const wrapper = page.locator('[data-scale]');

  await expect(async () => {
    const scale = Number(await wrapper.getAttribute('data-scale'));
    const tx = Number(await wrapper.getAttribute('data-tx'));
    const ty = Number(await wrapper.getAttribute('data-ty'));
    await canvas.click({ position: { x: markerWorldX * scale + tx, y: markerWorldY * scale + ty } });
    await expect(page.getByRole('complementary', { name: `Comments on ${systemName}` })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  // Still on the landscape — the marker click opened the panel in place,
  // never navigated (unlike clicking the rest of the node).
  await expect(page).toHaveURL(/\/landscape/);
  const panel = page.getByRole('complementary', { name: `Comments on ${systemName}` });
  await expect(panel.getByText(threadBody)).toBeVisible();
  await expect(panel.getByText('1 unresolved')).toBeVisible();

  await panel.getByRole('button', { name: 'Close comments panel' }).click();
  await expect(panel).not.toBeVisible();
});
