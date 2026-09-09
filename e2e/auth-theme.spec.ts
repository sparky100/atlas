import { expect, test } from '@playwright/test';

/**
 * Sprint U1 step 2a's named Playwright test: switch theme, reload, verify
 * it persisted. Signs up through the real form (local Supabase has email
 * confirmation disabled — supabase/config.toml — so the session is usable
 * immediately, no shortcut needed).
 *
 * Two persistence checks, not one: same-context reload (could pass off
 * localStorage alone) and a reload with localStorage cleared first, which
 * only passes if `user_preferences` (SPEC §3.2) actually round-tripped
 * through Supabase — the thing step 2a was actually asked to build.
 */
test('switching theme persists across reload, including from user_preferences alone', async ({ page }) => {
  // Fixes the OS-preference half of 'system' so the starting state doesn't
  // depend on the runner's own default colour scheme.
  await page.emulateMedia({ colorScheme: 'light' });

  const email = `e2e-${crypto.randomUUID()}@example.test`;
  const password = `${crypto.randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // Sprint U4-2a item 6: theme/density/sign-out sit behind the single
  // avatar menu on every viewport now, not open in the header bar.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Same-context reload: proves the toggle round-trips through *something*
  // persistent (localStorage would already make this pass on its own).
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Clear the theme's own localStorage cache and reload: this can only
  // still be 'dark' if user_preferences.theme was actually persisted
  // server-side and ThemeProvider loaded it back on sign-in. A blanket
  // localStorage.clear() would also wipe supabase-js's own session token
  // (it persists there too, by default) and sign the user out — clearing
  // only the pre-paint theme cache keys (src/ui/theme/preferences.ts's
  // THEME_STORAGE_KEY/DENSITY_STORAGE_KEY) isolates the thing this
  // assertion is actually testing.
  await page.evaluate(() => {
    localStorage.removeItem('atlas:theme');
    localStorage.removeItem('atlas:density');
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
