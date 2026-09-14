/**
 * Sprint F7 item 2: the profile page — display name, handle, avatar, own
 * email, sign out everywhere. Click-only from Home, no page.goto after
 * sign-up (S2's own rule, `e2e/fixtures/goldenPath.ts`'s module comment).
 * `golden-path-*.spec.ts` runs at both 1280 and 390 automatically
 * (`playwright.config.ts`'s `chromium-390` project).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('profile: edit display name/handle/avatar from the account menu, then sign out everywhere', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath-profile');

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('link', { name: 'Profile' }).click();
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();

  const newDisplayName = `Renamed ${randomUUID().slice(0, 8)}`;
  const newHandle = `handle-${randomUUID().slice(0, 8)}`;
  const avatarUrl = 'https://example.test/avatar.png';

  await page.getByLabel('Display name').fill(newDisplayName);
  await page.getByLabel('Handle').fill(newHandle);
  await page.getByLabel('Avatar URL').fill(avatarUrl);
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Saved.')).toBeVisible();
  // A reload proves the save actually persisted, not just local form state.
  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue(newDisplayName);
  await expect(page.getByLabel('Handle')).toHaveValue(newHandle);
  await expect(page.getByLabel('Avatar URL')).toHaveValue(avatarUrl);

  // Own email is shown (read-only) — never another member's, ADR-009's
  // own boundary is about *other* members, not a person's own account.
  await expect(page.getByText(/Email: .+@example\.test/)).toBeVisible();

  await page.getByRole('button', { name: 'Sign out everywhere' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 15_000 });
});
