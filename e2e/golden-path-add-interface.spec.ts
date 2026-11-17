/**
 * ADR-026: adding an interface to an integration platform from the
 * platform's own page — "+ Add interface", one form for the interface's
 * name, type and transformation, one commit. Click-only from Home (S2's own
 * rule): create the platform, mark it an integration platform, add two
 * interfaces in a row, and open one to see what was recorded.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addSystemFromHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

/** The Interfaces section (the `<section>` its header button sits in) — the new interface is also listed under Structure, as every child is. Located through the header each time, since the section remounts when the page reloads after a save. */
function interfacesSection(page: Page): Locator {
  return page.locator('section').filter({ has: page.getByRole('button', { name: /^Interfaces/ }) });
}

test('add interfaces to an integration platform from its own page, with type and transformation in one step', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath-addinterface');

  await addSystemFromHome(page, { name: 'MuleSoft', description: 'The integration platform.' });
  await page.getByRole('button', { name: /Edit/ }).click();
  await page.getByLabel('Kind').selectOption('integration_platform');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: /Interfaces/ })).toBeVisible();

  // First interface: a file drop the platform turns into an API.
  await page.getByRole('button', { name: '+ Add interface' }).click();
  await page.getByLabel('Interface name').fill('Meter reads file');
  await page.getByLabel('Interface type').selectOption('file');
  await page.getByLabel(/Transformation/).fill('Turns the nightly meter-read file into a REST API');
  await page.getByRole('button', { name: 'Add interface', exact: true }).click();
  await expect(interfacesSection(page).getByRole('link', { name: /Meter reads file/ })).toBeVisible({ timeout: 15_000 });
  await expect(interfacesSection(page).getByText('File · 0 flows')).toBeVisible();

  // A second straight after — still on the platform's page, transformation left out.
  await page.getByRole('button', { name: '+ Add interface' }).click();
  await page.getByLabel('Interface name').fill('Customer API');
  await page.getByLabel('Interface type').selectOption('api');
  await page.getByRole('button', { name: 'Add interface', exact: true }).click();
  await expect(interfacesSection(page).getByRole('link', { name: /Customer API/ })).toBeVisible({ timeout: 15_000 });
  await expect(interfacesSection(page).getByText('API · 0 flows')).toBeVisible();

  // The interface's own page: named "Platform · Interface", with what was recorded.
  await interfacesSection(page).getByRole('link', { name: /Meter reads file/ }).click();
  await expect(page.getByRole('heading', { name: 'Meter reads file' })).toBeVisible();
  await expect(page.getByText('Turns the nightly meter-read file into a REST API')).toBeVisible();
  // With no flow through it yet, the "Flows via this interface" section is hidden rather than shown empty (ElementPage.tsx).
  await expect(page.getByText('Flows via this interface', { exact: false })).toHaveCount(0);
});
