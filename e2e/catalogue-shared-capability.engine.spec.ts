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
    // Closed by default, with the counts showing; the group opens on demand.
    await expect(page.getByTestId('source-links-counts')).toContainText('Gone');
    await page.getByTestId('source-links-group-gone').locator(':scope > summary').click();
    await expect(flagged).toContainText(goneUrl);
    await expect(flagged).toContainText('The site answered 404.');
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
    // The box follows the saved switch, so it changes after the save, not on the click: click it and wait for the words.
    if (await box.isChecked()) await box.click();
    await expect(section.getByTestId('monthly-check-state')).toContainText(/^Off/);
    await box.click();
    await expect(section.getByTestId('monthly-check-state')).toContainText(/^On: switched on by .+ on /);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
    await page.screenshot({ path: `test-results/catalogue-monthly-check-${String(viewport.width)}.png`, fullPage: true });
    await box.click();
    await expect(section.getByTestId('monthly-check-state')).toContainText(/^Off: switched off by .+ on /);
  });
}

/**
 * Step 6a: Find new products. The function answer is faked (a mocked AI shows nothing about AI quality), but everything after it is real:
 * the library check, saving drafts linked to the capability marked as found by the Researcher, and the run record.
 */
for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`an admin finds products for a capability and they arrive as drafts at ${String(viewport.width)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const service = createServiceRoleClient(loadEnv());
    const suffix = randomUUID().slice(0, 8);
    const capabilityName = `Find test capability ${suffix}`;
    const zero = '00000000-0000-0000-0000-000000000000';
    const mapId = randomUUID();
    const checked = (result: { error: { message: string } | null }) => { if (result.error) throw new Error(`find-products seed: ${result.error.message}`); };
    checked(await service.from('capability_maps').insert({ id: mapId, sector: 'utility', version: 700000 + (Number.parseInt(suffix.slice(0, 5), 16) % 90000), status: 'draft', title: `Find test set ${suffix}`, summary: 'Find test set', source_description: 'Playwright seed.' }));
    checked(await service.from('capability_map_items').insert({ id: randomUUID(), map_id: mapId, code: '1', parent_code: null, name: capabilityName, description: `${capabilityName} definition.`, level: 1, item_order: 10 }));
    checked(await service.from('capability_maps').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', mapId));
    checked(await service.from('catalogue_products').insert({ code: `known-${suffix}`, product: `Known product ${suffix}`, vendor: 'Known vendor', summary: 'Already here.', created_by: zero, updated_by: zero }));

    let requestBody = '';
    await page.route('**/functions/v1/catalogue-find-products', async (route) => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 200, headers: cors, body: 'ok' }); return; }
      requestBody = route.request().postData() ?? '';
      const claim = (sentence: string) => [{ kind: 'functional', sourceUrl: 'https://example.test/found', statement: sentence }];
      await route.fulfill({
        status: 200, headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({
          status: 'ok', searches: 3, inputTokens: 4000, outputTokens: 600, model: 'test-model', note: null,
          found: [
            { product: `New product ${suffix}`, vendor: 'New vendor', summary: 'A product found for the test.', howItSupports: 'It supports the capability.', claims: claim(`New vendor says its product supports ${suffix}.`) },
            { product: `known PRODUCT ${suffix}`, vendor: 'known vendor', summary: 'Already here.', howItSupports: 'Supports it.', claims: claim('Known vendor says its product is here.') },
          ],
          dropped: [{ product: 'Made up', vendor: 'Nobody', reason: 'No sentence from the vendor’s page backed this.' }],
        }),
      });
    });

    await signUpAdmin(page);
    await page.goto('/platform-admin/catalogue/review');
    const section = page.getByTestId('find-products');
    await expect(section.getByRole('heading', { name: 'Find new products' })).toBeVisible();
    await expect(section.getByRole('button', { name: 'Find products for this capability' })).toBeDisabled();
    await section.getByLabel('Capability set').selectOption(mapId);
    await section.getByLabel('Search the capabilities').fill(`test capability ${suffix}`);
    await section.getByRole('option', { name: new RegExp(capabilityName) }).click();
    await expect(section.getByTestId('find-products-sends')).toContainText('the capability’s name and definition, the sector, and the word “product”');
    await section.getByRole('button', { name: 'Find products for this capability' }).click();

    const result = section.getByTestId('find-products-result');
    await expect(result).toContainText('2 products found, 1 already in the library, 1 added for review. 1 dropped.');
    await expect(result).toContainText(`New product ${suffix}`);
    await expect(result).toContainText('found by the Researcher');
    await expect(result).toContainText('No sentence from the vendor’s page backed this.');
    await expect(result.getByRole('link', { name: `Known product ${suffix}` })).toBeVisible();
    // Only the capability, the sector and the word "product" were sent; no organisation data exists here.
    expect(JSON.parse(requestBody)).toEqual({ capabilityName, capabilityDefinition: `${capabilityName} definition.`, sector: 'utility' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
    await page.screenshot({ path: `test-results/catalogue-find-products-${String(viewport.width)}.png`, fullPage: true });

    // The new product is a draft in the queue, marked as found by the Researcher, and the run is in the history.
    await expect(page.getByTestId('check-runs')).toContainText('Find products: 3 searches, 1 product found');
    await expect(page.getByTestId('catalogue-review-queue')).toContainText(`New product ${suffix}`);
    await expect(page.getByTestId('catalogue-review-queue')).toContainText('Found by the Researcher');
    await result.getByRole('link', { name: `New product ${suffix}` }).click();
    await expect(page.getByLabel('Product', { exact: true })).toHaveValue(`New product ${suffix}`);
  });
}

/**
 * Find components of a platform. The function answer is faked (a mocked AI shows nothing about AI quality); the library check,
 * saving components as drafts under the platform with no capability links, and the run record are real.
 */
for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`an admin finds the components of a platform and they arrive as drafts under it at ${String(viewport.width)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const service = createServiceRoleClient(loadEnv());
    const tag = randomUUID().replace(/[^a-f]/g, '').padEnd(6, 'q').slice(0, 6) + (viewport.width === 1280 ? 'big' : 'small');
    const vendor = `Compvend ${tag}`;
    const platformName = `Compplat ${tag}`;
    const zero = '00000000-0000-0000-0000-000000000000';
    const inserted: { data: { id: string } | null; error: { message: string } | null } = await service.from('catalogue_products').insert({ code: `compplat-${tag.toLowerCase()}`, product: platformName, vendor, summary: 'A platform.', created_by: zero, updated_by: zero }).select('id').single();
    if (inserted.error || !inserted.data) throw new Error(`components seed: ${inserted.error?.message ?? 'no row'}`);
    const platformId = inserted.data.id;

    let requestBody = '';
    await page.route('**/functions/v1/catalogue-find-products', async (route) => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 200, headers: cors, body: 'ok' }); return; }
      requestBody = route.request().postData() ?? '';
      const claim = (sentence: string) => [{ kind: 'functional', sourceUrl: 'https://example.test/modules', statement: sentence }];
      await route.fulfill({
        status: 200, headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({
          status: 'ok', searches: 2, inputTokens: 3000, outputTokens: 500, model: 'test-model', note: null,
          found: [
            { product: `${platformName} Alpha`, vendor, summary: 'A module.', howItSupports: 'Does the first thing.', platform: platformName, claims: claim(`${vendor} lists Alpha as a module of ${platformName}.`) },
            { product: `${platformName} Beta`, vendor, summary: 'Another module.', howItSupports: 'Does the second thing.', platform: platformName, claims: claim(`${vendor} lists Beta as a module of ${platformName}.`) },
          ],
          dropped: [{ product: 'Made up', vendor: 'Nobody', reason: 'The cited page does not name the platform.' }],
        }),
      });
    });

    await signUpAdmin(page);
    await page.goto(`/platform-admin/catalogue/products/${platformId}`);
    const section = page.getByTestId('find-components');
    await expect(section.getByRole('button', { name: `Find components of ${platformName}` })).toBeEnabled();
    await section.getByRole('button', { name: `Find components of ${platformName}` }).click();
    const outcome = section.getByTestId('find-components-outcome');
    await expect(outcome).toContainText('2 modules found, 0 already in the library, 2 added as drafts. 1 dropped');
    await expect(outcome).toContainText('no capability links yet');
    expect(JSON.parse(requestBody)).toEqual({ platformName, vendor });
    // The platform page now lists its components, and the new drafts wait for review.
    await expect(page.getByTestId('product-components')).toContainText(`${platformName} Alpha`);
    await expect(page.getByTestId('product-components')).toContainText(`${platformName} Beta`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
    await page.screenshot({ path: `test-results/catalogue-find-components-${String(viewport.width)}.png`, fullPage: true });
    await outcome.getByRole('link', { name: `${platformName} Alpha` }).click();
    await expect(page.getByTestId('part-of-note')).toContainText(platformName);
  });
}

