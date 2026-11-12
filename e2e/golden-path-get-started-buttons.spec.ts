/**
 * Home's "Get started" checklist has two plain first-step buttons: "Add
 * application" (opens the add box, which still checks existing applications
 * and modules by name first) and "Import inventory" (links to Import).
 * Click-only from Home.
 */
import { expect, test } from '@playwright/test';
import { addCapability, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('Get started: Add application checks names first, and Import inventory opens Import', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'getstartedbuttons');
  await addCapability(page, 'Billing');
  await goToModelHome(page);

  await expect(page.getByRole('heading', { name: 'Get started' })).toBeVisible();
  await page.getByRole('button', { name: 'Add application' }).click();
  await expect(page.getByText(/Atlas checks the applications and modules you already have/)).toBeVisible();

  // Typing a name offers to create it (nothing with that name exists yet).
  const searchBox = page.getByPlaceholder('Search or create a capability, system, or actor…');
  await expect(searchBox).toBeFocused();
  await searchBox.fill('Northgate');
  await expect(page.getByRole('button', { name: 'Create system "Northgate"' })).toBeVisible();

  await page.getByRole('link', { name: 'Import inventory' }).click();
  await expect(page).toHaveURL(/\/capture/);
});
