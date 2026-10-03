/**
 * Capability importance — click-only from Home (S2's own rule), running at
 * both 1280 and 390 like every `golden-path-*` spec: set `importance` on a
 * couple of capabilities (a third left unset), see Director home's own
 * weak-tile order change to match (high first, unset last), and see the
 * gentle "Importance not set" prompt on the unset one.
 *
 * A capability with no supporting systems at all already reads as a weak
 * ("neutral") tile (`isCapabilityTileWeak`) — no need to retire anything to
 * get three tiles into the weak group for this test.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCapability, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

async function openElementFromHome(page: Page, name: string): Promise<void> {
  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill(name);
  await page.getByRole('link', { name, exact: true }).first().click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function setImportance(page: Page, level: string): Promise<void> {
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Importance').selectOption(level);
  await page.getByRole('button', { name: 'Save' }).click();
}

/** `HomeModeSwitch`'s own toggle occasionally doesn't register on the very first click — pre-existing, unrelated to this test's own feature; retried rather than masked. */
async function switchToDirectorView(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Overview', exact: true });
  for (let attempt = 0; attempt < 4; attempt++) {
    await button.click();
    try {
      await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: 2000 });
      return;
    } catch {
      // retry
    }
  }
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

test('setting importance on weak capabilities reorders Director home\'s weak tiles, high first, unset last', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'capimportance');

  await addCapability(page, 'Cap Low');
  await addCapability(page, 'Cap High');
  await addCapability(page, 'Cap Unset');

  await openElementFromHome(page, 'Cap Low');
  await setImportance(page, 'low');
  await expect(page.getByText('Low', { exact: true })).toBeVisible();

  await openElementFromHome(page, 'Cap High');
  await setImportance(page, 'high');
  await expect(page.getByText('High', { exact: true })).toBeVisible();

  // Cap Unset: never touched — reads as "not assessed."

  await goToModelHome(page);
  await switchToDirectorView(page);
  await expect(page.getByText('Where are we weak')).toBeVisible();

  // All three are weak (no supporting systems at all) and reordered:
  // Cap High first, Cap Low second, Cap Unset last.
  const weakSectionText = await page.getByRole('region', { name: 'Where are we weak' }).innerText();
  const highIndex = weakSectionText.indexOf('Cap High');
  const lowIndex = weakSectionText.indexOf('Cap Low');
  const unsetIndex = weakSectionText.indexOf('Cap Unset');
  expect(highIndex).toBeGreaterThanOrEqual(0);
  expect(lowIndex).toBeGreaterThan(highIndex);
  expect(unsetIndex).toBeGreaterThan(lowIndex);

  // The gentle prompt shows only on the unset, flagged tile.
  await expect(page.getByText('Importance not set')).toBeVisible();

  // No horizontal overflow (meaningful at 390).
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});
