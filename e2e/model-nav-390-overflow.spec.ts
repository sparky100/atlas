/**
 * Bug #39: "390px horizontal overflow on model-scoped routes" (Prompt 7g,
 * Bugs (3); found and flagged, not fixed, in Sprint U4-2a's own check —
 * docs/CHECK-U4-2a.md's "Built this sprint, not in Prompt 7f" list).
 *
 * Root cause: `ModelNav`'s mobile ref chip (`ModelNav.module.css`'s
 * `.refChip`) rendered `Chip.module.css`'s `.chip` — `white-space: nowrap`
 * by design (§6.3/§8.4: status/ref markers never wrap) — with no width cap.
 * `.nav` is `position: fixed; left: 0; right: 0`, so nothing clipped a
 * chip wider than the viewport: a branch ref's label (`title ?? name`,
 * `useBranchLabel.ts`) routinely exceeds 390px (e.g.
 * e2e/change-branch-merge.spec.ts's own "Point Billing Service at the new
 * vendor"), and since `ModelNav` renders on every model-scoped route, the
 * overflow was systemic, not page-specific — matching the bug's own plural
 * wording. `CapabilityMapPage.module.css`'s `.maintenanceActions` (the
 * other implicated spot) doesn't reliably overflow on its own — its
 * buttons wrap text rather than forcing a fixed width — but `flex-wrap:
 * wrap` was added there too, as a straightforward hardening against the
 * same class of failure.
 *
 * This spec seeds a change branch whose title is long enough to have
 * reproduced the bug pre-fix, and a capability so `.maintenanceActions`
 * renders, then visits every model-scoped route at 390px width asserting
 * no horizontal scroll — the check the bug report itself asks for.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

test('model-scoped routes: no horizontal scroll at 390px, including a long branch ref label in the nav chip', async ({ page }) => {
  const env = loadEnv();

  const email = `modelnav390-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`model-nav-390-overflow fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`model-nav-390-overflow fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `modelnav390-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Model Nav 390 Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `modelnav390-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Model Nav 390 Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  // One capability (so CapabilityMapPage's `.maintenanceActions` renders —
  // it's gated on the tree being non-empty) and one system.
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed one capability, one system',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: randomUUID(), elementType: 'capability', name: 'Billing', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: randomUUID(), elementType: 'system', name: 'Payment Gateway', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding model-nav-390-overflow fixture: ${seedResult.message}`);

  await page.setViewportSize({ width: 390, height: 844 });

  // A change branch with a long title — this is the label ModelNav's ref
  // chip shows (`title ?? name`), and the thing that actually bled past
  // the fixed nav's edges before the fix.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  const changeName = `long-title-branch-${randomUUID().slice(0, 8)}`;
  const changeTitle = 'A deliberately long change title chosen to exceed 390 pixels of nav chip width';
  await page.getByPlaceholder('Name (e.g. retire-legacy-crm)').fill(changeName);
  await page.getByPlaceholder('Title (e.g. Retire the legacy CRM)').fill(changeTitle);
  await page.getByRole('button', { name: 'Create change' }).click();
  const changeRow = page.locator('li', { hasText: changeTitle });
  await expect(changeRow).toBeVisible();
  await changeRow.getByRole('link', { name: 'Open →' }).click();
  const branchIdMatch = /\/changes\/([^/?]+)/.exec(page.url());
  if (!branchIdMatch?.[1]) throw new Error(`could not read the branch id out of ${page.url()}`);
  const branchId = branchIdMatch[1];
  expect(await hasHorizontalScroll(page)).toBe(false);

  // Every model-scoped route the nav links to, on the long-titled branch
  // ref so the chip carries its full label — main's own "main" chip is
  // short and would never have caught this class of bug.
  const refQuery = `?ref=branch:${branchId}`;
  const routes: { path: string; heading: RegExp | string }[] = [
    { path: `/o/${orgSlug}/m/${modelSlug}`, heading: 'Model Nav 390 Test Model' },
    { path: `/o/${orgSlug}/m/${modelSlug}/capability-map${refQuery}`, heading: 'Capability map' },
    { path: `/o/${orgSlug}/m/${modelSlug}/landscape${refQuery}`, heading: /^Landscape/ },
    { path: `/o/${orgSlug}/m/${modelSlug}/changes`, heading: 'Changes' },
    { path: `/o/${orgSlug}/m/${modelSlug}/versions${refQuery}`, heading: 'Versions' },
    { path: `/o/${orgSlug}/m/${modelSlug}/review`, heading: 'Review queue' },
  ];

  for (const route of routes) {
    await page.goto(route.path);
    await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible();
    // Only the routes navigated to with `?ref=` above actually carry the
    // long branch label into the chip (`home`/`changes`/`review` are
    // always main-scoped, per ModelNav.tsx's own `carriesRef`) — those are
    // exactly where the pre-fix bug reproduced. The chip's full label is
    // present in the DOM even when visually truncated by ellipsis —
    // `getByText` matches text content, not the rendered (clipped) box,
    // so this also proves the fix truncates rather than hides the ref.
    if (route.path.includes(refQuery)) {
      await expect(page.getByRole('navigation', { name: 'Model navigation' }).getByText(changeTitle)).toBeVisible();
    }
    expect(await hasHorizontalScroll(page)).toBe(false);
  }
});
