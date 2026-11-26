/**
 * Catalogue claim review (proposals/PROPOSAL-catalogue-maintenance.md, step 1).
 * A claim is drafted first and reviewed second; the server records who and
 * when. Not a golden-path spec: becoming a platform admin needs a service-role
 * insert, and one waiting claim is seeded the same way, so this is an
 * `*.engine.spec.ts` like `platform-admin.engine.spec.ts`.
 *
 * Needs a real Supabase like every Playwright spec here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createServiceRoleClient, createSupabaseClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';

async function signUpAdmin(page: Page): Promise<void> {
  const env = loadEnv();
  const service = createServiceRoleClient(env);
  const email = `catalogue-review-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();
  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`catalogue-review fixture sign-in: ${signInError.message}`);
  const { data, error: userError } = await signedIn.auth.getUser();
  if (userError) throw new Error(`catalogue-review fixture: ${userError.message}`);
  const { error } = await service.from('platform_admins').insert({ user_id: data.user.id, granted_by: null });
  if (error) throw new Error(`catalogue-review fixture: ${error.message}`);
  await page.reload();
}

/** A saved claim is collapsed; open it if it is not already. */
async function openClaim(page: Page): Promise<void> {
  const details = page.locator('details').first();
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) await details.locator('summary').click();
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`an admin reviews a drafted claim in the editor and in the queue at ${String(viewport.width)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signUpAdmin(page);
    const suffix = randomUUID().slice(0, 8);

    await page.goto('/platform-admin/catalogue/products/new');
    await page.getByLabel('Product', { exact: true }).fill(`Review test ${suffix}`);
    await page.getByLabel('Vendor').fill('Review test vendor');
    await page.getByLabel('Stable code').fill(`review-test-${suffix}`);
    await page.getByLabel('Summary').fill('A product used to check claim review.');
    await page.getByRole('button', { name: 'Add claim' }).click();
    await page.getByLabel('Source URL').fill('https://example.test/review');
    await page.getByLabel('Statement').fill('The vendor describes this product as a test product.');
    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByText(/Product saved/)).toBeVisible();

    // Saved but not reviewed: the claim says so, with who drafted it.
    await expect(page.getByTestId('claim-status')).toContainText('Waiting for review');
    await expect(page.getByTestId('claim-status')).toContainText('Entered by');

    // Reviewing is its own step, recorded by the server.
    await openClaim(page);
    await page.getByLabel(/I have checked this claim against its source/).check();
    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByText(/1 claim marked as reviewed by you/)).toBeVisible();
    await expect(page.getByTestId('claim-status')).toContainText('Reviewed by');

    // Editing a reviewed claim sends it back to review.
    await openClaim(page);
    await page.getByLabel('Statement').fill('The vendor describes this product as a changed test product.');
    await expect(page.getByTestId('claim-status')).toContainText('it will need review again');
    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByTestId('claim-status')).toContainText('Waiting for review');

    // The same claim shows in the queue, reached from the admin navigation, and is reviewed from there.
    await page.getByRole('link', { name: 'Waiting for review' }).click();
    await expect(page.getByRole('heading', { name: 'Waiting for review' })).toBeVisible();
    const section = page.getByRole('region', { name: `Review test ${suffix}` });
    await expect(section.getByText('changed test product')).toBeVisible();
    await expect(section.getByRole('link', { name: 'Open the source' })).toHaveAttribute('href', 'https://example.test/review');
    await section.getByRole('button', { name: 'Mark all 1 as reviewed by me' }).click();
    await expect(page.getByText(/marked as reviewed by you/)).toBeVisible();
    await expect(page.getByRole('region', { name: `Review test ${suffix}` })).toHaveCount(0);
    await page.screenshot({ path: `test-results/catalogue-review-${String(viewport.width)}.png`, fullPage: true });
  });
}
