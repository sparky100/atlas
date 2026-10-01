/**
 * Bug A2 (seed_from_map dropped the starter map's own description): the
 * real end-to-end path — import a published starter map through the actual
 * UI "Import" affordance (CapabilityMapImportPanel), not a hand-built
 * commit — then open the seeded capability and see the map's own
 * description, with its own template provenance badge, not blank.
 *
 * Same "needs a real Supabase" limitation as every Playwright test in this
 * repo (playwright.config.ts's module comment). The published starter map
 * itself is inserted as service_role, standing in for
 * scripts/loadCapabilityMaps.ts/scripts/publishCapabilityMap.ts — the same
 * fixture shape src/db/repository.integration.test.ts's `beforeAll` uses —
 * with a random, large `version` so this test never collides with another
 * one running in parallel against the same database (capability_maps'
 * `unique (sector, version)`).
 */
import { randomInt, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createServiceRoleClient, createSupabaseClient } from '../src/db/client';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('seeding from a starter map carries the map item\'s own description onto the capability, with a template provenance badge', async ({ page }) => {
  const env = loadEnv();

  const email = `seed-desc-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-map-seed-description fixture sign-in: ${signInError.message}`);

  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-map-seed-description fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `seed-desc-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Seed Description Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `seed-desc-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Seed Description Test Model', slug: modelSlug, createdBy: userId });

  // A minimal published starter map, one root capability with a
  // description — inserted as service_role, same draft → items → publish
  // order capability_map_items_guard_immutable requires (see
  // repository.integration.test.ts's own fixture for why).
  const service = createServiceRoleClient(env);
  const capabilityMapId = randomUUID();
  const itemId = randomUUID();
  const sector = 'electricity_network';
  const version = randomInt(1, 1_000_000);
  const description = 'Plans, builds and maintains the physical network that carries electricity to customers.';

  const { error: mapError } = await service.from('capability_maps').insert({ id: capabilityMapId, sector, version, status: 'draft', source_description: 'Bug A2 e2e fixture' });
  if (mapError) throw new Error(`capability_maps fixture: ${mapError.message}`);
  const { error: itemError } = await service.from('capability_map_items').insert({ id: itemId, map_id: capabilityMapId, code: '1', parent_code: null, name: 'Network Operations', description, level: 1, item_order: 10 });
  if (itemError) throw new Error(`capability_map_items fixture: ${itemError.message}`);
  const { error: publishError } = await service.from('capability_maps').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', capabilityMapId);
  if (publishError) throw new Error(`capability_maps fixture publish: ${publishError.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByRole('heading', { name: 'Start from a capability map' })).toBeVisible();

  // Scoped to this test's own row: `fullyParallel` means other tests may
  // have published other starter maps into the same picker.
  const mapRow = page.locator('li').filter({ hasText: `${sector} v${String(version)}` });
  await mapRow.getByRole('button', { name: 'Import' }).click();

  // The import replaces the picker with the real tree — one domain,
  // collapsed by default (capability map redesign) — expand it to reach
  // its own "Open →" link.
  await expect(page.getByRole('heading', { name: 'Start from a capability map' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Network Operations/ })).toBeVisible();
  await page.getByRole('button', { name: /Network Operations/ }).click();

  await page.getByRole('link', { name: /Open Network Operations/ }).click();
  await expect(page.getByRole('heading', { name: 'Network Operations' })).toBeVisible();

  // Bug A2 itself: the map's own description text shows up (it was
  // previously silently dropped at seed time), on the Description row
  // specifically — not just present somewhere on the page (Code is
  // seeded from the same template source too; templateRef itself is
  // hidden from this list entirely — Sprint U4-1 D2,
  // e2e/element-template-reference.spec.ts).
  const descriptionValue = page.getByText('Description', { exact: true }).locator('xpath=following-sibling::*[1]');
  await expect(descriptionValue).toContainText(description);

  // ...with its own template provenance badge (ProvenanceBadge.tsx's
  // compact title, "template, <age> old") — the same template source
  // `atlas.seed_from_map` recorded for every other seeded attribute, not a
  // manual edit standing in for it.
  // The badge's own title (its confidence dots carry a title too).
  const descriptionBadge = descriptionValue.locator('[title^="template"]');
  await expect(descriptionBadge).toHaveAttribute('title', /^template,/);
});
