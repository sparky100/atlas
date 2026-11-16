/**
 * Prompt 7h bug B6: "Empty states never use developer wording:
 * 'Decisions aren't built yet — see Sprint D1' becomes 'No decisions
 * recorded'; grep for 'Sprint' and 'not built' in user-facing strings."
 *
 * The element page's own "Decisions" section (`ElementPage.tsx`) was the
 * one place this actually happened — every other `<EmptyState>` in the app
 * already used plain, user-facing copy (checked directly against the
 * source, not just this one page). Decisions themselves are still a
 * genuinely absent feature (CLAUDE.md rule 7: absent, not faked) — this
 * only checks the wording, not that the feature exists.
 *
 * Same "needs a real Supabase" limitation as every Playwright test in this
 * repo (playwright.config.ts's own module comment).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('element page: with no decisions the Decisions section is hidden, and nothing mentions a Sprint', async ({ page }) => {
  const env = loadEnv();

  const email = `decisions-empty-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`decisions-empty fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`decisions-empty fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `decisions-empty-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Decisions Empty State Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `decisions-empty-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Decisions Empty State Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const systemId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Billing Service', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: genesisCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed a system', body: null, deltas };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding decisions-empty fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}?ref=main`);
  await expect(page.getByRole('heading', { name: 'Billing Service' })).toBeVisible();

  // Nothing to show, so no empty box either.
  await expect(page.getByRole('button', { name: 'Decisions' })).toHaveCount(0);
  await expect(page.getByText('No decisions recorded')).toHaveCount(0);
  await expect(page.getByText('Sprint', { exact: false })).toHaveCount(0);
  await expect(page.getByText("aren't built", { exact: false })).toHaveCount(0);
});
