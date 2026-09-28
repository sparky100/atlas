/**
 * Follow-up to #315/#316's sticky-header fixes: a user-reported mobile UX
 * problem (dense table loses the Name column off-screen on horizontal
 * scroll, and loses the column headers on vertical scroll) rather than a
 * rendering bug — below 768px, `ElementBrowseTable.tsx` now swaps the
 * table for `ElementBrowseCards.tsx` entirely, the same "swap the whole
 * renderer" shape `landscape-mobile-list.engine.spec.ts` already covers for
 * Landscape. This is the equivalent spec for the Elements browse table:
 * cards render instead of a table, nothing scrolls horizontally even with
 * a long name, a card's own fields (type/lifecycle/criticality) show
 * without column headers, the mobile-only sort control actually resorts,
 * and tapping a card navigates like a table row link always has.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

test('element browse cards at 390px: no table, no horizontal scroll even with a long name, card fields visible, mobile sort resorts, tap navigates', async ({ page }) => {
  const env = loadEnv();

  const email = `browse-mobile-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`element-browse-mobile fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`element-browse-mobile fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `browse-mobile-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Browse Mobile Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `browse-mobile-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Browse Mobile Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  // Name/lifecycle deliberately disagree in order: name-ascending puts
  // Apple before Zebra, but lifecycle-ascending ("active" < "retiring")
  // puts Zebra before Apple — proves the mobile sort `<select>` actually
  // resorts, not just that it renders.
  const longNamedId = randomUUID();
  const appleId = randomUUID();
  const zebraId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: longNamedId, elementType: 'system', name: 'Integrated Regional Revenue and Benefits Collection Platform', parentId: null, attributes: { lifecycleStatus: 'active', criticality: 'high', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: appleId, elementType: 'system', name: 'Apple System', parentId: null, attributes: { lifecycleStatus: 'retiring', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: zebraId, elementType: 'system', name: 'Zebra System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: genesisCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed systems with a long name and disagreeing name/lifecycle order', body: null, deltas };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding element-browse-mobile fixture: ${seedResult.message}`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/elements`);

  // The table never mounts at this width — cards do instead.
  await expect(page.locator('table')).toHaveCount(0);
  expect(await hasHorizontalScroll(page)).toBe(false);

  // The long name renders in full (wrapped, not clipped) with no
  // horizontal scroll — the exact complaint the table's own sticky-header
  // fixes couldn't solve, since a wide fixed-width column always needs
  // scrolling to reach the columns after it.
  await expect(page.getByRole('link', { name: /Integrated Regional Revenue and Benefits Collection Platform/ })).toBeVisible();

  // A card's own fields — type, lifecycle, criticality — read without any
  // column header, since nothing here is a column. Scoped to the card
  // itself (`li`, not the page) — a bare `getByText('system')` also
  // matches the toolbar's own (hidden) "Element type" `<option>`.
  const longCard = page.getByRole('listitem').filter({ hasText: 'Integrated Regional Revenue and Benefits Collection Platform' });
  await expect(longCard.getByText('active', { exact: true })).toBeVisible();
  await expect(longCard.getByText('high', { exact: true })).toBeVisible();
  await expect(longCard.getByText('system', { exact: true })).toBeVisible();

  // Order among the cards — not exact link text, since a card's own Link
  // also wraps its lifecycle/criticality chips (accessible name includes
  // them too).
  async function orderOf(nameA: string, nameB: string): Promise<'a-first' | 'b-first'> {
    const texts = await page.getByRole('listitem').allTextContents();
    const indexA = texts.findIndex((t) => t.includes(nameA));
    const indexB = texts.findIndex((t) => t.includes(nameB));
    return indexA < indexB ? 'a-first' : 'b-first';
  }

  // Default sort is name-ascending: Apple before Zebra.
  await expect.poll(() => orderOf('Apple System', 'Zebra System')).toBe('a-first');

  // Switching the mobile sort control to Lifecycle actually resorts —
  // "active" (Zebra) sorts before "retiring" (Apple).
  await page.getByLabel('Sort by').selectOption('lifecycle');
  await expect.poll(() => orderOf('Zebra System', 'Apple System')).toBe('a-first');

  // The direction toggle flips it back (same click-again-to-reverse
  // behaviour the desktop table's own header buttons give).
  await page.getByRole('button', { name: /Sort direction/ }).click();
  await expect.poll(() => orderOf('Apple System', 'Zebra System')).toBe('a-first');

  // Tapping a card's name navigates to its element page, same as a table
  // row's Name link always has.
  await page.getByRole('link', { name: 'Apple System' }).click();
  await expect(page).toHaveURL(new RegExp(`/e/${appleId}$`));
  await expect(page.getByRole('heading', { name: 'Apple System' })).toBeVisible();

  // Back at desktop width, the table renders as before — this feature only
  // swaps the renderer below the breakpoint, the desktop table is
  // untouched.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/elements`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('table')).toHaveCount(2);
});
