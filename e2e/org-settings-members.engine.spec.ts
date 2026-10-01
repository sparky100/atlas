/**
 * Sprint 7j item 2: organisation settings' rename, member directory (role
 * change, remove) and the pre-existing `atlas.guard_last_owner` trigger
 * surfaced through this new UI. Delete organisation itself is covered by
 * `updateOrganisation`/`deleteOrganisation`'s own integration test
 * (`src/db/organisationSettings.integration.test.ts`) rather than a second
 * Playwright pass over the same typed-name-confirm mechanics
 * `model-settings-archive.spec.ts` already exercises end-to-end.
 */
import { randomUUID } from 'node:crypto';
import type { Browser } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { createSupabaseClient, type Client } from '../src/db/client';
import type { Env } from '../src/db/env';
import { loadEnv } from '../src/db/env';
import { updateMyProfile } from '../src/db/profiles';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

/**
 * Signs up a fresh user through the real `/sign-in` form (own browser
 * context, same convention `model-settings-archive.spec.ts`'s architect
 * fixture already uses), gives them a known display name so their member
 * row is identifiable in the directory without relying on their email
 * (this product never exposes member email by design, ADR-009's
 * `atlas.profiles` amendment), and adds them to `orgId` with `role`.
 */
async function addNamedMember(browser: Browser, env: Env, owner: Client, orgId: string, ownerId: string, prefix: string, displayName: string, role: 'architect' | 'viewer'): Promise<void> {
  const context = await browser.newContext();
  const memberPage = await context.newPage();
  const email = `${prefix}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  await memberPage.goto('/sign-in');
  await memberPage.getByText("Don't have an account? Create one").click();
  await memberPage.getByLabel('Email').fill(email);
  await memberPage.getByLabel('Password').fill(password);
  await memberPage.getByRole('button', { name: 'Create account' }).click();
  await expect(memberPage.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const auth = createSupabaseClient(env);
  const { error: signInError } = await auth.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`${prefix} sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await auth.auth.getUser();
  if (getUserError) throw new Error(`${prefix}: could not read the signed-up user: ${getUserError.message}`);

  // Membership first: the profile row is created by the first `members`
  // insert (`atlas.ensure_profile`), so there is nothing to name before it.
  const { error: memberError } = await owner.from('members').insert({ org_id: orgId, user_id: userData.user.id, role, invited_by: ownerId });
  if (memberError) throw new Error(`${prefix}: could not add as member: ${memberError.message}`);
  await updateMyProfile(auth, { userId: userData.user.id, displayName });
  await context.close();
}

test('owner renames the organisation, changes a member’s role, and removes a member', async ({ page, browser }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'orgsettingsmembers', 'Placeholder System');
  const { signedIn: owner, orgId, orgSlug, userId: ownerId } = fixture;

  await addNamedMember(browser, env, owner, orgId, ownerId, 'orgsettingsmembers-architect', 'Ada Architect', 'architect');
  await addNamedMember(browser, env, owner, orgId, ownerId, 'orgsettingsmembers-viewer', 'Vic Viewer', 'viewer');

  // 1. Owner opens organisation settings via the header's "Org settings" link.
  await page.goto(`/o/${orgSlug}`);
  await page.getByRole('link', { name: 'Org settings' }).click();
  await expect(page.getByRole('heading', { name: 'Organisation settings' })).toBeVisible();

  // 2. Rename — saving reloads the page (OrganisationSettingsPage.tsx's own
  // onChanged), so the real proof is the input's own value on the fresh
  // load, not a text node.
  const newName = `Renamed Org ${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Name', { exact: true }).fill(newName);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Organisation settings' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(newName);

  // 3. Change Ada's role — no page reload on a member mutation (useMembers
  // reloads its own list in place), so this is a direct assertion.
  const roleSelect = page.getByLabel('Role for Ada Architect');
  await expect(roleSelect).toHaveValue('architect');
  await roleSelect.selectOption('contributor');
  await expect(roleSelect).toHaveValue('contributor');

  // 4. Remove Vic — their row disappears from the directory.
  await expect(page.getByText('Vic Viewer', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Vic Viewer' }).click();
  await expect(page.getByText('Vic Viewer', { exact: true })).toHaveCount(0, { timeout: 15_000 });
});

test('the last owner cannot demote or remove themself — guard_last_owner surfaces an error', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'orgsettingslastowner', 'Placeholder System');
  const { orgSlug } = fixture;

  await page.goto(`/o/${orgSlug}/settings`);
  await expect(page.getByRole('heading', { name: 'Organisation settings' })).toBeVisible();

  // The owner's own row is the only one, marked "(you)".
  await expect(page.getByText('(you)')).toBeVisible();

  const ownRoleSelect = page.getByRole('combobox').first();
  await expect(ownRoleSelect).toHaveValue('owner');
  await ownRoleSelect.selectOption('architect');
  await expect(page.getByRole('alert').filter({ hasText: "Could not change this member's role" })).toBeVisible({ timeout: 15_000 });
  // The select itself reflects the refused write once the list re-fetches —
  // still 'owner', not the locally-picked 'architect'.
  await expect(ownRoleSelect).toHaveValue('owner');

  await page.getByRole('button', { name: /^Remove/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not remove this member' })).toBeVisible({ timeout: 15_000 });
});
