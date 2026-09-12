/**
 * S1 item 13: "picker cards alphabetical by title" — two published starter
 * maps, seeded Z-title-first, then A-title, must still render A before Z
 * in "Start from a capability map" (CapabilityMapImportPanel.tsx).
 *
 * Same service-role fixture shape as capability-map-seed-description.spec.ts's
 * own comment explains (capability_maps has no `authenticated` write
 * grant) — random, large `version` numbers so this never collides with
 * another parallel test against the same database.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createServiceRoleClient, createSupabaseClient } from '../src/db/client';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('the starter-map picker lists cards alphabetically by title, not by insertion order', async ({ page }) => {
  const env = loadEnv();

  const email = `capmap-picker-alpha-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capmap-picker-alpha fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capmap-picker-alpha fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capmap-picker-alpha-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability Map Picker Alphabetical Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `capmap-picker-alpha-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capability Map Picker Alphabetical Test Model', slug: modelSlug, createdBy: userId });

  const suffix = randomUUID().slice(0, 8);
  const zTitle = `Zzz Picker Test ${suffix}`;
  const aTitle = `Aaa Picker Test ${suffix}`;

  const service = createServiceRoleClient(env);
  const zMapId = randomUUID();
  const aMapId = randomUUID();
  const zVersion = randomInt(1, 1_000_000);
  const aVersion = randomInt(1, 1_000_000);

  // Inserted Z-then-A, and published in that same order — a passthrough
  // of insertion order would list Z first.
  const { error: zMapError } = await service.from('capability_maps').insert({ id: zMapId, sector: 'electricity_network', version: zVersion, status: 'draft', title: zTitle, source_description: 'Picker alphabetical-order e2e fixture (Z).' });
  if (zMapError) throw new Error(`capability_maps fixture (Z): ${zMapError.message}`);
  const { error: aMapError } = await service.from('capability_maps').insert({ id: aMapId, sector: 'electricity_network', version: aVersion, status: 'draft', title: aTitle, source_description: 'Picker alphabetical-order e2e fixture (A).' });
  if (aMapError) throw new Error(`capability_maps fixture (A): ${aMapError.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByRole('heading', { name: 'Start from a capability map' })).toBeVisible();

  const zCard = page.locator('li').filter({ hasText: zTitle });
  const aCard = page.locator('li').filter({ hasText: aTitle });
  await expect(zCard).toBeVisible();
  await expect(aCard).toBeVisible();

  const cardHeadings = page.getByRole('heading', { level: 3 });
  const titleIndex = async (title: string) => {
    const texts = await cardHeadings.allTextContents();
    return texts.indexOf(title);
  };
  await expect(async () => {
    expect(await titleIndex(aTitle)).toBeGreaterThanOrEqual(0);
    expect(await titleIndex(zTitle)).toBeGreaterThan(await titleIndex(aTitle));
  }).toPass();
});
