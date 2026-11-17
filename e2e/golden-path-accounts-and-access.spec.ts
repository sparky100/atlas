/**
 * Sprint F7's own golden path: "invite a second account, accept from the
 * email on mobile, assign a role, share a model read-only with a second
 * org." Click-only from Home (S2's own rule, `e2e/fixtures/goldenPath.ts`'s
 * module comment) — the invite/accept/role-assign steps reuse the fixture
 * helpers `org-settings-invite.engine.spec.ts` (a deep-linking spec, so it
 * doesn't count as user coverage per CLAUDE.md's own "Coverage" rule) first
 * proved against real RLS/triggers; this is the click-only, counted
 * equivalent, extended with model sharing. `golden-path-*.spec.ts` runs at
 * both 1280 and 390 automatically (`playwright.config.ts`'s `chromium-390`
 * project) — the one place this sprint's own name choice is deliberate for
 * that reason, matching `golden-path-auth-mobile.spec.ts`'s precedent for
 * "verified on mobile" meaning "this same spec, run again at 390," not a
 * separate mobile-only test.
 *
 * "Accept from the email" is simulated the same way invite consumption has
 * always worked in this suite (no real inbox in this sandbox, stated
 * plainly, same limitation `docs/EDGE-FUNCTIONS.md` already names for
 * Resend delivery): signing up with the invited email is the literal
 * consumption path (`atlas.consume_invites_for_new_user`), not a shortcut
 * around it.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { acceptInviteViaSignUp, inviteMemberFromHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('accounts and access: invite, accept, assign a role, then share a model read-only with a second organisation', async ({ page, browser }) => {
  const prefix = 'goldenpath-accounts';
  const { orgName, modelName, orgSlug: firstOrgSlug, modelSlug } = await signUpCreateOrgAndModel(page, prefix);

  // 1. Invite a second account by email, with a role, from the org
  // settings UI.
  const inviteeEmail = `${prefix}-invitee-${randomUUID()}@example.test`;
  await inviteMemberFromHome(page, orgName, inviteeEmail, 'contributor');
  await expect(page.getByText('Pending')).toBeVisible();

  // 2. "Accept from the email" — a separate browser context signs up with
  // exactly the invited address; their very first organisation membership
  // is already there, consumed during signup itself.
  const inviteeContext = await browser.newContext();
  const inviteePage = await inviteeContext.newPage();
  const inviteeDisplayName = `${prefix} Invitee ${randomUUID().slice(0, 8)}`;
  await acceptInviteViaSignUp(inviteePage, inviteeEmail, inviteeDisplayName);
  await expect(inviteePage.getByRole('link', { name: orgName })).toBeVisible();

  // 3. Assign a role — the owner's own member-directory role select, once
  // the invite's consumption shows up here.
  await page.reload();
  // The invite's own status chip (member rows also read "Joined <date>").
  await expect(page.getByText('Joined', { exact: true })).toBeVisible({ timeout: 15_000 });
  const roleSelect = page.getByLabel(`Role for ${inviteeDisplayName}`);
  await roleSelect.selectOption('architect');
  await expect(roleSelect).toHaveValue('architect');

  // 4. A second organisation to share into — "New organisation" from Home
  // (the owner already has one org, so this is the additional-org path,
  // not the zero-org "Just me"/"My organisation" choice).
  await page.getByRole('link', { name: 'Atlas', exact: true }).click();
  await page.getByRole('button', { name: 'New organisation' }).click();
  const secondOrgName = `${prefix} Second Org ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Organisation name').fill(secondOrgName);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  // A just-created organisation opens by itself (Home.tsx, #488).
  await expect(page).toHaveURL(/\/o\/[^/]+$/);
  await expect(page.getByRole('heading', { name: secondOrgName })).toBeVisible();
  const secondOrgSlugMatch = /\/o\/([^/]+)/.exec(page.url());
  if (!secondOrgSlugMatch?.[1]) throw new Error(`could not read the second org slug out of ${page.url()}`);
  const secondOrgSlug = secondOrgSlugMatch[1];

  // 5. Share the first model with the second org, read-only, from Model
  // settings — "current main" (the version field's own default), never a
  // pinned tag, which the golden path doesn't need.
  await page.getByRole('link', { name: 'Atlas', exact: true }).click();
  await page.getByRole('link', { name: orgName }).click();
  await page.getByRole('link', { name: modelName }).click();
  await page.getByRole('button', { name: 'Model actions' }).click();
  await page.getByRole('link', { name: 'Model settings' }).click();
  await expect(page.getByRole('heading', { name: 'Share with another organisation' })).toBeVisible();
  await page.getByLabel('Organisation slug').fill(secondOrgSlug);
  await page.locator('form').filter({ has: page.getByLabel('Organisation slug') }).getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByText(secondOrgName)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('main').getByText('live model', { exact: true })).toBeVisible();

  // 6. The second org's own "Shared with us" entry resolves — read-only,
  // never the owning org's settings menu.
  await page.getByRole('link', { name: 'Atlas', exact: true }).click();
  await page.getByRole('link', { name: secondOrgName }).click();
  await expect(page.getByRole('button', { name: /Shared with us/ })).toBeVisible();
  await expect(page.getByText(`from ${orgName}`)).toBeVisible();
  const sharedModelLink = page.getByRole('link', { name: new RegExp(modelName) });
  await expect(sharedModelLink).toBeVisible();
  await sharedModelLink.click();

  await expect(page.getByRole('heading', { name: modelName })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/o/${firstOrgSlug}/m/${modelSlug}`));
  // Opened from the second organisation, the shared model is the owning
  // organisation's own model page. The person here owns that organisation
  // too, so its owner affordances rightly still show — this path can't
  // demonstrate read-only access for an outsider; `src/db/modelShares.integration.test.ts`
  // covers what a share grants and refuses.
  await expect(page.getByRole('button', { name: 'Model actions' })).toBeVisible();
});
