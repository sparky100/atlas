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
  // A real published map gives the admin something to inspect before copying.
  const existing = await service.from('capability_maps').select('id').eq('sector', 'police').eq('status', 'published').limit(1);
  if (existing.error) throw new Error(existing.error.message);
  if (!existing.data.length) {
    const versions = await service.from('capability_maps').select('version').eq('sector', 'police');
    if (versions.error) throw new Error(versions.error.message);
    const mapId = randomUUID();
    const version = Math.max(0, ...versions.data.map((row) => row.version as number)) + 1;
    const insertMap = await service.from('capability_maps').insert({ id: mapId, sector: 'police', version,
      status: 'draft', title: 'Policing capabilities', summary: 'A starting point for police services.', source_description: 'Platform reference content.' });
    if (insertMap.error) throw new Error(insertMap.error.message);
    const insertItem = await service.from('capability_map_items').insert({ id: randomUUID(), map_id: mapId, code: '1',
      parent_code: null, name: 'Respond to incidents', description: 'Handle reported incidents.', level: 1, item_order: 10 });
    if (insertItem.error) throw new Error(insertItem.error.message);
    const publishMap = await service.from('capability_maps').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', mapId);
    if (publishMap.error) throw new Error(publishMap.error.message);
  }
  await page.reload();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('link', { name: 'Platform admin' }).click();
  await expect(page.getByRole('heading', { name: 'Platform admin' })).toBeVisible();
  await page.getByRole('link', { name: 'Capability sets' }).click();
  await expect(page.getByRole('heading', { name: 'Capability sets', exact: true })).toBeVisible();
  const list = page.getByTestId('capability-sets-admin');
  await list.getByLabel('Sector').selectOption('police');
  await list.getByRole('button', { name: 'View current set' }).click();
  await expect(page).toHaveURL(/\/platform-admin\/capability-sets\/versions\//);
  await expect(page.getByTestId('capability-set-version')).toBeVisible();
  const preview = page.getByRole('region', { name: 'Capability set contents' });
  const capability = preview.getByRole('group', { name: 'Capabilities in this set' }).getByRole('button').first();
  await capability.click();
  await expect(preview.getByText(/Top level|Under /)).toBeVisible();
  await preview.getByText(/Value streams \(/).click();
  await preview.getByText(/Sources \(/).click();
  await page.getByRole('link', { name: /← Capability sets/ }).click();
  await expect(page.getByRole('heading', { name: 'Capability sets', exact: true })).toBeVisible();
  const listAgain = page.getByTestId('capability-sets-admin');
  await listAgain.getByLabel('Sector').selectOption('police');
  await listAgain.getByRole('button', { name: /Create v\d+ draft/ }).click();
  await expect(page).toHaveURL(/\/platform-admin\/capability-sets\/drafts\//);
  await expect(page.getByTestId('capability-set-draft')).toBeVisible();
  await page.getByLabel('Find a capability').fill('');
  await page.getByRole('button', { name: /Add capability/ }).click();
  await page.getByLabel('Name', { exact: true }).fill('Connect a new customer');
  await page.getByLabel('Definition').fill('Handle an incoming request.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Draft saved/)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('capability-set-draft')).toBeVisible();
  await page.getByLabel('Find a capability').fill('Connect a new customer');
  await page.getByRole('button', { name: /Connect a new customer/ }).click();
  await page.getByLabel('Search existing capability').fill('Connect a new customer');
  await page.getByRole('button', { name: 'Search identities' }).click();
  await page.getByLabel('Reason for this identity choice').fill('A distinct customer connection capability for this map.');
  await page.getByText('Create a distinct capability').click();
  await page.getByLabel('Stable key').fill(`customer-connection-${randomUUID().slice(0, 8)}`);
  await page.getByLabel('Definition', { exact: true }).last().fill('Accept and manage a request from a new customer.');
  await page.getByRole('button', { name: 'Use a new identity' }).click();
  await expect(page.getByText(/Reviewed: new identity/)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
