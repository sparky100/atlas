/**
 * Bug fix: "selecting a change does not persist across navigation;
 * creating an element after opening a change writes to main." The
 * selected ref is now model-level session state (`SelectedRefProvider.tsx`,
 * `sessionStorage`-backed, keyed per org/model), read by every model-scoped
 * page through `useSelectedRef()` instead of each page re-parsing its own
 * `?ref=` — the nav rail, breadcrumb, search results and create/edit
 * paths all carry it, and a page whose own link dropped it gets it
 * silently reattached to its URL on landing.
 *
 * This test follows the bug report's own acceptance scenario exactly:
 * open a change ("Edit in this change" on ChangePage.tsx — itself part of
 * this fix; nothing on that page used to select a ref at all), navigate
 * Home through the nav rail (not `page.goto` — the whole point is that an
 * in-app navigation must not lose the selection), search, create a
 * system, and confirm it landed on the branch (lifecycle `planned`,
 * `defaultCreateAttributes`'s own branch-vs-main default) with the
 * breadcrumb naming the change throughout.
 *
 * Second bug, found the same way — no existing test ever actually clicked
 * "Back to main" (`e2e/changes-ux-lifecycle.spec.ts` only asserted the
 * button was *visible*): `EditingBranchBanner.tsx`'s own `backToMain` used
 * to strip `?ref=`/`?mode=` from the URL directly via its own
 * `setSearchParams`, never touching the *stored* selection —
 * `SelectedRefProvider`'s reconciliation then read the still-stored branch
 * back out of `sessionStorage` the moment the URL fell silent and wrote it
 * right back in, so the click appeared to do nothing. Continues straight on
 * from the first bug's own scenario: click "Back to main", confirm the
 * banner is gone and the URL reverted, then create a second system and
 * confirm *that* one lands on main, not the branch.
 *
 * Same "needs a real Supabase" limitation as every other spec here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getBranch, getMainBranch } from '../src/db/branches';
import { buildCommitLoader } from '../src/db/commitLoader';
import { loadEnv } from '../src/db/env';
import { foldFromGenesis } from '../src/engine/head';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

/** `URLSearchParams`/history APIs percent-encode the `:` in `branch:<id>` (`branch%3A<id>`) — this matches either form, since which one a given browser/URL API produces isn't this test's own concern. */
function refUrlPattern(branchId: string): RegExp {
  return new RegExp(`ref=branch(?::|%3A)${branchId}`);
}

