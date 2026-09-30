/**
 * Run cost (`annualRunCost`) golden path — click-only from Home (S2's own
 * rule), running at both 1280 and 390 like every `golden-path-*` spec:
 *
 * 1. Set Run cost on a system through the ordinary Attributes "✎ Edit"
 *    form (the generic editor renders it from `attributeSchema.ts`'s own
 *    entry — labels and help text included, same as
 *    `golden-path-decision-remove-crossing.spec.ts`'s Domain edit), see
 *    the band's *label* ("£50k–£250k", not the stored key) and have it
 *    survive a reload.
 * 2. Same on a container (a module of that system) — its own judged value,
 *    never the platform's band.
 * 3. A capability shows no Run cost field at all, in read or edit mode —
 *   the field exists only on System/Container schemas.
 * 4. Clear the value and the row reads "Not entered" — visibly distinct
 *    from the recorded "None / included" band, across a reload too.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCapability, addContainerFromHome, addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

const HELP_TEXT = "Annual cost that stops if this is retired. Not a share of the platform's cost.";

async function openElementFromHome(page: Page, name: string): Promise<void> {
  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill(name);
  await page.getByRole('link', { name, exact: true }).first().click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test('set Run cost on a system and a container, a capability has no Run cost field, and clearing it reads Not entered', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'runcost');

  // 1. System: edit form shows the help text, band label selected, saved,
  //    label shown read-only, and still there after a real reload.
  await addSystemFromHome(page, { name: 'Billing System', description: 'Runs the billing cycle.' });
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await expect(page.getByText(HELP_TEXT)).toBeVisible();
  await page.getByLabel('Run cost').selectOption('50k_250k');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('£50k–£250k', { exact: true })).toBeVisible();
  await expect(page.getByText('Not entered', { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Billing System' })).toBeVisible();
  await expect(page.getByText('£50k–£250k', { exact: true })).toBeVisible();

  // 2. Container: a module of that system records its own band.
  await goToModelHome(page);
  await addContainerFromHome(page, 'Billing Module', 'Billing System');
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Run cost').selectOption('under_50k');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Under £50k', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Billing Module' })).toBeVisible();
  await expect(page.getByText('Under £50k', { exact: true })).toBeVisible();

  // 3. Capability: no Run cost row in the read-only list, no Run cost
  //    control in the edit form — the schema has no such field there.
  await goToModelHome(page);
  await addCapability(page, 'Payment handling');
  await openElementFromHome(page, 'Payment handling');
  await expect(page.getByText('Run cost', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await expect(page.getByLabel('Run cost')).toHaveCount(0);
  await expect(page.getByText(HELP_TEXT)).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel' }).click();

  // 4. Clear the system's value: the row reads "Not entered" — not a bare
  //    "—", and not "None / included" — and it survives a reload.
  await openElementFromHome(page, 'Billing System');
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Run cost').selectOption('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Not entered', { exact: true })).toBeVisible();
  await expect(page.getByText('£50k–£250k', { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Billing System' })).toBeVisible();
  await expect(page.getByText('Not entered', { exact: true })).toBeVisible();
});
