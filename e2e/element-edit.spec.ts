/**
 * Sprint U1 step 5's core user path (CLAUDE.md's sprint DoD: "Playwright
 * smoke passes... core user path the sprint touched"): an owner edits an
 * attribute on `main` (UI-principles §4.2) and sees the new value, with a
 * fresh provenance badge, after saving.
 *
 * Same "needs a real Supabase" limitation as every Playwright test in this
 * repo (playwright.config.ts's module comment) — seeds its one System via
 * the real `commitToBranch`/`commit_deltas` path from Node, not through the
 * UI (there's no "create a system" flow yet — Sprint U1 only builds editing
 * an element already on the page), then drives the actual edit through the
 * browser.
 *
 * `commit_deltas` cannot create a model's genesis commit at all (its
 * branch/depth lookup requires a real existing base commit — see
 * supabase/migrations/20260906120000_seed_from_map.sql's own comment on why
 * that function is separate), and `atlas.seed_from_map` — the one thing
 * that *can* — is capability-map-specific (Sprint U2 §5.1), not a generic
 * "first commit is anything" mechanism. A System-only model like this one
 * has no product path to a first commit yet, so this fixture bootstraps
 * its genesis commit as service_role, same as
 * e2e/fixtures/landscapeFixture.ts's sibling spec and
 * src/db/repository.integration.test.ts's beforeAll did before
 * seed_from_map existed for the capability-map case.
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

test('an owner edits a System attribute on main and sees the new value with its own provenance badge', async ({ page }) => {
  const env = loadEnv();

  const email = `edit-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  // Real sign-up through the UI (not admin.createUser as a shortcut) — this
  // is also the only place this test proves the owner role a fresh org's
  // creator gets is actually enough to reach `Edit` at all.
  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  // Node-side setup from here: create the org/model and seed one System
  // through the real repository layer, signed in as the same user.
  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`edit fixture sign-in: ${signInError.message}`);

  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`edit fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `edit-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Edit Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `edit-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Edit Test Model', slug: modelSlug, createdBy: userId });

  // main is never empty (ADR-018): createModel's insert already gave it a
  // genesis commit via atlas.on_model_created, so this fixture's first
  // real edit just commits on top of that head like any other edit.
  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const systemId = randomUUID();
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    message: 'seed Billing Service',
    deltas: [
      {
        kind: 'element.create',
        id: randomUUID(),
        elementId: systemId,
        elementType: 'system',
        name: 'Billing Service',
        parentId: null,
        attributes: { lifecycleStatus: 'active', isExternal: false },
        sourceId: seedSourceId,
        confidence: 1,
      },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding Billing Service: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await expect(page.getByRole('heading', { name: 'Billing Service' })).toBeVisible();

  // Vendor was never set at creation, so there is nothing to see yet — the
  // real assertion is that it appears after the edit below.
  await expect(page.getByText('Acme Corp')).toHaveCount(0);

  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Vendor').fill('Acme Corp');
  await page.getByRole('button', { name: 'Save' }).click();

  // Save exits edit mode and reloads via useElementPage's real reload —
  // the read-only Vendor row shows the new value with its own provenance
  // badge (AttributeRow only renders one when a `facts` row exists), not a
  // value patched into local state by hand.
  await expect(page.getByRole('button', { name: '✎ Edit' })).toBeVisible();
  // .first(): the value's accessible text duplicates (the attribute row
  // plus its provenance badge) — this checks the new value shows up at all.
  await expect(page.getByText('Acme Corp').first()).toBeVisible();

  // Surviving an unrelated full reload proves it round-tripped through
  // Supabase, not just React state left over from the save.
  await page.reload();
  // .first(): the value's accessible text duplicates (the attribute row
  // plus its provenance badge) — this checks the new value shows up at all.
  await expect(page.getByText('Acme Corp').first()).toBeVisible();
});
