/**
 * F1 ("custom attributes") PR4's own golden path (docs/prompts/atlas-prompt-pack.md):
 * "define a select attribute, set it on a system, filter the browse table
 * by it." Click-only from Home, same S2 discipline every other
 * `golden-path-*.spec.ts` follows (`fixtures/goldenPath.ts`'s own module
 * comment) — no seeding beyond org/user, no `page.goto` after sign-in, no
 * URL construction. Two systems are created so the filter step actually
 * proves something (one matches, one doesn't), rather than merely showing
 * a filtered table with nothing to have been filtered out.
 */
import { expect, test } from '@playwright/test';
import { addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('define a select attribute, set it on a system, and filter the browse table by it', async ({ page }) => {
  const { orgName, modelName } = await signUpCreateOrgAndModel(page, 'customattrs');

  // Two systems: one will get Region=EMEA, the other is left unset —
  // the filter step below proves it actually narrows the table, not just
  // that it renders.
  await addSystemFromHome(page, { name: 'Northgate', description: "The borough's new revenues platform." });
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Council Tax System', description: 'Handles council tax accounts.' });
  await goToModelHome(page);

  // Define the attribute — owner-only, under organisation settings
  // (same "Atlas" → org → "Org settings" click path
  // `inviteMemberFromHome` already exercises at both widths).
  await page.getByRole('link', { name: 'Atlas' }).click();
  await page.getByRole('link', { name: orgName }).click();
  await page.getByRole('link', { name: 'Org settings' }).click();
  await expect(page.getByRole('heading', { name: 'Organisation settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Custom attributes' })).toBeVisible();

  await page.getByLabel('Key').fill('region');
  await page.getByLabel('Label').fill('Region');
  await page.getByLabel('Kind').selectOption('select');
  await page.getByLabel('Options (comma-separated)').fill('EMEA, AMER, APAC');
  // "Applies to" already defaults to "system" — this golden path never
  // needs to touch it.
  await page.getByRole('button', { name: 'Define attribute' }).click();
  await expect(page.getByText('Region')).toBeVisible();

  // Back into the model, onto Northgate's own page, to set the value.
  await page.getByRole('link', { name: 'Atlas' }).click();
  await page.getByRole('link', { name: orgName }).click();
  await page.getByRole('link', { name: modelName }).click();
  await page.getByRole('link', { name: 'Northgate' }).click();
  await expect(page.getByRole('heading', { name: 'Northgate' })).toBeVisible();

  await page.getByRole('button', { name: /Edit/ }).click();
  await page.getByLabel('Region').selectOption('EMEA');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('EMEA')).toBeVisible();

  // Filter the browse table by the same attribute — only Northgate should
  // remain; Council Tax System (never given a Region) drops out.
  await goToModelHome(page);
  await page.getByRole('link', { name: 'Browse all elements' }).click();
  await page.getByLabel('Custom attribute').selectOption('region');
  await page.getByLabel('Region').selectOption('EMEA');

  await expect(page.getByRole('link', { name: 'Northgate' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Council Tax System' })).not.toBeVisible();
});
