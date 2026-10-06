/**
 * A module in a project's scope reads "Platform · Module" on the project
 * page, the same convention every other list in the product follows
 * (`src/ui/elements/moduleDisplayName.ts`) — a bare "PM" is ambiguous
 * across platforms. Checked on Declared scope; the two scope-difference
 * lists below it share the same name lookup (`ProjectView.tsx`'s own
 * `elementName`) but only render once the project has a change.
 *
 * Same "needs a real Supabase" limitation as e2e/element-header.engine.spec.ts.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { addProjectLink, createProject } from '../src/db/projects';

test('project page: a module in scope is named "Platform · Module"', async ({ page }) => {
  const env = loadEnv();

  const email = `project-scope-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`project-scope fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`project-scope fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `project-scope-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Project Scope Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `project-scope-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Project Scope Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');

  const sourceId = randomUUID();
  const { error: sourceError } = await signedIn.from('sources').insert({ id: sourceId, org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);

  const platformId = randomUUID();
  const moduleId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: platformId, elementType: 'system', name: 'SAP S/4HANA', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false, kind: 'platform' }, sourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: moduleId, elementType: 'container', name: 'PM', parentId: platformId, attributes: {}, sourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a platform and its module',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seeding project-scope fixture: ${seedResult.message}`);

  const projectId = randomUUID();
  await createProject(signedIn, { id: projectId, orgId, modelId, title: 'Replace plant maintenance', purpose: 'Test', ownerId: userId, createdBy: userId });
  await addProjectLink(signedIn, { projectId, linkedType: 'element', linkedId: moduleId, createdBy: userId });

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/projects/${projectId}`);
  await expect(page.getByRole('heading', { name: 'Replace plant maintenance', level: 1 })).toBeVisible();

  await expect(page.getByRole('link', { name: 'SAP S/4HANA · PM', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove SAP S/4HANA · PM from scope' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'PM', exact: true })).toHaveCount(0);
});
