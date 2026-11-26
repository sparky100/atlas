/**
 * Catalogue step 2 (proposals/PROPOSAL-catalogue-maintenance.md): a product
 * links once to a shared capability, and a general capability is not added a
 * second time as a sector link. Not a golden-path spec: becoming a platform
 * admin and seeding an aligned set need service-role inserts, so this is an
 * `*.engine.spec.ts` like `platform-admin.engine.spec.ts`.
 *
 * Also covers step 4a (publishing one product). These tests share one file and
 * run one after another because each seeds an any_organisation set and the
 * product editor offers the shared capabilities of the NEWEST one, so two of
 * them running at once would hide each other's capability.
 *
 * Needs a real Supabase like every Playwright spec here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createServiceRoleClient, createSupabaseClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';

test.describe.configure({ mode: 'serial' });

async function signUpAdmin(page: Page): Promise<void> {
  const env = loadEnv();
  const service = createServiceRoleClient(env);
  const email = `catalogue-shared-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();
  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`catalogue-shared fixture sign-in: ${signInError.message}`);
  const { data, error: userError } = await signedIn.auth.getUser();
  if (userError) throw new Error(`catalogue-shared fixture: ${userError.message}`);
  const { error } = await service.from('platform_admins').insert({ user_id: data.user.id, granted_by: null });
  if (error) throw new Error(`catalogue-shared fixture: ${error.message}`);
  await page.reload();
}

async function seedAlignedSet(suffix: string): Promise<string> {
  const service = createServiceRoleClient(loadEnv());
  const mapId = randomUUID();
  const itemId = randomUUID();
  const capabilityId = randomUUID();
  const version = 900000 + Number.parseInt(suffix.slice(0, 5), 16) % 90000;
  const name = `Shared ledger ${suffix}`;
  const checked = (result: { error: { message: string } | null }) => { if (result.error) throw new Error(`catalogue-shared seed: ${result.error.message}`); };
  checked(await service.from('capability_maps').insert({ id: mapId, sector: 'any_organisation', version, status: 'draft', title: 'Shared test set', summary: 'Shared test set', source_description: 'Playwright seed.' }));
  checked(await service.from('capability_map_items').insert({ id: itemId, map_id: mapId, code: '1', parent_code: null, name, description: `${name} definition.`, level: 1, item_order: 10 }));
  checked(await service.from('capability_maps').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', mapId));
  checked(await service.from('reference_capabilities').insert({ id: capabilityId, stable_key: `shared-ledger-${suffix}` }));
  checked(await service.from('reference_capability_revisions').insert({ capability_id: capabilityId, revision: 1, name, definition: `${name} definition.`, status: 'published', published_at: new Date().toISOString() }));
  checked(await service.from('reference_map_item_links').insert({ map_item_id: itemId, capability_id: capabilityId, capability_revision: 1, review_basis: 'Playwright seed alignment.', mapped_by: '00000000-0000-0000-0000-000000000000' }));
  return name;
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`an admin links a product once to a shared capability at ${String(viewport.width)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signUpAdmin(page);
    const suffix = randomUUID().slice(0, 8);
    const name = await seedAlignedSet(suffix);

    await page.goto('/platform-admin/catalogue/products/new');
    await page.getByLabel('Product', { exact: true }).fill(`Shared test ${suffix}`);
    await page.getByLabel('Vendor').fill('Shared test vendor');
    await page.getByLabel('Stable code').fill(`shared-test-${suffix}`);
    await page.getByLabel('Summary').fill('A product used to check shared capability links.');
    await page.getByRole('button', { name: 'Add claim' }).click();
    await page.getByLabel('Source URL').fill('https://example.test/shared');
    await page.getByLabel('Statement').fill('The vendor describes this product as a test ledger.');

    // One shared link, in plain words, covering every sector.
    await expect(page.getByRole('heading', { name: 'Shared capability (every sector)' })).toBeVisible();
    await page.getByTestId('shared-capability-select').selectOption({ label: `${name} (1)` });
    await page.getByLabel('How it supports it').first().fill('Runs the ledger');
    await page.getByRole('button', { name: 'Add shared link' }).click();
    await expect(page.getByTestId('shared-link')).toContainText(name);
    await expect(page.getByTestId('shared-link')).toContainText('every sector');

    // The chosen capability is no longer offered a second time.
    await expect(page.getByTestId('shared-capability-select').locator('option', { hasText: name })).toHaveCount(0);

    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByText(/Product saved/)).toBeVisible();
    // The link is still there after the save reloads the product.
    await expect(page.getByTestId('shared-link')).toContainText(name);
    await page.screenshot({ path: `test-results/catalogue-shared-${String(viewport.width)}.png`, fullPage: true });
  });
}

/** A saved claim is collapsed; open it if it is not already. */
async function openClaim(page: Page): Promise<void> {
  const details = page.locator('details').first();
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) await details.locator('summary').click();
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`an admin publishes, edits and withdraws a product at ${String(viewport.width)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signUpAdmin(page);
    const suffix = randomUUID().slice(0, 8);
    const name = await seedAlignedSet(suffix);

    await page.goto('/platform-admin/catalogue/products/new');
    await page.getByLabel('Product', { exact: true }).fill(`Publish test ${suffix}`);
    await page.getByLabel('Vendor').fill('Publish test vendor');
    await page.getByLabel('Stable code').fill(`publish-test-${suffix}`);
    await page.getByLabel('Summary').fill('A product used to check publication.');
    await page.getByRole('button', { name: 'Add claim' }).click();
    await page.getByLabel('Source URL').fill('https://example.test/publish');
    await page.getByLabel('Statement').fill('The vendor describes this product as a test ledger.');
    await page.getByTestId('shared-capability-select').selectOption({ label: `${name} (1)` });
    await page.getByLabel('How it supports it').first().fill('Runs the ledger');
    await page.getByRole('button', { name: 'Add shared link' }).click();
    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByText(/Product saved/)).toBeVisible();

    // Not reviewed yet: publishing is blocked and says why.
    await expect(page.getByTestId('publication-status')).toContainText('Not published');
    await expect(page.getByTestId('publish-blocked')).toContainText('waiting for review');
    await expect(page.getByRole('button', { name: 'Publish product' })).toBeDisabled();

    // Review the claim, then publish.
    await openClaim(page);
    await page.getByLabel(/I have checked this claim against its source/).check();
    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByTestId('claim-status')).toContainText('Reviewed by');
    await page.getByRole('button', { name: 'Publish product' }).click();
    await expect(page.getByTestId('publication-status')).toContainText('Published, revision 1, approved by');

    // Editing leaves the published revision as it was.
    await page.getByLabel('Summary').fill('A product used to check publication, edited.');
    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByTestId('publication-status')).toContainText('unpublished changes');

    // Withdraw with a reason.
    await page.getByLabel('Reason for withdrawing').fill('Vendor sold the product');
    await page.getByRole('button', { name: 'Withdraw from users' }).click();
    await expect(page.getByTestId('publication-status')).toContainText('Withdrawn');
    await expect(page.getByTestId('publication-status')).toContainText('Vendor sold the product');
    await page.screenshot({ path: `test-results/catalogue-publish-${String(viewport.width)}.png`, fullPage: true });
  });
}
