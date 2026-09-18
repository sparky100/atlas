/**
 * Sprint U4-1 findings item 5's own follow-up: "elements go off the bottom
 * of the screen, the scroll scrolls the whole screen" (a long browse table
 * with no way to keep search/filter/sort in view). The first fix
 * (`position: sticky` on the toolbar and the `<thead th>`) shipped but the
 * column header silently never stuck — `.tableWrap`'s own pre-existing
 * `overflow-x: auto` (needed so a wide table scrolls sideways within
 * itself rather than the whole page, this app's own hard rule — see the
 * `no page-level horizontal scroll` checks throughout this directory)
 * becomes the nearest scroll container for anything `position: sticky`
 * inside it, which breaks sticking to the *viewport* outright. Confirmed
 * against a real Chromium instance before the real fix (`.headerClip`,
 * ElementBrowseTable.tsx/.module.css) — a physically separate header
 * table, scroll-synced to `.tableWrap`'s own horizontal position — was
 * built: this is that fix's own regression coverage, the thing missing
 * before.
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('element browse table: the toolbar and the column header both stay pinned to the viewport while scrolling a long list, with no page-level horizontal scroll', async ({ page }) => {
  const env = loadEnv();

  const email = `browse-sticky-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`browse-sticky fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`browse-sticky fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `browse-sticky-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Browse Sticky Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `browse-sticky-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Browse Sticky Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  // Enough rows that the table is genuinely taller than the viewport —
  // the whole point of the original complaint.
  const deltas: Delta[] = Array.from({ length: 40 }, (_, i) => ({
    kind: 'element.create',
    id: randomUUID(),
    elementId: randomUUID(),
    elementType: 'system',
    name: `Sticky Test System ${String(i).padStart(2, '0')}`,
    parentId: null,
    attributes: { lifecycleStatus: 'active', isExternal: false },
    sourceId: seedSourceId,
    confidence: 1,
  }));
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed forty systems for the browse-sticky test',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding browse-sticky fixture: ${seedResult.message}`);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/elements`);
  await expect(page.getByRole('heading', { name: 'Elements' })).toBeVisible();

  const searchInput = page.getByPlaceholder('Search by name or owner…');
  const nameHeader = page.getByRole('columnheader', { name: /Name/ });
  await expect(searchInput).toBeInViewport();
  await expect(nameHeader).toBeInViewport();

  // Scroll well past the header's own natural position — a plain
  // `window.scrollBy`, since this table intentionally has no scroll
  // container of its own for the vertical axis.
  await page.mouse.wheel(0, 600);
  await expect(searchInput).toBeInViewport();
  await expect(nameHeader).toBeInViewport();

  // No page-level horizontal scroll at any point — this app's own rule,
  // checked the same way every other spec in this directory checks it.
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});
