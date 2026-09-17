/**
 * Sprint U4-1 C5: "'+ Add capability' moves to the page action area;
 * colour-by stays left as a view control." "+ Add capability" is now
 * CapabilityMapPage.tsx's own header action (visible whenever the viewer
 * can edit, even on a completely empty map, since CapabilityMapView.tsx
 * no longer renders a fallback add form of its own).
 *
 * V2b: "Colour by" moved out of CapabilityMapView's own toolbar (gone
 * entirely now) into the shared Inspector's Filters section
 * (CapabilityMapPage.tsx), which only renders alongside real, non-empty
 * map content (`hasContent`, the same condition the toolbar's own
 * existence used to key off) — so this spec's own assertion still holds
 * unchanged: absent on an empty map, visible once the map has content.
 * The Inspector is open by default with nothing selected (no saved
 * `inspector_collapsed` preference in a fresh session), so no extra click
 * is needed to reach it.
 *
 * Same "needs a real Supabase" limitation as e2e/capability-map.spec.ts.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('capability map actions: "+ Add capability" is a page action, available even on an empty map; "Colour by" only appears alongside a real map', async ({ page }) => {
  const env = loadEnv();

  const email = `capmap-actions-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-map-actions fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-map-actions fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capmap-actions-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability Map Actions Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `capmap-actions-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capability Map Actions Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');

  // No seed commit at all — main's own genesis, zero capabilities.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByText('No capabilities yet.')).toBeVisible();

  // The page action is there even though the map itself has nothing to
  // show; the view's own colour-by control isn't, since there's no view
  // content for it to control yet.
  await expect(page.getByRole('button', { name: '+ Add capability' })).toBeVisible();
  await expect(page.getByLabel('Colour by')).toHaveCount(0);

  await page.getByRole('button', { name: '+ Add capability' }).click();
  await page.getByPlaceholder('Capability name').fill('Finance');
  await page.getByRole('button', { name: 'Add' }).click();

  // Once the map has real content, the Inspector (and its Filters
  // section's colour-by control) appears alongside it — a view control,
  // not a page action, so it only exists together with the view it
  // controls.
  await expect(page.getByText('Finance')).toBeVisible();
  await expect(page.getByLabel('Colour by')).toBeVisible();

  // "+ Add capability" is still the page's own header action, not part of
  // the view's toolbar — it stays put regardless of what the map itself
  // now contains.
  await expect(page.getByRole('button', { name: '+ Add capability' })).toBeVisible();
});