test('finding products says so in words when web search is not switched on', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const service = createServiceRoleClient(loadEnv());
  const suffix = randomUUID().slice(0, 8);
  const capabilityName = `Off test capability ${suffix}`;
  const mapId = randomUUID();
  const checked = (result: { error: { message: string } | null }) => { if (result.error) throw new Error(`find-products seed: ${result.error.message}`); };
  checked(await service.from('capability_maps').insert({ id: mapId, sector: 'utility', version: 800000 + (Number.parseInt(suffix.slice(0, 5), 16) % 90000), status: 'draft', title: `Off test set ${suffix}`, summary: 'Off test set', source_description: 'Playwright seed.' }));
  checked(await service.from('capability_map_items').insert({ id: randomUUID(), map_id: mapId, code: '1', parent_code: null, name: capabilityName, description: 'Definition.', level: 1, item_order: 10 }));
  checked(await service.from('capability_maps').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', mapId));
  await page.route('**/functions/v1/catalogue-find-products', async (route) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 200, headers: cors, body: 'ok' }); return; }
    await route.fulfill({ status: 503, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'error', code: 'web_search_off', message: 'Web search is not switched on for the platform AI account. Nothing was searched.' }) });
  });
  await signUpAdmin(page);
  await page.goto('/platform-admin/catalogue/review');
  const section = page.getByTestId('find-products');
  await section.getByLabel('Capability set').selectOption(mapId);
  await section.getByRole('option', { name: new RegExp(capabilityName) }).click();
  await section.getByRole('button', { name: 'Find products for this capability' }).click();
  await expect(section.getByRole('alert')).toContainText('Web search is not switched on for the platform AI account. Nothing was searched. Nothing was added.');
  await expect(section.getByTestId('find-products-result')).toHaveCount(0);
});