test('a selected change persists through Home, search and create — the new element lands on the branch, not main', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'refpersist', 'Existing System');
  const { signedIn, modelId, orgSlug, modelSlug } = fixture;

  // 1. Create the change branch through the real "Changes" form.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  const changeTitle = `Persist ref ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Name (e.g. retire-legacy-crm)').fill(`persist-ref-${randomUUID().slice(0, 8)}`);
  await page.getByPlaceholder('Title (e.g. Retire the legacy CRM)').fill(changeTitle);
  await page.getByRole('button', { name: 'Create change' }).click();
  const changeRow = page.locator('li', { hasText: changeTitle });
  await expect(changeRow).toBeVisible();
  await changeRow.getByRole('link', { name: 'Open →' }).click();
  await expect(page.getByRole('heading', { name: changeTitle })).toBeVisible();
  const branchIdMatch = /\/changes\/([^/?]+)/.exec(page.url());
  if (!branchIdMatch?.[1]) throw new Error(`could not read the branch id out of ${page.url()}`);
  const branchId = branchIdMatch[1];

  // 2. "Open a change": select it as the session's editing ref. Nothing
  // did this before this fix — viewing a change's own page never itself
  // selected it.
  await page.getByRole('button', { name: 'Edit in this change' }).click();
  await expect(page.getByRole('button', { name: 'Editing in this change' })).toBeVisible();
  await expect(page).toHaveURL(refUrlPattern(branchId));

  // 3. Navigate Home through the nav rail itself, not page.goto — this is
  // the exact link (`ModelNav.tsx`'s own former "Home" item) that used to
  // drop the ref entirely.
  await page.getByRole('navigation', { name: 'Model navigation' }).getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page).toHaveURL(refUrlPattern(branchId));
  await expect(page.getByText(`Editing in change: ${changeTitle}`)).toBeVisible();

  // 4. Search finds nothing, so "Create" is offered — the create path
  // itself (src/ui/home/HomeSearch.tsx) was already ref-aware; the bug
  // was that it never received anything but main by the time a user
  // reached this page through an ordinary navigation.
  const newSystemName = `Persisted System ${randomUUID().slice(0, 8)}`;
  const searchBox = page.getByPlaceholder('Search or create a capability, system, or actor…');
  await searchBox.fill(newSystemName);
  await expect(page.getByRole('button', { name: `Create system "${newSystemName}"` })).toBeVisible();
  await page.getByRole('button', { name: `Create system "${newSystemName}"` }).click();

  // `system` needs a required description before it actually commits
  // (HomeSearch.tsx's own description/capability sheet).
  await expect(page.getByText(`Adding to change: ${changeTitle}`)).toBeVisible();
  await page.getByPlaceholder('One line — what this system is').fill('Proves the selected ref survived Home and search.');
  await expect(page.getByText('planned on a change branch', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Skip capability' }).click();

  // 5. Landed on the new element's own page, still at the same branch ref
  // — breadcrumb names the change, and the lifecycle chip reads "planned"
  // (defaultCreateAttributes's own branch default, not main's "active").
  await expect(page.getByRole('heading', { name: newSystemName })).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(refUrlPattern(branchId));
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByText(changeTitle, { exact: false })).toBeVisible();
  // Scoped to the element header's own lifecycle chip — "planned" also
  // appears as plain attribute-row text further down the page.
  await expect(page.locator('header').getByText('planned', { exact: true })).toBeVisible();

  // 6. The real proof, independent of anything the UI merely displays:
  // the element lives on the branch's own fold, not main's.
  const elementIdMatch = /\/e\/([^/?]+)/.exec(page.url());
  if (!elementIdMatch?.[1]) throw new Error(`could not read the element id out of ${page.url()}`);
  const elementId = elementIdMatch[1];

  const main = await getMainBranch(signedIn, modelId);
  if (!main?.head_commit_id) throw new Error('main branch not found');
  const loader = await buildCommitLoader(signedIn, modelId);
  const mainHead = foldFromGenesis(main.head_commit_id, loader);
  expect(mainHead.elements.has(elementId)).toBe(false);

  const branch = await getBranch(signedIn, branchId);
  if (!branch?.head_commit_id) throw new Error('change branch not found');
  const branchHead = foldFromGenesis(branch.head_commit_id, loader);
  expect(branchHead.elements.has(elementId)).toBe(true);
  expect(branchHead.elements.get(elementId)?.attributes.lifecycleStatus).toBe('planned');

  // 7. "Back to main" — the second bug this file now covers. Must be a
  // real, immediate exit: the banner gone, the URL reverted, and nothing
  // hands the branch ref back on the very next render (the regression
  // this test exists to catch — see the module comment above).
  await page.getByRole('button', { name: 'Back to main' }).click();
  await expect(page.getByText(`Editing in change: ${changeTitle}`)).not.toBeVisible();
  await expect(page).not.toHaveURL(refUrlPattern(branchId));

  // 8. Navigate Home again through the nav rail — if `backToMain` had only
  // patched the URL without clearing the stored selection, this hop alone
  // would silently restore `?ref=branch:…` (`SelectedRefProvider`'s own
  // "URL is silent → substitute the stored choice" rule) and reproduce the
  // bug on arrival.
  await page.getByRole('navigation', { name: 'Model navigation' }).getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page).not.toHaveURL(refUrlPattern(branchId));
  await expect(page.getByText(`Editing in change: ${changeTitle}`)).not.toBeVisible();

  // 9. A second create now lands on main, not the branch — the owner
  // fixture user writes to main directly (no propose-a-change picker), so
  // the sheet's own copy names main, not the change, and the lifecycle
  // default is `active`.
  const secondSystemName = `Back To Main System ${randomUUID().slice(0, 8)}`;
  const searchBoxAgain = page.getByPlaceholder('Search or create a capability, system, or actor…');
  await searchBoxAgain.fill(secondSystemName);
  await page.getByRole('button', { name: `Create system "${secondSystemName}"` }).click();
  await expect(page.getByText('Adding to change:', { exact: false })).not.toBeVisible();
  await page.getByPlaceholder('One line — what this system is').fill('Proves Back to main actually cleared the selection.');
  await expect(page.getByText('active on main', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Skip capability' }).click();

  await expect(page.getByRole('heading', { name: secondSystemName })).toBeVisible({ timeout: 15_000 });
  await expect(page).not.toHaveURL(/ref=branch:/);
  await expect(page.locator('header').getByText('active', { exact: true })).toBeVisible();

  const secondElementIdMatch = /\/e\/([^/?]+)/.exec(page.url());
  if (!secondElementIdMatch?.[1]) throw new Error(`could not read the second element id out of ${page.url()}`);
  const secondElementId = secondElementIdMatch[1];

  const refreshedMain = await getMainBranch(signedIn, modelId);
  if (!refreshedMain?.head_commit_id) throw new Error('main branch not found after the second create');
  const refreshedLoader = await buildCommitLoader(signedIn, modelId);
  const refreshedMainHead = foldFromGenesis(refreshedMain.head_commit_id, refreshedLoader);
  expect(refreshedMainHead.elements.has(secondElementId)).toBe(true);

  // The branch's own head is exactly where the first create left it — the
  // second create never touched it.
  const branchAfter = await getBranch(signedIn, branchId);
  expect(branchAfter?.head_commit_id).toBe(branch.head_commit_id);
});
