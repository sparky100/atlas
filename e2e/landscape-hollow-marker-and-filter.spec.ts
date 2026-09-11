/**
 * M1 close-out item 1: "build the hollow marker that vanishes below the
 * label LOD, and the per-session 'comments on this view' filter."
 *
 * Before this fix, `LandscapeCanvas.tsx`'s own `commentMarkerAt` hit-test
 * (and the marker itself) only ever existed for `unresolvedCount > 0` —
 * an anchor with every thread resolved painted nothing and was unclickable,
 * indistinguishable from one with no comments at all. This clicks the
 * exact same bottom-right corner `docs/HANDOFF-M1b-comments.md`'s own
 * corner rule reserves for it (the same geometry e2e/comments.spec.ts's
 * own marker click already uses) and expects the panel to open — proof
 * the hollow marker is really there and really clickable, even though a
 * canvas draw call itself isn't something Playwright can query as DOM.
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import type { ElementsHeadRow } from '../src/contracts/rows';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { createComment, resolveComment } from '../src/db/comments';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';
import { computeLandscapeLayout, NODE_HEIGHT, NODE_WIDTH } from '../src/ui/landscape/layout';

test('landscape: the hollow (all-resolved) comment marker is clickable, and the "comments on this view" filter toggle is wired', async ({ page }) => {
  const env = loadEnv();

  const email = `landscape-hollow-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`landscape-hollow fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`landscape-hollow fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `landscape-hollow-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Landscape Hollow Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `landscape-hollow-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Landscape Hollow Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const systemId = randomUUID();
  const systemName = 'Resolved Comments System';
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: systemName, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: `seed ${systemName}`,
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding landscape-hollow fixture: ${seedResult.message}`);

  const resolvedRoot = await createComment(signedIn, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: systemId, body: 'This one already got sorted out.', authorId: userId });
  await resolveComment(signedIn, { commentId: resolvedRoot.id, resolvedBy: userId });

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('aria-label', /1 systems/, { timeout: 30_000 });

  // The "comments on this view" filter toggle exists and is wired to real
  // state — a plain checked/unchecked round trip, not a visual pixel
  // check (dimming a canvas-drawn node isn't something Playwright can
  // query as DOM either).
  const commentsOnlyToggle = page.getByRole('checkbox', { name: 'Comments on this view' });
  await expect(commentsOnlyToggle).toBeVisible();
  await expect(commentsOnlyToggle).not.toBeChecked();
  await commentsOnlyToggle.check();
  await expect(commentsOnlyToggle).toBeChecked();

  // Same marker geometry e2e/comments.spec.ts's own click already uses:
  // an 18×16 plate inset 4px into the node's bottom-right corner, in
  // world space, converted via the canvas's own live fit-to-view
  // transform.
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

  // `unresolvedCount` is 0 here (the whole point of the hollow state) —
  // CommentsPanel.tsx's own "N unresolved" chip only renders at all once
  // `unresolvedCount > 0`, so its absence is itself the assertion. The
  // thread itself is real (not a marker drawn over nothing) — collapsed
  // behind CommentsSection.tsx's own "1 resolved thread · show" the same
  // way e2e/comments.spec.ts's own resolved thread is, until expanded.
  const panel = page.getByRole('complementary', { name: `Comments on ${systemName}` });
  await expect(panel.getByText('unresolved', { exact: false })).toHaveCount(0);
  await expect(panel.getByText('1 resolved thread · show')).toBeVisible();
  await panel.getByText('1 resolved thread · show').click();
  await expect(panel.getByText('This one already got sorted out.')).toBeVisible();
});
