/**
 * Sprint U4-1 B2: the architect door's "Recent commits" activity row shows
 * the author's real display name and a precise relative time ("just
 * now"/"Nm ago"/"Nh ago"/"Yesterday"/a date) rather than the provenance
 * staleness bucket ("< 1mo ago") the rest of this codebase uses for facts.
 * Each row links to the commit's own diff, and the named subjects it
 * touched link to their own pages.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createSupabaseClient } from '../src/db/client';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('architect door: recent commits show a real author, a precise time, a diff link, and a linked subject', async ({ page }) => {
  const env = loadEnv();

  const email = `activity-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`activity fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`activity fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `activity-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Activity Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `activity-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Activity Test Model', slug: modelSlug, createdBy: userId });

  // One real, UI-driven manual commit: create a system from the Landscape's
  // own search-first "Add" (element-creation.spec.ts's own flow) — its
  // title ("Add system Grid Sensor Array") names exactly one subject.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  await page.getByRole('button', { name: 'Add a system' }).click();
  await page.getByPlaceholder('Search or create a system…').fill('Grid Sensor Array');
  await page.getByRole('button', { name: 'Create system "Grid Sensor Array"' }).click();
  await expect(page.getByRole('heading', { name: 'Grid Sensor Array' })).toBeVisible();

  // The org's creator is its owner, so the default door is already
  // architect (architect-door-health-findings.spec.ts's own comment).
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await expect(page.getByRole('heading', { name: 'Recent commits' })).toBeVisible();

  const commitRow = page.locator('li', { hasText: 'Add system Grid Sensor Array' });
  await expect(commitRow).toBeVisible();

  // A real author display, not the bare (uuid) author id the row would
  // otherwise fall back to.
  await expect(commitRow.getByText(userId, { exact: true })).toHaveCount(0);

  // A precise relative time, not the provenance staleness bucket ("< 1mo
  // ago") — this commit just landed, so "just now" or "Nm ago".
  await expect(commitRow.getByText(/^(just now|\d+m ago)$/)).toBeVisible();
  await expect(commitRow.getByText('< 1mo ago')).toHaveCount(0);

  // The named subject links to its own element page — `exact: true` since
  // the row's own title link ("Add system Grid Sensor Array") would
  // otherwise substring-match too.
  await commitRow.getByRole('link', { name: 'Grid Sensor Array', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Grid Sensor Array' })).toBeVisible();

  // The row's own title links to the commit's diff, showing exactly this
  // one system as Added.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await page.locator('li', { hasText: 'Add system Grid Sensor Array' }).getByRole('link', { name: 'Add system Grid Sensor Array' }).click();
  await expect(page.getByRole('heading', { name: /^Diff:/ })).toBeVisible();
  // Scoped to this element's own row, not DiffLegend's — the legend shows
  // every state's own badge (including "Added") regardless of what
  // actually changed.
  const elementRow = page.locator('li', { hasText: 'Grid Sensor Array' });
  await expect(elementRow.getByText('Added')).toBeVisible();
});
