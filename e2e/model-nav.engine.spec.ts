/**
 * Persistent model navigation (UI-principles §2.0): every model route
 * reachable from every other within two taps on a mobile viewport, via the
 * bottom nav bar rendered on every model-scoped page. Seeds a minimal
 * model (one capability, one system) through the real `commitToBranch`
 * path from Node (main already has a real genesis commit, ADR-018 — no
 * bootstrap needed), then drives the actual UI through the browser at a
 * mobile viewport size.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('model nav: every model route reachable from every other within two taps on a mobile viewport', async ({ page }) => {
  const env = loadEnv();

  const email = `modelnav-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`model-nav fixture sign-in: ${signInError.message}`);

  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`model-nav fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `modelnav-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Model Nav Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `modelnav-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Model Nav Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const capabilityId = randomUUID();
  const systemId = randomUUID();

  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed one capability, one system',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Billing', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      {
        kind: 'element.create',
        id: randomUUID(),
        elementId: systemId,
        elementType: 'system',
        name: 'Payment Gateway',
        parentId: null,
        attributes: { lifecycleStatus: 'active', isExternal: false },
        sourceId: seedSourceId,
        confidence: 1,
      },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding model-nav fixture: ${seedResult.message}`);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);

  const nav = page.getByRole('navigation', { name: 'Model navigation' });
  await expect(nav).toBeVisible();

  // Home is the current section on landing.
  await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');

  // One tap each reaches every other section, in a chain that visits all
  // seven (prompt pack F3 PR4 added Decisions) — never more than one tap
  // away from the bar since it's rendered on every page.
  await nav.getByRole('link', { name: 'Capability map' }).click();
  await expect(page.getByRole('heading', { name: 'Capability map' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Capability map' })).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('link', { name: 'Landscape' }).click();
  await expect(page.getByRole('heading', { name: /^Landscape/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Landscape' })).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('link', { name: 'Changes' }).click();
  await expect(page.getByRole('heading', { name: 'Changes', level: 1 })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Changes' })).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('link', { name: 'Decisions' }).click();
  await expect(page.getByRole('heading', { name: 'Decisions', level: 1 })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Decisions' })).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('link', { name: 'Versions' }).click();
  await expect(page.getByRole('heading', { name: 'Versions', level: 1 })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Versions' })).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('link', { name: 'Review queue' }).click();
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Review queue' })).toHaveAttribute('aria-current', 'page');

  // Non-adjacent jump — from the review queue straight to the capability
  // map, skipping the sections visited in between — proves the bar isn't
  // just a "next/previous" strip: one tap reaches any section from any
  // other, not just the one it was reached from.
  await nav.getByRole('link', { name: 'Capability map' }).click();
  await expect(page.getByRole('heading', { name: 'Capability map' })).toBeVisible();

  // Back to home, one more tap.
  await nav.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByRole('heading', { name: 'Model Nav Test Model' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');

  // The nav's ref chip travels with it: main here, since nothing switched
  // to a branch or tag.
  await expect(nav.getByText('main', { exact: true })).toBeVisible();

  // An element page — reached from the home door's search, one tap off
  // the nav bar's own Home section, landing on a route the six nav items
  // don't name directly — still carries the same persistent bar, so a
  // second tap reaches any of the six sections from there too.
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('Payment Gateway');
  await page.getByRole('link', { name: /Payment Gateway/ }).click();
  await expect(page.getByRole('heading', { name: 'Payment Gateway' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Model navigation' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Model navigation' }).getByRole('link', { name: 'Versions' }).click();
  await expect(page.getByRole('heading', { name: 'Versions', level: 1 })).toBeVisible();
});

/**
 * V2b: icons + grouping (UI-principles §2.0). Desktop (≥1024px) shows an
 * icon and a visible label per item, grouped under three visible captions
 * (Model/Work/Record); the narrow-desktop tier (768–1023px, the same rail,
 * just narrower — not the mobile bottom bar) drops to icon-only, the label
 * surviving only as the link's own accessible name (`getByRole` still
 * finds it — nothing here depends on the visible text) and as a native
 * `title` tooltip.
 */
test('model nav: icons and groups at desktop width, icon-only with tooltips below 1024px', async ({ page }) => {
  const env = loadEnv();

  const email = `modelnav-icons-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`model-nav-icons fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`model-nav-icons fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `modelnav-icons-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Model Nav Icons Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `modelnav-icons-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Model Nav Icons Test Model', slug: modelSlug, createdBy: userId });

  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  const nav = page.getByRole('navigation', { name: 'Model navigation' });
  await expect(nav).toBeVisible();

  // Desktop (≥1024px): labels visible, groups captioned.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(nav.getByText('Capability map', { exact: true })).toBeVisible();
  await expect(nav.getByText('Landscape', { exact: true })).toBeVisible();
  await expect(nav.getByText('Model', { exact: true })).toBeVisible();
  await expect(nav.getByText('Work', { exact: true })).toBeVisible();
  await expect(nav.getByText('Record', { exact: true })).toBeVisible();

  // Narrow desktop (below 1024px, still the rail — not the <768px bottom
  // bar): icon-only. The label is still in the accessible tree (the same
  // link, found by its accessible name) but no longer visible on screen,
  // and carries a `title` tooltip with the full label instead.
  await page.setViewportSize({ width: 1000, height: 900 });
  const capabilityMapLink = nav.getByRole('link', { name: 'Capability map' });
  await expect(capabilityMapLink).toBeVisible();
  await expect(nav.getByText('Capability map', { exact: true })).not.toBeVisible();
  await expect(capabilityMapLink).toHaveAttribute('title', 'Capability map');

  const landscapeLink = nav.getByRole('link', { name: 'Landscape' });
  await expect(nav.getByText('Landscape', { exact: true })).not.toBeVisible();
  await expect(landscapeLink).toHaveAttribute('title', 'Landscape');

  // The rail is still tall enough at this width for a group caption above
  // each cluster — only the mobile bottom bar drops those (module CSS's
  // own `.groupCaption { display: none }`, scoped to max-width: 768px).
  await expect(nav.getByText('Model', { exact: true })).toBeVisible();

  // Clicking still works with no visible label — the icon (or its
  // stretched link area) is still the real click target.
  await capabilityMapLink.click();
  await expect(page.getByRole('heading', { name: 'Capability map' })).toBeVisible();
});