/**
 * Step 6b: Find products for a set. Proposals are computed from real library data (no AI); only the search function's answer is faked.
 * Accepting is a real edit through the guarded save, rejecting is a real record, and the run over capabilities with no product is recorded.
 */
for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`an admin accepts and rejects proposed links and searches a set's gaps at ${String(viewport.width)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const service = createServiceRoleClient(loadEnv());
    const seed = randomUUID().slice(0, 8);
    // Letters only (a hex tail like 3cad reads as a currency code), and codes of its own so other runs' links never match.
    const suffix = seed.replace(/[0-9]/g, (digit) => String.fromCharCode(103 + Number(digit)));
    const group = String(Number.parseInt(seed.slice(0, 6), 16) % 9000 + 1000);
    const [gapCode, billingCode, meteringCode] = [`9${group}.1`, `9${group}.2`, `9${group}.3`];
    const zero = '00000000-0000-0000-0000-000000000000';
    const checked = (result: { error: { message: string } | null }) => { if (result.error) throw new Error(`set-products seed: ${result.error.message}`); };
    const base = 500000 + (Number.parseInt(seed.slice(0, 5), 16) % 40000);
    const oldMap = randomUUID();
    const newMap = randomUUID();
    for (const [id, version, title] of [[oldMap, base, `Old set ${suffix}`], [newMap, base + 50000, `New set ${suffix}`]] as const) {
      checked(await service.from('capability_maps').insert({ id, sector: 'utility', version, status: 'draft', title, summary: title, source_description: 'Playwright seed.' }));
    }
    checked(await service.from('capability_map_items').insert([
      { id: randomUUID(), map_id: oldMap, code: billingCode, parent_code: null, name: `Old billing ${suffix}`, description: 'Old.', level: 1, item_order: 10 },
      { id: randomUUID(), map_id: oldMap, code: meteringCode, parent_code: null, name: `Old metering ${suffix}`, description: 'Old.', level: 1, item_order: 20 },
      { id: randomUUID(), map_id: newMap, code: gapCode, parent_code: null, name: `Gap capability ${suffix}`, description: `Gap ${suffix} definition.`, level: 1, item_order: 10 },
      { id: randomUUID(), map_id: newMap, code: billingCode, parent_code: null, name: `New billing ${suffix}`, description: 'New.', level: 1, item_order: 20 },
      { id: randomUUID(), map_id: newMap, code: meteringCode, parent_code: null, name: `New metering ${suffix}`, description: 'New.', level: 1, item_order: 30 },
    ]));
    for (const id of [oldMap, newMap]) checked(await service.from('capability_maps').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', id));
    const seedProduct = async (name: string, code: string, capabilityName: string): Promise<string> => {
      const inserted: { data: { id: string } | null; error: { message: string } | null } = await service.from('catalogue_products').insert({
        code: `${name.toLowerCase()}-${suffix}`, product: `${name} ${suffix}`, vendor: `Vendor ${name} ${suffix}`, summary: 'Seeded for set products.', created_by: zero, updated_by: zero,
      }).select('id').single();
      if (inserted.error || !inserted.data) throw new Error(`set-products seed: ${inserted.error?.message ?? 'no row'}`);
      checked(await service.from('catalogue_product_capabilities').insert({ product_id: inserted.data.id, capability_map_id: oldMap, capability_code: code, capability_name: capabilityName, how_it_supports: 'Supports it.' }));
      return inserted.data.id;
    };
    await seedProduct('Billing', billingCode, `Old billing ${suffix}`);
    await seedProduct('Metering', meteringCode, `Old metering ${suffix}`);

    await page.route('**/functions/v1/catalogue-find-products', async (route) => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 200, headers: cors, body: 'ok' }); return; }
      await route.fulfill({
        status: 200, headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({
          status: 'ok', searches: 2, inputTokens: 3000, outputTokens: 400, model: 'test-model', note: null, dropped: [],
          found: [{ product: `Gap product ${suffix}`, vendor: 'Gap vendor', summary: 'Found for the gap.', howItSupports: 'It supports the gap.', claims: [{ kind: 'functional', sourceUrl: 'https://example.test/gap', statement: `Gap vendor says its product covers ${suffix}.` }] }],
        }),
      });
    });

    await signUpAdmin(page);
    await page.goto('/platform-admin/catalogue/review');
    const section = page.getByTestId('set-products');
    await section.getByLabel('Capability set').selectOption(newMap);
    await expect(section.getByTestId('set-products-counts')).toContainText('3 capabilities, 0 with a product, 3 with none, 2 links proposed');
    const proposals = section.getByTestId('set-products-proposals');
    await expect(proposals).toContainText(`The same code (${billingCode})`);
    await expect(proposals).toContainText(`Old billing ${suffix}`);
    await expect(proposals).toContainText('Proposed by a rule');

    // Accept one: it becomes an edit of the product and leaves the list.
    await proposals.getByRole('checkbox', { name: new RegExp(`New billing ${suffix}`) }).check();
    await proposals.getByRole('button', { name: 'Accept 1 selected' }).click();
    await expect(section.getByRole('status').filter({ hasText: '1 link accepted' })).toBeVisible();
    await expect(section.getByTestId('set-products-counts')).toContainText('1 with a product');
    await expect(proposals).not.toContainText(`New billing ${suffix}`);

    // Reject the other with a reason: it needs the reason, then it never returns.
    await proposals.getByRole('checkbox', { name: new RegExp(`New metering ${suffix}`) }).check();
    await expect(proposals.getByRole('button', { name: 'Reject 1 selected' })).toBeDisabled();
    await proposals.getByLabel('Reason for rejecting').fill('Not the same capability');
    await proposals.getByRole('button', { name: 'Reject 1 selected' }).click();
    await expect(section.getByRole('status').filter({ hasText: '1 link rejected' })).toBeVisible();
    await expect(section.getByTestId('set-products-proposals')).toHaveCount(0);
    await expect(section.getByText('No links to propose.')).toBeVisible();

    // Search the capability with no product: the answer is faked, everything after it is real.
    const gaps = section.getByTestId('set-products-gaps');
    await gaps.getByRole('checkbox', { name: new RegExp(`Gap capability ${suffix}`) }).check();
    await section.getByRole('button', { name: 'Find products for these' }).click();
    const result = section.getByTestId('set-products-result');
    await expect(result).toContainText(`Gap capability ${suffix}: 1 found, 0 already in the library, 1 added for review`);
    await expect(result.getByRole('link', { name: `Gap product ${suffix}` })).toBeVisible();
    await expect(page.getByTestId('check-runs')).toContainText('Find products for a set: 2 searches, 1 product found');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
    await page.screenshot({ path: `test-results/catalogue-set-products-${String(viewport.width)}.png`, fullPage: true });
  });
}

/** Results presentation: a moved link can be pointed at its new address, a gone link kept for now, each recorded with a name; groups are closed until opened. */
for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`an admin acts on moved and gone source links at ${String(viewport.width)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const service = createServiceRoleClient(loadEnv());
    const seed = randomUUID().slice(0, 8);
    const suffix = seed.replace(/[0-9]/g, (digit) => String.fromCharCode(103 + Number(digit)));
    const zero = '00000000-0000-0000-0000-000000000000';
    const checked = (result: { error: { message: string } | null }) => { if (result.error) throw new Error(`link actions seed: ${result.error.message}`); };
    const inserted: { data: { id: string } | null; error: { message: string } | null } = await service.from('catalogue_products').insert({
      code: `link-actions-${suffix}`, product: `Link actions product ${suffix}`, vendor: `Link vendor ${suffix}`, summary: 'Used to act on source links.', created_by: zero, updated_by: zero,
    }).select('id').single();
    if (inserted.error || !inserted.data) throw new Error(`link actions seed: ${inserted.error?.message ?? 'no row'}`);
    const productId = inserted.data.id;
    const movedUrl = `https://example.test/${suffix}/old/page`;
    const newUrl = `https://example.test/${suffix}/new/page`;
    const goneUrl = `https://example.test/gone-${suffix}`;
    checked(await service.from('catalogue_product_claims').insert([
      { product_id: productId, position: 1, kind: 'functional', statement: 'The vendor describes a page that moved.', source_url: movedUrl, source_date: '2026-11-01' },
      { product_id: productId, position: 2, kind: 'deployment', statement: 'The vendor describes a page that has gone.', source_url: goneUrl, source_date: '2026-11-01' },
    ]));
    checked(await service.from('catalogue_source_checks').insert([
      { url: movedUrl, result: 'moved', http_status: 200, final_url: newUrl, checked_by: zero },
      { url: goneUrl, result: 'gone', http_status: 404, checked_by: zero },
    ]));
    // The link checker is faked so the new address is checked as working; every save after it is real.
    await page.route('**/functions/v1/catalogue-link-check', async (route) => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 200, headers: cors, body: 'ok' }); return; }
      const urls = (JSON.parse(route.request().postData() ?? '{}') as { urls?: string[] }).urls ?? [];
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'ok', results: urls.map((url) => ({ url, result: 'works', httpStatus: 200, finalUrl: null, note: null })) }) });
    });

    await signUpAdmin(page);
    await page.goto('/platform-admin/catalogue/review');
    const counts = page.getByTestId('source-links-counts');
    await expect(counts).toContainText('Moved');
    await expect(counts).toContainText('Gone');
    const moved = page.getByTestId('source-links-group-moved');
    await expect(moved.getByText(movedUrl)).toBeHidden();
    await moved.locator(':scope > summary').click();
    const row = moved.getByTestId('source-link-row').filter({ hasText: movedUrl });
    await expect(row).toContainText('(same site)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
    await row.getByRole('button', { name: 'Use the new address', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Pointed 1 product at the new address' })).toBeVisible();
    const claim = await service.from('catalogue_product_claims').select('source_url').eq('product_id', productId).eq('position', 1).single();
    expect((claim.data as { source_url: string }).source_url).toBe(newUrl);
    await expect(page.getByTestId('source-link-row').filter({ hasText: movedUrl })).toHaveCount(0);

    // Keep the gone link for now: it leaves the list, with who and why recorded, and can be brought back.
    const gone = page.getByTestId('source-links-group-gone');
    await gone.locator(':scope > summary').click();
    await gone.getByTestId('source-link-row').filter({ hasText: goneUrl }).getByRole('button', { name: 'Keep for now' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Kept for 30 days' })).toBeVisible();
    await expect(counts).toContainText('1 kept for now');
    const kept = await service.from('catalogue_source_checks').select('hidden_until,hidden_by_name,hidden_reason').eq('url', goneUrl).single();
    const keptRow = kept.data as { hidden_until: string | null; hidden_by_name: string | null; hidden_reason: string | null };
    expect(keptRow.hidden_until).not.toBeNull();
    expect(keptRow.hidden_by_name).toBeTruthy();
    await page.getByLabel('Show kept links').check();
    const goneGroup = page.getByTestId('source-links-group-gone');
    await expect(goneGroup).toBeAttached();
    if (!(await goneGroup.evaluate((element) => (element as HTMLDetailsElement).open))) await goneGroup.locator(':scope > summary').click();
    await expect(page.getByTestId('source-link-row').filter({ hasText: goneUrl })).toContainText('Kept until');
    await page.getByTestId('source-link-row').filter({ hasText: goneUrl }).getByRole('button', { name: 'Bring back' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Brought back into the list' })).toBeVisible();
    await page.screenshot({ path: `test-results/catalogue-link-actions-${String(viewport.width)}.png`, fullPage: true });
  });
}

/** Results presentation: the same product under two names is listed as a possible duplicate, merged into the one a person keeps, recorded, and the merge can be undone. */
for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`an admin merges a duplicate product and undoes it at ${String(viewport.width)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const service = createServiceRoleClient(loadEnv());
    const suffix = randomUUID().slice(0, 8).replace(/[0-9]/g, (digit) => String.fromCharCode(103 + Number(digit)));
    const zero = '00000000-0000-0000-0000-000000000000';
    const checked = (result: { error: { message: string } | null }) => { if (result.error) throw new Error(`duplicates seed: ${result.error.message}`); };
    const make = async (code: string, product: string): Promise<string> => {
      const made: { data: { id: string } | null; error: { message: string } | null } = await service.from('catalogue_products').insert({
        code: `${code}-${suffix}`, product, vendor: `Dupvendor ${suffix}`, summary: 'Used to merge duplicates.', created_by: zero, updated_by: zero,
      }).select('id').single();
      if (made.error || !made.data) throw new Error(`duplicates seed: ${made.error?.message ?? 'no row'}`);
      return made.data.id;
    };
    const keptId = await make('dup-kept', `Network manager ${suffix}`);
    const mergedId = await make('dup-merged', `Dupvendor ${suffix} Network manager ${suffix}`);
    checked(await service.from('catalogue_product_claims').insert({ product_id: mergedId, position: 1, kind: 'functional', statement: 'The vendor describes the second copy of this product.', source_url: 'https://example.test/second-copy', source_date: '2026-11-01' }));

    await signUpAdmin(page);
    await page.goto('/platform-admin/catalogue/review');
    const duplicates = page.getByTestId('duplicates');
    await duplicates.getByTestId('duplicate-pairs').locator('summary').click();
    const pair = duplicates.getByTestId('duplicate-pair').filter({ hasText: `Dupvendor ${suffix}` });
    await expect(pair).toContainText('The same name once the vendor’s name is left out');
    await pair.getByRole('button', { name: new RegExp(`^Keep Network manager ${suffix}, merge`) }).click();
    await expect(pair).toContainText('can be restored');
    await pair.getByRole('button', { name: 'Merge', exact: true }).click();
    await expect(duplicates.getByRole('status').filter({ hasText: 'Merged.' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);

    const record = await service.from('catalogue_product_merges').select('kept_product_id,merged_by_name').eq('merged_product_id', mergedId).single();
    expect((record.data as { kept_product_id: string; merged_by_name: string | null }).kept_product_id).toBe(keptId);
    expect((record.data as { merged_by_name: string | null }).merged_by_name).toBeTruthy();
    const carried = await service.from('catalogue_product_claims').select('statement').eq('product_id', keptId);
    expect((carried.data as { statement: string }[]).map((claim) => claim.statement)).toEqual(['The vendor describes the second copy of this product.']);

    await duplicates.getByTestId('merged-products').locator('summary').click();
    await duplicates.getByTestId('merged-row').filter({ hasText: `Dupvendor ${suffix}` }).getByRole('button', { name: 'Undo merge' }).click();
    await expect(duplicates.getByRole('status').filter({ hasText: 'is back in the lists' })).toBeVisible();
    const after = await service.from('catalogue_product_merges').select('merged_product_id').eq('merged_product_id', mergedId);
    expect(after.data ?? []).toEqual([]);
    await page.screenshot({ path: `test-results/catalogue-duplicates-${String(viewport.width)}.png`, fullPage: true });
  });
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`an admin names a platform for a product and sees its components at ${String(viewport.width)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const service = createServiceRoleClient(loadEnv());
    const suffix = randomUUID().slice(0, 8).replace(/[0-9]/g, (digit) => String.fromCharCode(103 + Number(digit)));
    const zero = '00000000-0000-0000-0000-000000000000';
    const vendor = `Platvendor ${suffix}`;
    const make = async (code: string, product: string, partOf: string | null): Promise<string> => {
      const made: { data: { id: string } | null; error: { message: string } | null } = await service.from('catalogue_products').insert({
        code: `${code}-${suffix}`, product, vendor, summary: 'Used by the platform test.', part_of_product_id: partOf, created_by: zero, updated_by: zero,
      }).select('id').single();
      if (made.error || !made.data) throw new Error(`platform seed: ${made.error?.message ?? 'no row'}`);
      return made.data.id;
    };
    const platformId = await make('plat', `Gridsuite ${suffix}`, null);
    const knownPart = await make('known', `Gridsuite ${suffix} Network`, platformId);
    const looseId = await make('loose', `Gridsuite ${suffix} Billing`, null);

    await signUpAdmin(page);
    // The platform and its own component are not offered as a possible duplicate; the loose product is.
    await page.goto('/platform-admin/catalogue/review');
    await page.getByTestId('duplicates').getByTestId('duplicate-pairs').locator('summary').click();
    const pairs = page.getByTestId('duplicate-pair').filter({ hasText: vendor });
    await expect(pairs.filter({ hasText: `Gridsuite ${suffix} Billing` })).toHaveCount(1);
    await expect(pairs.filter({ hasText: `Gridsuite ${suffix} Network` })).toHaveCount(0);

    // The product list says which is the platform and which is a component.
    await page.goto('/platform-admin/catalogue');
    await page.getByLabel('Find a product').fill(suffix);
    await expect(page.getByTestId('platform-tag')).toContainText('platform with 1 component');
    await expect(page.getByTestId('component-tag')).toContainText(`part of Gridsuite ${suffix}`);

    // The platform page lists its components and offers no "Part of" choice.
    await page.goto(`/platform-admin/catalogue/products/${platformId}`);
    await expect(page.getByTestId('product-components')).toContainText(`Gridsuite ${suffix} Network`);
    await expect(page.getByTestId('part-of-select')).toHaveCount(0);

    // A loose product is named as a component in the editor, and the choice is saved.
    await page.goto(`/platform-admin/catalogue/products/${looseId}`);
    const select = page.getByTestId('part-of-select');
    await expect(select.locator('option', { hasText: `Gridsuite ${suffix} (${vendor})` })).toHaveCount(1);
    await expect(select.locator('option', { hasText: `Gridsuite ${suffix} Network` })).toHaveCount(0);
    await select.selectOption(platformId);
    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Product saved' })).toBeVisible();
    await expect(page.getByTestId('part-of-note')).toContainText(`Gridsuite ${suffix}`);
    const saved = await service.from('catalogue_products').select('part_of_product_id').eq('id', looseId).single();
    expect((saved.data as { part_of_product_id: string | null }).part_of_product_id).toBe(platformId);
    expect(knownPart).not.toBe(looseId);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
    await page.screenshot({ path: `test-results/catalogue-platform-${String(viewport.width)}.png`, fullPage: true });
  });
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`an admin confirms and turns down suggested platforms at ${String(viewport.width)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const service = createServiceRoleClient(loadEnv());
    const suffix = randomUUID().slice(0, 8).replace(/[0-9]/g, (digit) => String.fromCharCode(103 + Number(digit)));
    const zero = '00000000-0000-0000-0000-000000000000';
    const vendor = `Suggestco ${suffix}`;
    const make = async (code: string, product: string, productVendor: string): Promise<string> => {
      const made: { data: { id: string } | null; error: { message: string } | null } = await service.from('catalogue_products').insert({
        code: `${code}-${suffix}`, product, vendor: productVendor, summary: 'Used by the suggested platforms test.', created_by: zero, updated_by: zero,
      }).select('id').single();
      if (made.error || !made.data) throw new Error(`suggestion seed: ${made.error?.message ?? 'no row'}`);
      return made.data.id;
    };
    const one = await make('s1', `Gridworks ${suffix} Network`, vendor);
    const two = await make('s2', `Gridworks ${suffix} Billing`, vendor);
    const three = await make('s3', `Fieldkit ${suffix} Mobile`, `${vendor} Two`);
    const four = await make('s4', `Fieldkit ${suffix} Tablet`, `${vendor} Two`);

    await signUpAdmin(page);
    await page.goto('/platform-admin/catalogue/review');
    const panel = page.getByTestId('platform-suggestions');
    const list = panel.getByTestId('platform-suggestion-list');
    if (!(await list.evaluate((element) => (element as HTMLDetailsElement).open))) await list.locator(':scope > summary').click();
    const gridworks = panel.getByTestId('platform-suggestion').filter({ hasText: `Gridworks ${suffix}` });
    await expect(gridworks).toContainText('Not in the library yet');
    await gridworks.getByRole('checkbox', { name: `Gridworks ${suffix} Billing` }).uncheck();
    await gridworks.getByRole('button', { name: new RegExp(`^Make 1 selected part of Gridworks ${suffix}`) }).click();
    await expect(panel.getByRole('status').filter({ hasText: 'was added as a draft' })).toBeVisible();
    const platform = await service.from('catalogue_products').select('id,product').eq('vendor', vendor).eq('product', `Gridworks ${suffix}`).single();
    const platformId = (platform.data as { id: string }).id;
    const linked = await service.from('catalogue_products').select('id,part_of_product_id').in('id', [one, two]);
    const byId = new Map((linked.data as { id: string; part_of_product_id: string | null }[]).map((row) => [row.id, row.part_of_product_id]));
    expect(byId.get(one)).toBe(platformId);
    expect(byId.get(two)).toBeNull();

    // The other vendor's pair is turned down, and does not come back.
    const fieldkit = panel.getByTestId('platform-suggestion').filter({ hasText: `Fieldkit ${suffix}` });
    await expect(fieldkit).toHaveCount(1);
    await fieldkit.getByRole('button', { name: 'Not a platform: stop suggesting this' }).click();
    await expect(panel.getByRole('status').filter({ hasText: 'Not suggesting' })).toBeVisible();
    await page.reload();
    const again = page.getByTestId('platform-suggestions');
    await expect(again.getByTestId('platform-suggestion').filter({ hasText: `Gridworks ${suffix}` })).toHaveCount(1);
    await expect(again.getByTestId('platform-suggestion').filter({ hasText: `Fieldkit ${suffix}` })).toHaveCount(0);
    const rejected = await service.from('catalogue_rejected_platform_pairs').select('product_id,rejected_by_name').in('product_id', [three, four]);
    expect((rejected.data as unknown[]).length).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
    await page.screenshot({ path: `test-results/catalogue-platform-suggestions-${String(viewport.width)}.png`, fullPage: true });
  });
}
