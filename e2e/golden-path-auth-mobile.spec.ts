/**
 * Sprint F7 item 3: "magic link and password reset verified on mobile."
 * Click-only from `/sign-in` — the literal front door, before any
 * organisation or Home page exists for a brand-new user, the same
 * starting point `org-and-model-home.spec.ts`/`auth-theme.spec.ts`
 * already use for auth-surface coverage. `golden-path-*.spec.ts` runs at
 * both 1280 and 390 automatically (`playwright.config.ts`'s
 * `chromium-390` project) — this is the one place in this sprint that
 * name is chosen specifically to get that.
 *
 * Verifies the *request* side of magic link and password reset end to
 * end (the actual UI, not a stub) — sending the email and confirming the
 * app's own response. It does not verify delivery or read a real inbox
 * (no test-mailbox credentials exist in this sandbox — the same honest
 * limitation named for Resend in docs/EDGE-FUNCTIONS.md); that half needs
 * a real email account to confirm.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('auth: sign up, sign out, request a magic link, request a password reset, then sign back in with the original password', async ({ page }) => {
  const email = `authmobile-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');

  // Sign up.
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  // Sign out (this device only — the ordinary header action).
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Atlas' })).toBeVisible();

  // Magic link — request only.
  await page.getByRole('button', { name: 'Email me a sign-in link instead' }).click();
  await expect(page.getByRole('heading', { name: 'Email me a sign-in link' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send link' }).click();
  await expect(page.getByText('Check your email for a sign-in link.')).toBeVisible();

  // Back to sign in, then forgot password — request only.
  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  // Auth allows one email per address per second (supabase/config.toml
  // `[auth.email] max_frequency`), and the magic link above was just sent —
  // a too-soon request shows "Too many attempts", so retry as a user would.
  await expect(async () => {
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText('Check your email for a link to reset your password.')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });

  // The original password still works — neither request-only flow above
  // signed the user in or changed anything about the real account.
  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();
});
