/**
 * Sprint U4-1 D2: "Template reference. Not a user-facing attribute. Show
 * on the provenance card as 'Seeded from electricity_network v1'; hide
 * from the attributes list."
 *
 * Also covers ADR-020 (Sprint U4-2a check C1): `code`/"Reference" is no
 * longer seed-populated either, so a freshly-seeded capability shows
 * neither "Template reference" (always hidden) nor "Reference" (hidden
 * only while it has no fact — `hideWhenEmpty`). The provenance-card
 * demonstration below now uses Order (always seeded, ADR-020 doesn't
 * touch it) instead of Code, since Code/Reference no longer has a seeded
 * value to hang it on.
 *
 * Same "needs a real Supabase" limitation as every Playwright test in
 * this repo, and the same real-seed-via-the-actual-import-UI fixture
 * shape as e2e/capability-map-seed-description.spec.ts (a random,
 * large `version` so this test never collides with another one running
 * in parallel against the same database).
 */
import { randomInt, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createServiceRoleClient, createSupabaseClient } from '../src/db/client';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('element page: templateRef is hidden from Attributes, and its own "seeded from" fact shows on a seeded attribute\'s provenance card instead', async ({ page }) => {
  const env = loadEnv();

  const email = `template-ref-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`element-template-reference fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`element-template-reference fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `template-ref-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Template Reference Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `template-ref-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Template Reference Test Model', slug: modelSlug, createdBy: userId });

  const service = createServiceRoleClient(env);
  const capabilityMapId = randomUUID();
  const itemId = randomUUID();
  const sector = 'electricity_network';
  const version = randomInt(1, 1_000_000);

  const { error: mapError } = await service.from('capability_maps').insert({ id: capabilityMapId, sector, version, status: 'draft', source_description: 'Sprint U4-1 D2 e2e fixture' });
  if (mapError) throw new Error(`capability_maps fixture: ${mapError.message}`);
  const { error: itemError } = await service.from('capability_map_items').insert({ id: itemId, map_id: capabilityMapId, code: '1', parent_code: null, name: 'Network Operations', level: 1, item_order: 10 });
  if (itemError) throw new Error(`capability_map_items fixture: ${itemError.message}`);
  const { error: publishError } = await service.from('capability_maps').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', capabilityMapId);
  if (publishError) throw new Error(`capability_maps fixture publish: ${publishError.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByRole('heading', { name: 'Start from a capability map' })).toBeVisible();

  const mapRow = page.locator('li').filter({ hasText: `${sector} v${String(version)}` });
  await mapRow.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('heading', { name: 'Start from a capability map' })).toHaveCount(0);
  await expect(page.getByText('Network Operations')).toBeVisible();

  // A top-level capability's header is the domain's expand/collapse button
  // now, not a link — reach its element page through the Elements list.
  await page.getByRole('navigation', { name: 'Model navigation' }).getByRole('link', { name: 'Elements' }).click();
  await page.getByRole('link', { name: /Network Operations$/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Network Operations' })).toBeVisible();

  // Hidden from the attributes list — no "Template reference" row at all,
  // even though templateRef was seeded onto it. ADR-020: "Reference"
  // (attributes.code) is never seed-populated any more either, so it's
  // absent here too (hideWhenEmpty — omitted entirely, not a bare "—").
  await expect(page.getByText('Template reference', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Reference', { exact: true })).toHaveCount(0);

  // Its information still surfaces — reworded — on the provenance card
  // of a fact seeded alongside it (the same template source, per
  // capability-map-seed-description.spec.ts's own comment on this) — here,
  // Order (attributes.order, always set at seed time, ADR-020 doesn't
  // touch it), since Reference/Code no longer carries a seeded value to
  // hang this on.
  const orderValue = page.getByText('Order', { exact: true }).locator('xpath=following-sibling::*[1]');
  await orderValue.locator('button').focus();
  await expect(page.getByText(`Seeded from ${sector} v${String(version)}`)).toBeVisible();
});
