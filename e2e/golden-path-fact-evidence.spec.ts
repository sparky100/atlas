import { expect, test } from '@playwright/test';
import { addSystemFromHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test.use({ hasTouch: true });

test('open fact evidence, retry history, and dismiss with keyboard or touch', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'fact-evidence');
  await addSystemFromHome(page, { name: 'Payment gateway', description: 'Accepts customer payments.' });

  const badge = page.getByRole('button', { name: 'Evidence for Payment gateway', exact: true });
  const panel = page.getByRole('dialog', { name: 'Evidence for Payment gateway' });
  let failHistory = true;
  await page.route((url) => url.pathname.endsWith('/rest/v1/deltas') && url.searchParams.get('select') === '*' && url.searchParams.has('id'), async (route) => {
    if (failHistory) await route.fulfill({ status: 400, json: { message: 'Temporary history failure' } });
    else await route.continue();
  });

  await badge.focus();
  await expect(panel).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(panel).toBeFocused();
  await expect(panel.getByRole('alert')).toHaveText('Couldn’t load earlier evidence.');
  await expect(panel.getByText('Source', { exact: true })).toBeVisible();

  failHistory = false;
  await panel.getByRole('button', { name: 'Retry history' }).press('Enter');
  await expect(panel.getByText('No earlier evidence.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(badge).toBeFocused();

  await badge.tap();
  await expect(panel.getByText('No earlier evidence.')).toBeVisible();
  await expect(panel).toBeInViewport({ ratio: 1 });
  await panel.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(panel).toBeHidden();
});
