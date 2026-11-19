/**
 * Prompt pack F3 PR4's own verification bullet: "create a decision with
 * context/owner/needed-by/links, see it listed and on its detail page,
 * comment on it, see it in the tray." No options/comparison/choose yet
 * (PR5) — this is the "plain create/list/detail" slice only.
 *
 * Same "needs a real Supabase" limitation as every other spec here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createSupabaseClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';
import { getProfile } from '../src/db/profiles';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('start a decision with context/owner/needed-by/a linked system; see it listed and on its own page; commenting on it (mentioning a member) notifies their tray', async ({ page, browser }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'decisionsflow', 'Ledger Service');
  const { signedIn: owner, userId: ownerId, orgId, orgSlug, modelSlug } = fixture;

  // A second real member, in their own browser session — the mention
  // target whose own tray this test checks (same pattern
  // e2e/m1-close-out-comments.engine.spec.ts already established).
  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  const bobEmail = `decisionsflow-bob-${randomUUID()}@example.test`;
  const bobPassword = `${randomUUID()}Aa1!`;
  await bobPage.goto('/sign-in');
  await bobPage.getByText("Don't have an account? Create one").click();
  await bobPage.getByLabel('Email').fill(bobEmail);
  await bobPage.getByLabel('Password').fill(bobPassword);
  await bobPage.getByRole('button', { name: 'Create account' }).click();
  await expect(bobPage.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const bob = createSupabaseClient(env);
  const { error: bobSignInError } = await bob.auth.signInWithPassword({ email: bobEmail, password: bobPassword });
  if (bobSignInError) throw new Error(`decisionsflow bob sign-in: ${bobSignInError.message}`);
  const { data: bobUserData, error: getBobError } = await bob.auth.getUser();
  if (getBobError) throw new Error(`decisionsflow: could not read bob's user: ${getBobError.message}`);
  const bobId = bobUserData.user.id;

  const { error: memberError } = await owner.from('members').insert({ org_id: orgId, user_id: bobId, role: 'contributor', invited_by: ownerId });
  if (memberError) throw new Error(`decisionsflow: could not add bob as a member: ${memberError.message}`);
  const bobProfile = await getProfile(owner, bobId);
  if (!bobProfile) throw new Error('atlas.ensure_profile did not create a profile for bob');

  // 1. Start a decision from the model nav's own "Decisions" section.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await page.getByRole('link', { name: 'Decisions' }).click();
  await expect(page.getByRole('heading', { name: 'Decisions', level: 1 })).toBeVisible();

  const decisionTitle = `What replaces Ledger Service? ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Title (e.g. What replaces SAP PM?)').fill(decisionTitle);
  await page.getByPlaceholder('Context — why this decision needs making').fill('Ledger Service is past its support end date and needs a replacement.');
  await page.getByRole('combobox').selectOption({ value: ownerId }); // the decision's own owner (F3's "owner", distinct from who authored it)
  await page.locator('input[type="date"]').fill('2027-06-01');

  // Link the seeded system as a "concern" of this decision.
  await page.getByPlaceholder('Search capabilities or systems this decision concerns…').fill('Ledger Service');
  await page.getByRole('button', { name: 'Ledger Service' }).click();
  await expect(page.getByText('Ledger Service', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Start decision' }).click();

  // 2. Landed on the decision's own page.
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();
  await expect(page.getByText('proposed', { exact: true })).toBeVisible();
  await expect(page.getByText('Ledger Service is past its support end date and needs a replacement.')).toBeVisible();
  await page.getByRole('button', { name: /^Concerns/ }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('link', { name: 'Ledger Service' })).toBeVisible();

  const decisionUrl = page.url();

  // 3. Listed on the Decisions page too.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/decisions`);
  await expect(page.locator('li', { hasText: decisionTitle })).toBeVisible();
  await page.locator('li', { hasText: decisionTitle }).getByRole('link', { name: 'Open →' }).click();
  await expect(page).toHaveURL(decisionUrl);

  // 4. Comment on it, mentioning bob — the same anchor_type='decision'
  // comment thread `decisions.integration.test.ts` proves at the API
  // level, now through the real composer.
  // The decision page's comments live in a panel under a plain "Comments" heading.
  const commentsSection = page.getByRole('heading', { name: 'Comments', level: 2 }).locator('xpath=..');
  await commentsSection.scrollIntoViewIfNeeded();
  const commentBody = `@${bobProfile.handle} — thoughts on this one?`;
  await commentsSection.getByPlaceholder('Write a comment…').fill(commentBody);
  await expect(commentsSection.getByText(`Will notify: @${bobProfile.handle}`)).toBeVisible();
  await commentsSection.getByRole('button', { name: 'Post' }).click();
  await expect(commentsSection.getByText(commentBody)).toBeVisible();

  // 5. Bob's own tray sees the mention and deep-links back to this decision.
  await bobPage.goto(`/o/${orgSlug}/m/${modelSlug}`);
  const bobTrayToggle = bobPage.getByRole('button', { name: /Notifications/ });
  await expect(bobTrayToggle).toBeVisible({ timeout: 15_000 });
  await bobTrayToggle.click();
  await expect(bobPage.getByText('mentioned you', { exact: false })).toBeVisible();
  await expect(bobPage.getByText(decisionTitle, { exact: false }).first()).toBeVisible();
  await bobPage.getByText(decisionTitle, { exact: false }).first().click();
  await expect(bobPage.getByRole('heading', { name: decisionTitle })).toBeVisible();
});
