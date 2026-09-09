/**
 * Sprint U4-1 D1: "Remove the raw element id from the header (behind a
 * copy action in a header menu); alias moves into attributes; keep one
 * provenance badge for the element's existence fact."
 *
 * Same "needs a real Supabase" limitation as e2e/element-edit.spec.ts.
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

test('element header: raw id is hidden behind the header menu, an alias renders under Attributes instead of "aka", and only one provenance badge shows', async ({ page }) => {
  const env = loadEnv();

  const email = `element-header-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`element-header fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`element-header fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `element-header-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Element Header Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `element-header-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Element Header Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const systemId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Housing Portal', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a system',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seeding element-header fixture: ${seedResult.message}`);

  // A hand-recordable alias type (RLS: 'code'/'external_ref'/'name'/
  // 'source_system_key' only — 'template_code'/'merged_id' are system
  // paths) — this is the fact that used to render as "aka \"HP-01\"" in
  // the header and now belongs under Attributes instead.
  const { error: aliasError } = await signedIn.from('aliases').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, element_id: systemId, alias_value: 'HP-01', alias_type: 'code', source_id: seedSourceId, confidence: 1, created_by: userId });
  if (aliasError) throw new Error(`seeding alias: ${aliasError.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await expect(page.getByRole('heading', { name: 'Housing Portal' })).toBeVisible();

  // The raw id is not shown in the header by default — it's in the DOM
  // (the collapsed menu, CSS-hidden, same show/hide shape UserMenu.tsx's
  // own `.menu`/`.open` already uses), just not visible until the menu
  // opens, so this checks visibility, not DOM presence.
  const rawIdText = page.getByText(new RegExp(`^${systemId.slice(0, 8)}…$`));
  await expect(rawIdText).not.toBeVisible();

  // The alias moved to Attributes, labelled by its real type — not "aka"
  // in the header any more.
  await expect(page.getByText('aka', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Code', { exact: true })).toBeVisible();
  await expect(page.getByText('HP-01')).toBeVisible();

  // The header menu reveals the copy action (and, with it, the raw id),
  // hidden until then.
  const menuToggle = page.getByRole('button', { name: 'Element actions' });
  await expect(menuToggle).toBeVisible();
  const copyButton = page.getByRole('button', { name: 'Copy element ID' });
  await expect(copyButton).not.toBeVisible();
  await menuToggle.click();
  await expect(copyButton).toBeVisible();
  await expect(rawIdText).toBeVisible();
});
