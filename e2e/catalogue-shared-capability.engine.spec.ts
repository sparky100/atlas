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
  // The editor offers the NEWEST any_organisation set, so each seeded set must be newer than the last: seconds since 1970 only ever grows (and fits an int).
  const version = Math.floor(Date.now() / 1000);
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

/** Step 4b-3: the sector catalogue is read-only history, and withdrawing it is blocked while its products exist nowhere else. */
test('the sector catalogue is read-only history and withdrawing it is blocked until its products are published', async ({ page }) => {
  await signUpAdmin(page);
  await page.goto('/platform-admin/catalogue/sectors');
  await expect(page.getByText('Read-only history').first()).toBeVisible();
  await page.getByRole('link', { name: /electricity network/i }).first().click();
  await expect(page.getByTestId('catalogue-sector-admin')).toBeVisible();
  // No way to start a new sector catalogue.
  await expect(page.getByRole('button', { name: /Create v\d+ draft/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Drafts' })).toHaveCount(0);
  // Electricity v1's products are not published as products here, so withdrawing says why and stays off.
  await expect(page.getByTestId('sector-withdraw-blocked')).toContainText('not yet published');
  await page.getByLabel(/Withdrawal reason/).fill('Replaced by published products');
  await expect(page.getByRole('button', { name: 'Withdraw current version' })).toBeDisabled();
  await page.getByRole('link', { name: 'View current products' }).click();
  await expect(page.getByTestId('catalogue-version-admin')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});

/** Step 5a: a link the last check found gone is listed with the product and claim that cite it, and the product editor says so. */
for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`source links that are not working are listed with their product at ${String(viewport.width)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const service = createServiceRoleClient(loadEnv());
    const suffix = randomUUID().slice(0, 8);
    const productName = `Link check product ${suffix}`;
    const goneUrl = `https://example.test/gone-${suffix}`;
    const worksUrl = `https://example.test/works-${suffix}`;
    const zero = '00000000-0000-0000-0000-000000000000';
    const productResult: { data: { id: string } | null; error: { message: string } | null } = await service.from('catalogue_products').insert({
      code: `link-check-${suffix}`, product: productName, vendor: `Vendor ${suffix}`, summary: 'Used to check source links.', created_by: zero, updated_by: zero,
    }).select('id').single();
    if (productResult.error || !productResult.data) throw new Error(`link-check seed: ${productResult.error?.message ?? 'no row'}`);
    const productId = productResult.data.id;
    const checked = (result: { error: { message: string } | null }) => { if (result.error) throw new Error(`link-check seed: ${result.error.message}`); };
    checked(await service.from('catalogue_product_claims').insert([
      { product_id: productId, position: 1, kind: 'functional', statement: 'The vendor describes a page that has gone.', source_url: goneUrl, source_date: '2026-11-01' },
      { product_id: productId, position: 2, kind: 'deployment', statement: 'The vendor describes a page that works.', source_url: worksUrl, source_date: '2026-11-01' },
    ]));
    checked(await service.from('catalogue_source_checks').insert([
      { url: goneUrl, result: 'gone', http_status: 404, checked_by: zero },
      { url: worksUrl, result: 'works', http_status: 200, checked_by: zero },
    ]));

    await signUpAdmin(page);
    await page.goto('/platform-admin/catalogue/review');
    await expect(page.getByTestId('source-links-summary')).toContainText('links checked');
    await expect(page.getByRole('button', { name: 'Check source links' })).toBeEnabled();
    const flagged = page.getByTestId('source-links-flagged');
    await expect(flagged).toContainText(goneUrl);
    await expect(flagged).toContainText('Gone (404)');
    await expect(flagged).toContainText('The vendor describes a page that has gone.');
    await expect(flagged).not.toContainText(worksUrl);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);

    // The product editor says what was found for each claim's link.
    await flagged.getByRole('link', { name: productName }).first().click();
    await expect(page.getByLabel('Product', { exact: true })).toHaveValue(productName);
    await page.locator('details').first().locator('summary').click();
    await expect(page.getByTestId('claim-link-check').first()).toContainText('Link: Gone (404)');
    await page.screenshot({ path: `test-results/catalogue-source-links-${String(viewport.width)}.png`, fullPage: true });
  });
}

