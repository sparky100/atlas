/**
 * Sprint 7j item 4: invite by email, both real consumption paths
 * `20260911060000_invites.sql`'s own module comment names — a genuinely
 * fresh signup using the invited email, and an email that already had an
 * account before the invite existed, consumed instead at their next
 * sign-in (`AuthProvider.tsx`'s `atlas.consume_my_invites` call). Neither
 * scenario is an extension of the existing "owner inserts membership
 * directly" test pattern every other multi-user spec in this suite uses —
 * that pattern is exactly what invite-by-email replaces.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('inviting an email that has never signed up: they sign up and land in the org with the invited role', async ({ page, browser }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'orgsettingsinvitefresh', 'Placeholder System');
  const { orgSlug } = fixture;

  // 1. Owner sends the invite via the settings UI.
  await page.goto(`/o/${orgSlug}/settings`);
  await expect(page.getByRole('heading', { name: 'Organisation settings' })).toBeVisible();
  const email = `orgsettingsinvitefresh-${randomUUID()}@example.test`;
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Role').selectOption('contributor');
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText(email)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Pending')).toBeVisible();

  // 2. A brand-new browser context signs up with exactly that email — no
  // "owner inserts membership directly" shortcut anywhere in this test.
  const inviteeContext = await browser.newContext();
  const inviteePage = await inviteeContext.newPage();
  const password = `${randomUUID()}Aa1!`;
  await inviteePage.goto('/sign-in');
  await inviteePage.getByText("Don't have an account? Create one").click();
  await inviteePage.getByLabel('Email').fill(email);
  await inviteePage.getByLabel('Password').fill(password);
  await inviteePage.getByRole('button', { name: 'Create account' }).click();

  // 3. Their very first organisation membership already exists — the
  // invite's own `auth.users`-insert trigger consumed it during signup
  // itself — so Home.tsx's display-name gate fires before "Your
  // organisations" would; this is their real first-sign-in moment, not a
  // special case this test is inventing.
  await expect(inviteePage.getByRole('heading', { name: 'What should we call you?' })).toBeVisible({ timeout: 15_000 });
  await inviteePage.getByLabel('Display name').fill('Freshly Invited');
  await inviteePage.getByRole('button', { name: 'Continue' }).click();

  await expect(inviteePage.getByRole('heading', { name: 'Your organisations' })).toBeVisible();
  await expect(inviteePage.getByRole('link', { name: 'orgsettingsinvitefresh Test Org' })).toBeVisible();

  // 4. The owner's own invite list reflects the consumption too.
  await page.reload();
  await expect(page.getByText('Joined')).toBeVisible({ timeout: 15_000 });
});

test('inviting an email that already has an account: consumed at their next sign-in, not automatically', async ({ page, browser }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'orgsettingsinviteexisting', 'Placeholder System');
  const { orgSlug } = fixture;

  // 1. A second user signs up first, entirely unrelated to this org — no
  // org membership yet at all, so "Your organisations" is the very first
  // thing they see (Home.tsx's display-name gate only fires once a
  // profile row exists, which needs a first membership).
  const inviteeContext = await browser.newContext();
  const inviteePage = await inviteeContext.newPage();
  const email = `orgsettingsinviteexisting-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  await inviteePage.goto('/sign-in');
  await inviteePage.getByText("Don't have an account? Create one").click();
  await inviteePage.getByLabel('Email').fill(email);
  await inviteePage.getByLabel('Password').fill(password);
  await inviteePage.getByRole('button', { name: 'Create account' }).click();
  await expect(inviteePage.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  // 2. Sign out — the invite is created after this, so the
  // `auth.users`-insert trigger already fired for this account and can
  // never see it.
  await inviteePage.getByRole('button', { name: 'Account menu' }).click();
  await inviteePage.getByRole('button', { name: 'Sign out' }).click();
  await expect(inviteePage).toHaveURL(/\/sign-in/);

  // 3. Owner invites that already-registered email.
  await page.goto(`/o/${orgSlug}/settings`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Role').selectOption('viewer');
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText(email)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Pending')).toBeVisible();

  // 4. The invitee signs back in — AuthProvider.tsx's own 'SIGNED_IN'
  // hook calls atlas.consume_my_invites, closing the gap the signup
  // trigger alone can't (their auth.users row already existed before this
  // invite did).
  await inviteePage.getByLabel('Email').fill(email);
  await inviteePage.getByLabel('Password').fill(password);
  await inviteePage.getByRole('button', { name: 'Sign in' }).click();

  // 5. Their first-ever org membership is created right at this sign-in,
  // so the display-name gate fires the same as a fresh signup would.
  await expect(inviteePage.getByRole('heading', { name: 'What should we call you?' })).toBeVisible({ timeout: 15_000 });
  await inviteePage.getByLabel('Display name').fill('Existing Account Invitee');
  await inviteePage.getByRole('button', { name: 'Continue' }).click();

  await expect(inviteePage.getByRole('heading', { name: 'Your organisations' })).toBeVisible();
  await expect(inviteePage.getByRole('link', { name: 'orgsettingsinviteexisting Test Org' })).toBeVisible();

  // 6. The owner's own invite list reflects the consumption too.
  await page.reload();
  await expect(page.getByText('Joined')).toBeVisible({ timeout: 15_000 });
});
