/**
 * S2 flow 3 (docs/prompts/atlas-prompt-pack.md): "rename, retire with
 * replacement, remove a system." Three distinct header actions — read as
 * three separate actions to exercise, not one system chained through all
 * three (a small, clearly-scoped judgment call: retiring a system already
 * makes it read-only in most of the UI, and there's no single system for
 * which "rename it, then retire it, then remove it" is itself a coherent
 * real user action), so this flow creates one system per action, all by
 * clicking (S2's own "no seeding beyond org and user" rule).
 */
import { expect, test } from '@playwright/test';
import { addSystemFromHome, goToModelHome, removeElementFromModel, renameElement, retireElement, signUpCreateOrgAndModel } from './fixtures/goldenPath';

function isoDateDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test('rename a system, retire another with a replacement, remove a third from the model', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath3');

  // 1. Rename.
  await addSystemFromHome(page, { name: 'Old Ledger', description: 'The system to be renamed.' });
  await renameElement(page, 'Renamed Ledger');

  // 2. Retire with a replacement — the replacement must exist first.
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'New Billing Platform', description: 'The replacement system.' });
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Legacy Billing System', description: 'The system to be retired.' });
  await retireElement(page, isoDateDaysFromNow(60), 'New Billing Platform');
  await expect(page.getByText(/Replaced by/)).toBeVisible();
  await expect(page.getByText('retiring', { exact: true }).first()).toBeVisible();

  // 3. Remove from the model.
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Throwaway System', description: 'The system to be removed.' });
  await removeElementFromModel(page);
  await expect(page.getByRole('heading', { name: 'Throwaway System' })).toHaveCount(0);
});
