/**
 * Capability map redesign (density pass): every row is a single line now
 * — the domain header, and (item 3's own "single row: name, indicator,
 * count") every capability card — so a long name truncates with an
 * ellipsis at both levels, not just L1 (Sprint U4-2b item 1's own
 * L1-truncates/L2-wraps split no longer applies once L2 is a single-row
 * card too, not a multi-line tile). A CSS `text-overflow: ellipsis`
 * regression clips the *paint*, never the DOM text or the accessible
 * name, so what still matters — at both levels — is that the full name
 * survives as real text and a `title` attribute (a real HTML tooltip on
 * hover/long-press), never actually lost.
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

test('capability map: the longest real starter-map names never cause page-level scroll and stay reachable via title/DOM text, at 1280 and 1920', async ({ page }) => {
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
  // `^`: each domain also has its own "Inspect <name>" button now.
  const domainToggle = page.getByRole('button', { name: new RegExp('^' + LONGEST_L1_NAME.slice(0, 20)) });
  await expect(domainToggle).toBeVisible();

  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await hasHorizontalScroll(page)).toBe(false);

    // Collapsed domain header: the name truncates by design (a single-
    // line summary row) — what matters is the full name is still real
    // DOM text (the button's own accessible name includes it in full,
    // `toContainText`, a CSS ellipsis never shortens that) and reachable
    // via the `title` attribute on its own wrapping element.
    await expect(domainToggle).toContainText(LONGEST_L1_NAME);
    await expect(page.locator('[title="' + LONGEST_L1_NAME + '"]')).toBeAttached();

    // Expanding reveals the L2 card — same truncate-but-never-lose
    // treatment, checked via its own primary link (real text + `title`).
    await domainToggle.click();
    const l2Link = page.getByRole('link', { name: LONGEST_L2_NAME });
    await expect(l2Link).toBeVisible();
    await expect(l2Link).toHaveText(LONGEST_L2_NAME);
    await expect(l2Link).toHaveAttribute('title', LONGEST_L2_NAME);
    await domainToggle.click(); // collapse again before the next viewport iteration
  }
});
