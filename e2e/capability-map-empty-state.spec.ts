/**
 * The capability map's empty state (ADR-018, closing the original request:
 * "add 'Add a capability' that creates the first level-1 capability inline
 * and opens the map with it selected; keep 'seed from a starter map' as
 * the primary action when any map is published"): a brand-new model has a
 * real main branch — its genesis commit, made by atlas.on_model_created —
 * from the instant it's created, so the capability map renders straight
 * into `ready` with an empty tree, never `refNotFound`. Both affordances
 * this sprint added (src/ui/routes/CapabilityMapPage.tsx's own module
 * comment) are visible there: the import panel (CapabilityMapImportPanel)
 * and "Add a capability" (CapabilityMapAddForm, inside CapabilityMapView's
 * own empty-state branch).
 *
 * This test exercises "Add a capability" only — by hand, no starter map
 * touched at all — which is the one path Sprint U2 never had e2e coverage
 * for: e2e/capability-map.spec.ts's fixture seeds its System/Container
 * structure directly through commitToBranch from Node, never through this
 * form.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createSupabaseClient } from '../src/db/client';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('capability map empty state: add one capability by hand, without touching a starter map', async ({ page }) => {
  const env = loadEnv();

  const email = `capmap-empty-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-map-empty-state fixture sign-in: ${signInError.message}`);

  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-map-empty-state fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capmap-empty-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability Map Empty State Test Org', slug: orgSlug, createdBy: userId });

  // No genesis bootstrap of any kind, and no seedModelFromCapabilityMap
  // call — this is the whole point (ADR-018): a fresh model already has a
  // real main branch with nothing on it but its own genesis commit, so
  // the capability map goes straight to `ready` with an empty tree.
  const modelId = randomUUID();
  const modelSlug = `capmap-empty-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capability Map Empty State Test Model', slug: modelSlug, createdBy: userId });

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);

  // The empty state: both affordances render, neither a starter-map import
  // having happened nor an "unresolvable ref" error. CapabilityMapView's own
  // empty-state paragraph and the import panel's intro both mention "no
  // capabilities yet" (deliberately consistent copy), so this checks the
  // heading each affordance owns exclusively, not the shared phrase.
  await expect(page.getByRole('heading', { name: 'Start from a capability map' })).toBeVisible();
  await expect(page.getByText('A capability map has nothing to show until at least one Capability element exists.', { exact: false })).toBeVisible();
  await expect(page.getByText('This model has no commits yet at this ref.')).toHaveCount(0);

  // "Add a capability" — CapabilityMapAddForm's closed-state button —
  // never the import panel's "Import" button next to a starter map row.
  await page.getByRole('button', { name: '+ Add capability' }).click();
  await page.getByPlaceholder('Capability name').fill('Digital Services');
  // Parent picker left at "Top level": this is the model's first, level-1
  // capability, exactly what the original request asked for.
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  // The map now shows it as an L1 column — the empty-state branch is gone,
  // replaced by the real tree — and the starter-map panel (nothing left to
  // seed into) is gone too.
  await expect(page.getByRole('heading', { name: 'Capability map', exact: true })).toBeVisible();
  await expect(page.getByText('Digital Services')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start from a capability map' })).toHaveCount(0);
});
