/**
 * Sprint U4-2b item 2: "L2 names wrap to two lines inside the tile" — an
 * L2 tile name never clips internally, checked via `scrollWidth <=
 * clientWidth` on the name element itself (a single-line `nowrap` +
 * `text-overflow: ellipsis` name would fail this even though the page
 * itself never scrolls, since an ellipsized box's own content still
 * overflows its box internally).
 *
 * L1 used to get the identical "never truncates" treatment (Sprint
 * U4-2b item 1) — the layout consistency pass reversed that
 * specifically: a fixed-height header with every column's title on a
 * shared baseline needs a name that can't grow past one line, so L1
 * names now truncate with an ellipsis (`CapabilityMapView.module.css`'s
 * own `.columnName` comment has the full trade-off). This file's own L1
 * checks below reflect that: no *page-level* horizontal scroll (still
 * true, and more robustly so now than when L1 could wrap), the full name
 * still reachable via the link's own `title` attribute and its
 * accessible name (a CSS `text-overflow: ellipsis` regression clips the
 * *paint*, never the DOM text or the accessible name — the same
 * distinction this file's own L2 check below still relies on).
 *
 * Uses the two real longest capability names across all eight starter
 * maps (found by scanning `content/capability-maps/**\/*.json` directly)
 * rather than a made-up string, so this is a real regression check
 * against real content, not a synthetic case that happens to pass —
 * `Regulatory Compliance & Price-Control Reporting` (47 chars, a real
 * level-1 name in the electricity network and utility maps) and
 * `Substation & Circuit Condition Monitoring` (41 chars, a real level-2
 * name in the electricity network map, under a different parent there —
 * reused here as a child of the L1 name above; only the strings need to
 * be real, not their original tree position).
 *
 * Same "needs a real Supabase" limitation as every other Playwright test
 * in this repo (playwright.config.ts's own module comment).
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

const LONGEST_L1_NAME = 'Regulatory Compliance & Price-Control Reporting'; // content/capability-maps/electricity_network/2.json, code 12 — also in utility/1.json and (worded slightly differently) housing/1.json.
const LONGEST_L2_NAME = 'Substation & Circuit Condition Monitoring'; // content/capability-maps/electricity_network/2.json, code 9.3 — a level-2 item there, reused here as this fixture's own L2.

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

/** No internal horizontal clipping on the element itself — the check that catches a single-line `nowrap` + ellipsis truncation the page-level scroll check alone would miss (an ellipsized box never makes the *page* scroll; it clips its own content instead). */
async function hasInternalHorizontalOverflow(locator: ReturnType<Page['getByText']>): Promise<boolean> {
  return locator.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
}

test('capability map: the longest real starter-map names never overflow their box, at 1280 and 1920 (L1 truncates by design, L2 still never does)', async ({ page }) => {
  const env = loadEnv();

  const email = `capmap-overflow-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-map-text-overflow fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-map-text-overflow fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capmap-overflow-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability Map Text Overflow Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `capmap-overflow-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capability Map Text Overflow Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const l1Id = randomUUID();
  const l2Id = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: l1Id, elementType: 'capability', name: LONGEST_L1_NAME, parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: l2Id, elementType: 'capability', name: LONGEST_L2_NAME, parentId: l1Id, attributes: {}, sourceId: seedSourceId, confidence: 1 },
  ];

  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed the longest real L1/L2 starter-map names',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding capability-map-text-overflow fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByText(LONGEST_L1_NAME)).toBeVisible();

  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 1000 });

    expect(await hasHorizontalScroll(page)).toBe(false);

    // L1 now truncates by design (this file's own module comment) — the
    // visual clip (`scrollWidth > clientWidth` on `.columnName`) is
    // expected, not a regression, so this test no longer asserts it's
    // absent. What still matters: the full name is never actually lost —
    // it's the link's own accessible name/DOM text (`toHaveText`, a CSS
    // ellipsis never shortens that, only the paint) and its `title`
    // attribute (a real HTML tooltip on hover/long-press).
    const l1NameLink = page.getByRole('link', { name: LONGEST_L1_NAME });
    await expect(l1NameLink).toBeVisible();
    await expect(l1NameLink).toHaveText(LONGEST_L1_NAME);
    await expect(l1NameLink).toHaveAttribute('title', LONGEST_L1_NAME);

    // L2 is unchanged: still wraps to two lines, never clips internally.
    const l2NameTile = page.getByRole('link', { name: LONGEST_L2_NAME });
    await expect(l2NameTile).toBeVisible();
    await expect(l2NameTile).toHaveText(LONGEST_L2_NAME);
    expect(await hasInternalHorizontalOverflow(l2NameTile)).toBe(false);
  }
});
