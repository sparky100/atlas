/**
 * The platform-admin menu uses the model navigation's own rail (desktop) and
 * bottom bar with a More sheet (phone). Not a golden-path spec: becoming a
 * platform admin is a service-role insert, so this seeds admin status that way
 * and drives the rest by clicking. Uses a fresh sign-up per viewport.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createServiceRoleClient, createSupabaseClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';

async function signUpAdmin(page: Page): Promise<void> {
  const env = loadEnv();
  const service = createServiceRoleClient(env);
  const email = `admin-nav-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();
  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`admin-nav fixture sign-in: ${signInError.message}`);
  const { data, error: userError } = await signedIn.auth.getUser();
  if (userError) throw new Error(`admin-nav fixture: ${userError.message}`);
  const { error } = await service.from('platform_admins').insert({ user_id: data.user.id, granted_by: null });
  if (error) throw new Error(`admin-nav fixture: ${error.message}`);
  await page.reload();
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`the platform admin menu is the app's rail, with a clear active item and a review count at ${String(viewport.width)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const service = createServiceRoleClient(loadEnv());
    const zero = '00000000-0000-0000-0000-000000000000';
    const tag = randomUUID().replace(/[^a-f]/g, '').padEnd(6, 'q').slice(0, 6) + (viewport.width === 1280 ? 'big' : 'small');
    const inserted: { data: { id: string } | null; error: { message: string } | null } = await service.from('catalogue_products')
      .insert({ code: `nav-${tag.toLowerCase()}`, product: `Navprod ${tag}`, vendor: `Navvend ${tag}`, summary: 'Seeded for the menu test.', created_by: zero, updated_by: zero }).select('id').single();
    if (inserted.error || !inserted.data) throw new Error(`admin-nav seed: ${inserted.error?.message ?? 'no row'}`);
    const claim = await service.from('catalogue_product_claims').insert({ product_id: inserted.data.id, position: 1, kind: 'functional', statement: 'The vendor describes it.', source_url: 'https://example.test/nav', source_date: '2026-11-01' });
    if (claim.error) throw new Error(`admin-nav seed: ${claim.error.message}`);

    await signUpAdmin(page);
    await page.goto('/platform-admin');
    const nav = page.getByRole('navigation', { name: 'Platform admin' });
    await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');

    if (viewport.width > 768) {
      // Desktop: every area is on the rail, under captions, and only the current one is marked.
      for (const name of ['Capability sets', 'Products', 'Waiting for review', 'Find and check', 'Sector catalogues', 'Sample models', 'LLM proxy']) {
        await expect(nav.getByRole('link', { name: new RegExp(name) })).toBeVisible();
      }
      await expect(nav.getByText('Product library')).toBeVisible();
      await expect(nav.getByText('History')).toBeVisible();
      await nav.getByRole('link', { name: 'Products' }).click();
      await expect(nav.getByRole('link', { name: 'Products' })).toHaveAttribute('aria-current', 'page');
      await expect(nav.getByRole('link', { name: /Sector catalogues/ })).not.toHaveAttribute('aria-current', 'page');
      await expect(nav.getByRole('link', { name: /Waiting for review/ })).toContainText(/\d+ claims? waiting/);
    } else {
      // Phone: four areas and More on the bar; the rest in the More sheet.
      await expect(nav.getByRole('link', { name: 'Products' })).toBeVisible();
      await expect(nav.getByRole('link', { name: /Waiting for review/ })).toContainText(/\d+ claims? waiting/);
      await expect(nav.getByRole('link', { name: /Find/ })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Capability sets' })).toBeHidden();
      await nav.getByRole('button', { name: /^More/ }).click();
      const sheet = page.getByRole('region', { name: 'More sections' });
      for (const name of ['Capability sets', 'Sector catalogues', 'Sample models', 'LLM proxy']) {
        await expect(sheet.getByRole('link', { name: new RegExp(name) })).toBeVisible();
      }
      await sheet.getByRole('link', { name: /Sector catalogues/ }).click();
      await expect(page.getByRole('heading', { name: 'Sector catalogues' })).toBeVisible();
      await expect(nav.getByRole('button', { name: /^More/ })).toContainText('current: Sector catalogues');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
    await page.screenshot({ path: `test-results/platform-admin-nav-${String(viewport.width)}.png`, fullPage: true });
  });
}