/** Step 5b-1: a claim the AI found changed is listed with the page's own words; a platform admin can mark it as looked at, and the product editor says what was found. */
for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`claims the AI flagged are listed and can be marked as looked at at ${String(viewport.width)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const service = createServiceRoleClient(loadEnv());
    const suffix = randomUUID().slice(0, 8);
    const productName = `Claim check product ${suffix}`;
    const sourceUrl = `https://example.test/claim-${suffix}`;
    const statement = `The vendor says this product supports feature ${suffix}.`;
    const quote = 'This feature was retired in the latest release.';
    const zero = '00000000-0000-0000-0000-000000000000';
    const productResult: { data: { id: string } | null; error: { message: string } | null } = await service.from('catalogue_products').insert({
      code: `claim-check-${suffix}`, product: productName, vendor: `Vendor ${suffix}`, summary: 'Used to check claim checks.', created_by: zero, updated_by: zero,
    }).select('id').single();
    if (productResult.error || !productResult.data) throw new Error(`claim-check seed: ${productResult.error?.message ?? 'no row'}`);
    const productId = productResult.data.id;
    const checked = (result: { error: { message: string } | null }) => { if (result.error) throw new Error(`claim-check seed: ${result.error.message}`); };
    checked(await service.from('catalogue_product_claims').insert({ product_id: productId, position: 1, kind: 'functional', statement, source_url: sourceUrl, source_date: '2026-11-01' }));
    checked(await service.from('catalogue_claim_checks').insert({ product_id: productId, source_url: sourceUrl, statement, verdict: 'changed', quote, note: 'The page now says the feature is gone.', model: 'test-model', input_tokens: 10, output_tokens: 5, checked_by: zero }));

    await signUpAdmin(page);
    await page.goto('/platform-admin/catalogue/review');
    await expect(page.getByTestId('claim-checks-summary')).toBeVisible();
    await expect(page.getByRole('button', { name: /Check claims against their sources/ })).toBeVisible();
    const flagged = page.getByTestId('claim-checks-flagged');
    await expect(flagged).toContainText(statement);
    await expect(flagged.getByTestId('claim-check-quote')).toContainText(quote);
    await expect(flagged).toContainText('Not checked by a person');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);

    // The product editor says what the AI found.
    await flagged.getByRole('link', { name: productName }).first().click();
    await expect(page.getByLabel('Product', { exact: true })).toHaveValue(productName);
    await page.locator('details').first().locator('summary').click();
    await expect(page.getByTestId('claim-ai-check').first()).toContainText('Source check: Changed, checked by the AI');
    await page.screenshot({ path: `test-results/catalogue-claim-checks-${String(viewport.width)}.png`, fullPage: true });

    // A person looks and keeps it: it leaves the list and the editor records who.
    await page.goto('/platform-admin/catalogue/review');
    await page.getByTestId('claim-checks-flagged').getByRole('button', { name: 'I looked: it still stands' }).click();
    await expect(page.getByTestId('claim-checks-flagged')).toHaveCount(0);
    await page.goto(`/platform-admin/catalogue/products/${productId}`);
    await page.locator('details').first().locator('summary').click();
    await expect(page.getByTestId('claim-ai-check').first()).toContainText('Looked at and kept by');
  });
}

/** Step 5b-2: the Monthly check section shows the switch (stamped with who changed it) and the latest runs, monthly and manual. */
for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`the monthly check switch and the run history work at ${String(viewport.width)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const service = createServiceRoleClient(loadEnv());
    const zero = '00000000-0000-0000-0000-000000000000';
    const inserted: { data: { id: string } | null; error: { message: string } | null } = await service.from('catalogue_check_runs').insert({
      kind: 'monthly', scope: 'both', status: 'finished', started_by: zero, started_by_name: 'Monthly check (switched on by Test Admin)', links_checked: 12, claims_checked: 9, flagged: 3, input_tokens: 8000, output_tokens: 400,
    }).select('id').single();
    if (inserted.error) throw new Error(`monthly-check seed: ${inserted.error.message}`);

    await signUpAdmin(page);
    await page.goto('/platform-admin/catalogue/review');
    const section = page.getByTestId('monthly-check');
    await expect(section.getByRole('heading', { name: 'Monthly check' })).toBeVisible();
    await expect(section.getByTestId('check-runs')).toContainText('Monthly check');
    await expect(section.getByTestId('check-runs')).toContainText('3 need a look');
    await expect(section.getByTestId('check-runs')).toContainText('8,400 AI tokens');

    // Switch it on: it says who and when. Switch it off again: that is recorded too.
    const box = section.getByRole('checkbox', { name: /every month/ });
    if (await box.isChecked()) await box.uncheck();
    await expect(section.getByTestId('monthly-check-state')).toContainText(/^Off/);
    await box.check();
    await expect(section.getByTestId('monthly-check-state')).toContainText(/^On: switched on by .+ on /);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
    await page.screenshot({ path: `test-results/catalogue-monthly-check-${String(viewport.width)}.png`, fullPage: true });
    await box.uncheck();
    await expect(section.getByTestId('monthly-check-state')).toContainText(/^Off: switched off by .+ on /);
  });
}
