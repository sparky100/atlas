/**
 * E7 (docs/prompts/atlas-prompt-pack.md): "merge two near-duplicate
 * systems, old name found by search, undo." Click-only from Home (S2's own
 * rule) — no seeding beyond org/user, no `page.goto` after the first, no
 * URL construction.
 */
import { expect, test } from '@playwright/test';
import { addSystemFromHome, goToModelHome, mergeElementInto, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('merge two near-duplicate systems, find the old name by search, then undo', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath-merge');

  // The survivor — the canonical system these two duplicates both describe.
  await addSystemFromHome(page, { name: 'Customer Billing System', description: 'Handles customer billing.' });

  // The loser — a near-duplicate created by mistake, currently on screen.
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Customer Billing Systm', description: 'Near-duplicate created by mistake.' });

  await mergeElementInto(page, 'Customer Billing System', 'Same real system — this is a duplicate created by mistake.');

  // Merging retracts the loser; its page has nothing left to show, so the
  // action lands on the survivor instead.
  await expect(page.getByRole('heading', { name: 'Customer Billing System' })).toBeVisible();
  await expect(page.getByText('Merged "Customer Billing Systm" into "Customer Billing System"')).toBeVisible();

  // "Old name found by search": the loser's own former name is now a real
  // alias of the survivor — searching it from Home surfaces the survivor,
  // not an empty result or a "Create…" offer for something that already
  // exists under a different name.
  await goToModelHome(page);
  const searchBox = page.getByPlaceholder('Search or create a capability, system, or actor…');
  await searchBox.fill('Customer Billing Systm');
  await page.getByRole('link', { name: 'Customer Billing System', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Customer Billing System' })).toBeVisible();

  // Undo, from the same toast the merge itself reported (`ToastHost.tsx`
  // persists across navigation, so it's still here after the search above).
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Undid merge of "Customer Billing Systm" into "Customer Billing System"')).toBeVisible();

  // The loser is back under its own real name, reachable by search again —
  // distinguished from the survivor's own (still-lingering) alias hit by
  // matching its exact original name, not a substring both would satisfy.
  await goToModelHome(page);
  await searchBox.fill('Customer Billing Systm');
  await page.getByRole('link', { name: 'Customer Billing Systm', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Customer Billing Systm' })).toBeVisible();
});
