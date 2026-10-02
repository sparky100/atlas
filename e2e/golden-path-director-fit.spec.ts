/**
 * "Make capability fit-for-purpose visible to directors" (F6.1): rate a
 * capability's primary supporter a poor fit, switch to the Director door,
 * confirm the tile is flagged with its own "poor fit" pill — independent
 * of the tile's own exposure tone, which stays `ok` throughout (the
 * system is `active`, never retiring) — follow the pill's own link to the
 * affected capability, then start a decision from the tile with that
 * capability as its concern. Click-only from Home, same "no seeding
 * beyond org and user" S2 rule every other `golden-path-*.spec.ts`
 * follows.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCapability, addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

/** `HomeModeSwitch`'s own toggle occasionally doesn't register on the very first click right after a save+navigate — pre-existing, unrelated to this test's own feature; retried rather than masked, so a genuine break still fails loudly on the final assertion. */
async function switchToDirectorView(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Capability view' });
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

test('rate a primary supporter a poor fit; the Director door flags the capability with its own pill, links to it, and starts a decision naming it as the concern', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'directorfit');

  await addCapability(page, 'Finance');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Ledger System', description: 'The financial ledger system.', capabilityName: 'Finance' });
  await expect(page.getByRole('heading', { name: 'Ledger System' })).toBeVisible();

  // Rate the just-created supports edge into Finance a poor fit, and make
  // it the primary supporter — the only relationship on this brand-new
  // system's own page, so its own "Show attributes" toggle is unambiguous.
  await page.getByRole('button', { name: 'Show attributes' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Role').selectOption('primary');
  await page.getByLabel('Fit for purpose').selectOption('poor');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // The edit panel closes once the save lands — its own History entry
  // confirms the write, the same signal the app itself surfaces.
  await expect(page.getByText('Fit for purpose: poor', { exact: false })).toBeVisible();

  // Switch to the Director door (an owner defaults to the Application view).
  await goToModelHome(page);
  await switchToDirectorView(page);

  // The Finance tile: exposure tone stays "no known exposure" (the system
  // is active, not retiring), but the fit pill flags it independently —
  // and visibly distinct from the tone/owner chip beside it.
  await expect(page.getByText('no known exposure', { exact: false })).toBeVisible();
  const fitPill = page.getByText('poor fit: 1 capability', { exact: true });
  await expect(fitPill).toBeVisible();

  // The pill links to the real, affected capability.
  const financeLink = page.getByRole('link', { name: 'Finance', exact: true });
  await expect(financeLink).toBeVisible();
  await financeLink.click();
  await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();

  // Back on the Director door, start a decision from the flagged tile —
  // Finance (the poor-fit capability) is the concern, not the tile's own
  // top-level capability (here, the same element, but named individually).
  await goToModelHome(page);
  await switchToDirectorView(page);
  await page.getByRole('link', { name: 'Start a decision →' }).click();
  await expect(page.getByRole('heading', { name: 'Start a decision' })).toBeVisible();
  await expect(page.getByText('Finance', { exact: false }).first()).toBeVisible();
  await page.getByRole('combobox').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByText('Finance', { exact: true })).toBeVisible();
});
