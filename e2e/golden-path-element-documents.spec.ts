/**
 * ADR-030 golden path, click-only from Home at 1280 and 390: an owner adds a
 * web link and a plain reference to a system's Documents section, edits one,
 * then removes one. Atlas stores the pointers, never the documents.
 */
import { expect, test } from '@playwright/test';
import { addSystemFromHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('documents: add a link and a reference to a system, edit one, remove one', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'documents');
  await addSystemFromHome(page, { name: 'Payroll', description: 'Pays people.' });
  await expect(page.getByRole('heading', { name: 'Payroll' })).toBeVisible();

  await expect(page.getByText('No documents linked yet.')).toBeVisible();

  // A web link.
  await page.getByRole('button', { name: '+ Add a document' }).click();
  await page.getByLabel('Document name').fill('Solution design');
  await page.getByLabel('Link, or where to find it').fill('https://example.atlassian.net/wiki/spaces/PAY/pages/1');
  await page.getByRole('button', { name: 'Add document' }).click();
  const designLink = page.getByRole('link', { name: 'Solution design' });
  await expect(designLink).toHaveAttribute('href', 'https://example.atlassian.net/wiki/spaces/PAY/pages/1');
  await expect(designLink).toHaveAttribute('target', '_blank');

  // A plain reference — shown as text, not a link.
  await page.getByRole('button', { name: '+ Add a document' }).click();
  await page.getByLabel('Document name').fill('Business case');
  await page.getByLabel('Link, or where to find it').fill('SharePoint › Business cases');
  await page.getByRole('button', { name: 'Add document' }).click();
  await expect(page.getByText('Business case', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Business case' })).toHaveCount(0);

  // A link that isn't http(s) is refused.
  await page.getByRole('button', { name: '+ Add a document' }).click();
  await page.getByLabel('Document name').fill('Bad');
  await page.getByLabel('Link, or where to find it').fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Add document' }).click();
  await expect(page.getByText('A link must start with http:// or https://')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Edit, then remove.
  await page.getByRole('button', { name: 'Edit Business case' }).click();
  await page.getByLabel('Document name').fill('Business case v2');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Business case v2')).toBeVisible();

  await page.getByRole('button', { name: 'Remove Solution design' }).click();
  await page.getByRole('button', { name: 'Confirm remove Solution design' }).click();
  await expect(page.getByRole('link', { name: 'Solution design' })).toHaveCount(0);
  await expect(page.getByText('Business case v2')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
