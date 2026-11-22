/** Platform-admin exception: assigning the cross-org role requires the
 * existing service-role setup. Everything from Home onwards is click-only.
 * The real database publication and permissions are covered separately.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createServiceRoleClient, createSupabaseClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';
import { signUp } from './fixtures/goldenPath';

test('a platform admin can draft and edit a capability set from Home', async ({ page }) => {
  test.slow();
  const env = loadEnv();
  const { email, password } = await signUp(page, `map-admin-${randomUUID().slice(0, 6)}`);
  const signedIn = createSupabaseClient(env);
  const login = await signedIn.auth.signInWithPassword({ email, password });
  if (login.error) throw new Error(login.error.message);
  const user = await signedIn.auth.getUser();
  if (user.error) throw new Error(user.error.message);
  const service = createServiceRoleClient(env);
  const grant = await service.from('platform_admins').insert({ user_id: user.data.user.id, granted_by: null });
  if (grant.error) throw new Error(grant.error.message);
  await page.reload();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('link', { name: 'Platform admin' }).click();
  await expect(page.getByRole('heading', { name: 'Platform admin' })).toBeVisible();
  const section = page.getByTestId('settings-section-capability-sets');
  await expect(section.getByRole('heading', { name: /Capability sets/ })).toBeVisible();
  await section.getByLabel('Sector').selectOption('police');
  await section.getByRole('button', { name: /Create v\d+ draft/ }).click();
  await expect(section.getByText(/draft created/)).toBeVisible();
  await section.getByLabel('Find a capability').fill('');
  await section.getByRole('button', { name: /Add capability/ }).click();
  await section.getByLabel('Name', { exact: true }).fill('Connect a new customer');
  await section.getByLabel('Definition').fill('Handle an incoming request.');
  await section.getByRole('button', { name: 'Save draft' }).click();
  await expect(section.getByText(/Draft saved/)).toBeVisible();
  await page.reload();
  await section.getByLabel('Capability set drafts').getByRole('button').filter({ hasText: /police/i }).first().click();
  await section.getByLabel('Find a capability').fill('Connect a new customer');
  await section.getByRole('button', { name: /Connect a new customer/ }).click();
  await section.getByLabel('Search existing capability').fill('Connect a new customer');
  await section.getByRole('button', { name: 'Search identities' }).click();
  await section.getByLabel('Reason for this identity choice').fill('A distinct customer connection capability for this map.');
  await section.getByText('Create a distinct capability').click();
  await section.getByLabel('Stable key').fill(`customer-connection-${randomUUID().slice(0, 8)}`);
  await section.getByLabel('Definition', { exact: true }).last().fill('Accept and manage a request from a new customer.');
  await section.getByRole('button', { name: 'Use a new identity' }).click();
  await expect(section.getByText(/Reviewed: new identity/)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
