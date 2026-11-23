/**
 * Platform administrator role (Atlas's first cross-org role —
 * `supabase/migrations/20260917030000_platform_admin.sql`'s own module
 * comment has the full design). Not a golden-path spec: S2's "click-only
 * from Home, no seeding beyond org and user" rule can't be satisfied here
 * by design — the one legitimate way to become a platform admin is a
 * service-role SQL insert (`docs/PLATFORM-ADMIN.md`), so this necessarily
 * seeds admin status via the service role before driving the rest by
 * clicking, the same shape every other `*.engine.spec.ts` in this repo
 * already uses for state reached by non-UI means.
 *
 * Same "needs a real Supabase" limitation as every Playwright spec here —
 * written and reasoned through, not executed in this sandbox (no Docker).
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createServiceRoleClient, createSupabaseClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';

async function signUp(page: Page, prefix: string): Promise<{ email: string; password: string }> {
  const email = `${prefix}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();
  return { email, password };
}

test('a platform admin can view and change LLM proxy settings from the user menu, and it persists', async ({ page }) => {
  const env = loadEnv();
  const service = createServiceRoleClient(env);

  const { email, password } = await signUp(page, 'platform-admin');
  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`platform-admin fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`platform-admin fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const { error: grantError } = await service.from('platform_admins').insert({ user_id: userId, granted_by: null });
  if (grantError) throw new Error(`platform-admin fixture: could not grant admin status: ${grantError.message}`);

  await page.reload();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('link', { name: 'Platform admin' }).click();
  await expect(page.getByRole('heading', { name: 'Platform admin' })).toBeVisible();

  // Organisations and People are the overview's two open-by-default sections;
  // there is no "Expand all" control on this page any more.
  await expect(page.getByRole('heading', { name: /^Organisations/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^People/ })).toBeVisible();
  await page.getByLabel('Search people by email').fill(email);
  await expect(page.getByRole('row', { name: new RegExp(email) })).toBeVisible();
  await page.screenshot({ path: 'test-results/platform-admin-overview.png', fullPage: true });
  await page.getByLabel('Search people by email').fill('');

  await page.getByRole('link', { name: 'LLM proxy' }).click();
  await expect(page.getByRole('heading', { name: 'LLM proxy' })).toBeVisible();
  await page.getByLabel('Model').selectOption('claude-sonnet-5');
  await page.getByLabel(/Rate limit/).fill('42');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('LLM proxy settings saved')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Model')).toHaveValue('claude-sonnet-5');
  await expect(page.getByLabel(/Rate limit/)).toHaveValue('42');

  await page.getByRole('link', { name: 'Products' }).click();
  await expect(page.getByRole('heading', { name: 'Product catalogue' })).toBeVisible();
  await expect(page.getByTestId('catalogue-products-admin')).toBeVisible();

  await page.getByRole('link', { name: 'Sector catalogues' }).click();
  await expect(page.getByRole('heading', { name: 'Sector catalogues' })).toBeVisible();
  await expect(page.getByTestId('catalogue-sectors-admin')).toBeVisible();
});

test('a non-admin visiting a platform-admin sub-route sees no access, not the settings form', async ({ page }) => {
  await signUp(page, 'platform-admin-non');
  await page.goto('/platform-admin/catalogue');
  await expect(page.getByText("You don't have access to this page.")).toBeVisible();
  await expect(page.getByLabel('Model')).toHaveCount(0);
});
