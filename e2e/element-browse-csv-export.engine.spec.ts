/**
 * F8 ("export"), narrowed scope — issue #162: "Export CSV" on the browse
 * table's toolbar downloads exactly what's on screen. Seeded directly
 * (deep-link style, `element-browse-filtered.engine.spec.ts`'s own
 * pattern) rather than through `golden-path-custom-attributes.spec.ts`'s
 * click-only custom-attribute flow — that flow currently fails at its own
 * "Define attribute" step on unmodified `main` (confirmed via `git stash`
 * before writing this), a separate, pre-existing bug unrelated to this
 * feature (flagged separately, not fixed here). Once that's fixed, the
 * golden path itself should also cover an export with a custom-attribute
 * column; this spec covers the export mechanism on its own meanwhile.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('Export CSV on the browse table downloads exactly the visible rows and columns', async ({ page }) => {
  const env = loadEnv();

  const email = `browse-csv-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`element-browse-csv-export fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`element-browse-csv-export fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `browse-csv-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Browse CSV Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `browse-csv-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Browse CSV Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const capabilityId = randomUUID();
  const systemId = randomUUID();

  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed one capability and one system',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Asset Management', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Field Sensor Gateway', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding element-browse-csv-export fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/elements`);
  await expect(page.getByRole('heading', { name: 'Elements' })).toBeVisible();
  await expect(page.getByText('Field Sensor Gateway', { exact: true })).toBeVisible();
  await expect(page.getByText('Asset Management', { exact: true })).toBeVisible();

  // Filter to systems only — Asset Management (a capability) must drop out
  // of the export, proving this reflects the current filter, not the
  // whole model.
  await page.getByLabel('Element type').selectOption('system');
  await expect(page.getByText('Asset Management', { exact: true })).toHaveCount(0);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Browse CSV Test Model-export.csv');

  const csvPath = await download.path();
  if (!csvPath) throw new Error('download produced no local file path');
  const csv = (await readFile(csvPath, 'utf8')).replace(/^\uFEFF/, ''); // strip the UTF-8 BOM the exporter writes for Excel's benefit
  // F8's full column set: fixed columns and Parent, the union of every
  // type's core attributes, custom attributes, then Source + Age + Atlas ID
  // (the round-trip columns, 2026-10-08). Asserting the whole ~26-column
  // header would be brittle against schema additions; check the shape
  // instead — fixed columns first, provenance and the id last, the visible
  // row's own name/source/lifecycle/id present, and the filtered-out
  // capability absent.
  const [header = '', dataRow = ''] = csv.split('\r\n');
  expect(header.startsWith('Name,Type,Owner,Parent')).toBe(true);
  expect(header.endsWith('Source,Age,Atlas ID')).toBe(true);
  expect(dataRow).toContain('Field Sensor Gateway');
  expect(dataRow).toContain(systemId);
  expect(dataRow).toContain('active');
  expect(dataRow).toContain('Seed');
  expect(csv).not.toContain('Asset Management');
});
