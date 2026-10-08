/**
 * ADR-024's "Amended — change impact", end to end on the change page: a
 * change that only adds an integration (ESCOMS uses GIS) counts its
 * consuming side's capabilities, not the provider's, and — being in a
 * project — shows the one in the project's declared scope (Wayleaves) with
 * why, collapsing the rest ESCOMS supports (Asset records).
 *
 * Same "needs a real Supabase" limitation as e2e/element-header.engine.spec.ts.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { createChangeBranch, getMainBranch } from '../src/db/branches';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { addProjectLink, createProject, setChangeProject } from '../src/db/projects';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('change page: an integration-only change shows the consumer\'s in-scope capability, with the rest collapsed', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'changeimpact', 'ESCOMS');
  const { signedIn, userId, orgId, orgSlug, modelId, modelSlug, seedSourceId, systemId: escomsId, seedCommitId } = fixture;

  const gisId = randomUUID();
  const wayleavesId = randomUUID();
  const recordsId = randomUUID();
  const mappingId = randomUUID();
  const seed = (elementId: string, elementType: 'system' | 'capability', name: string): Delta =>
    elementType === 'system'
      ? { kind: 'element.create', id: randomUUID(), elementId, elementType, name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 }
      : { kind: 'element.create', id: randomUUID(), elementId, elementType, name, parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 };
  const supports = (from: string, to: string): Delta => ({ kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: from, toElementId: to, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 });
  const mainEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: fixture.main.id,
    parentCommitId: seedCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed GIS and capabilities',
    body: null,
    deltas: [
      seed(gisId, 'system', 'GIS'),
      seed(wayleavesId, 'capability', 'Wayleaves'),
      seed(recordsId, 'capability', 'Asset records'),
      seed(mappingId, 'capability', 'Network mapping'),
      supports(escomsId, wayleavesId),
      supports(escomsId, recordsId),
      supports(gisId, mappingId),
    ],
  };
  const mainResult = await commitToBranch(signedIn, { modelId, branchId: fixture.main.id, expectedHeadCommitId: seedCommitId, envelope: mainEnvelope });
  if (!mainResult.ok) throw new Error(`seeding main: ${mainResult.message}`);
  const main = await getMainBranch(signedIn, modelId);
  if (!main?.head_commit_id) throw new Error('main has no head after seeding');

  const projectId = randomUUID();
  await createProject(signedIn, { id: projectId, orgId, modelId, title: 'Wayleaves', purpose: 'Test', ownerId: userId, createdBy: userId });
  await addProjectLink(signedIn, { projectId, linkedType: 'element', linkedId: wayleavesId, createdBy: userId });
  await addProjectLink(signedIn, { projectId, linkedType: 'element', linkedId: escomsId, createdBy: userId });

  const branchId = randomUUID();
  await createChangeBranch(signedIn, { id: branchId, orgId, modelId, name: 'gis-integration', title: 'Gis integration', createdBy: userId, intent: 'propose', mainHeadCommitId: main.head_commit_id });
  await setChangeProject(signedIn, branchId, projectId);
  const changeEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'ESCOMS uses GIS',
    body: null,
    deltas: [{ kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'uses', fromElementId: escomsId, toElementId: gisId, attributes: {}, sourceId: seedSourceId, confidence: 1 }],
  };
  const changeResult = await commitToBranch(signedIn, { modelId, branchId, expectedHeadCommitId: main.head_commit_id, envelope: changeEnvelope });
  if (!changeResult.ok) throw new Error(`committing the integration: ${changeResult.message}`);

  // A second open change that only adds a relationship at GIS — it shares GIS with the integration (ADR-024 §9).
  const otherBranchId = randomUUID();
  await createChangeBranch(signedIn, { id: otherBranchId, orgId, modelId, name: 'gis-mapping', title: 'GIS mapping support', createdBy: userId, intent: 'propose', mainHeadCommitId: main.head_commit_id });
  const otherResult = await commitToBranch(signedIn, {
    modelId,
    branchId: otherBranchId,
    expectedHeadCommitId: main.head_commit_id,
    envelope: { id: randomUUID(), branchId: otherBranchId, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'GIS supports wayleaves', body: null, deltas: [supports(gisId, wayleavesId)] },
  });
  if (!otherResult.ok) throw new Error(`committing the other change: ${otherResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}`);
  const others = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Other open changes touching the same elements' }) }).last();
  await expect(others.getByText('GIS mapping support')).toBeVisible();
  await expect(others.getByText('Both touch GIS')).toBeVisible();

  const panel = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Affected capabilities' }) }).last();
  await expect(panel.getByRole('link', { name: 'Wayleaves' })).toBeVisible();
  await expect(panel.getByText('integration: ESCOMS uses GIS').first()).toBeVisible();
  await expect(panel.getByText("In this project's declared scope.")).toBeVisible();
  // ESCOMS's other capability is collapsed, and GIS — the provider — reaches nothing.
  await expect(panel.getByRole('link', { name: 'Asset records' })).toHaveCount(0);
  await expect(panel.getByRole('link', { name: 'Network mapping' })).toHaveCount(0);
  const more = panel.getByRole('button', { name: /Also reached, outside the project's scope/ });
  await expect(more).toContainText('(1)');
  await more.click();
  await expect(panel.getByRole('link', { name: 'Asset records' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Network mapping' })).toHaveCount(0);

  // The project page agrees (ADR-024 §5/§9): the integration touches ESCOMS (in scope) and GIS (not), and Wayleaves — in
  // scope, edited by no change — is affected, so nothing in scope reads as untouched.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/projects/${projectId}`);
  await expect(page.getByRole('heading', { name: 'Wayleaves', level: 1 })).toBeVisible();
  const scopeDiff = page.locator('div').filter({ has: page.getByRole('heading', { name: "Touched by this project's changes, not in scope" }) }).last();
  await expect(scopeDiff.getByRole('link', { name: 'GIS' })).toBeVisible();
  await expect(scopeDiff.getByRole('link', { name: 'ESCOMS' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /In scope, not touched/ })).toHaveCount(0);
});

test("change page: an integration from a module counts the module's own supports edge (Salesforce · ESCOMS → Land, Wayleaves & Consents)", async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'changeimpactmodule', 'Salesforce');
  const { signedIn, userId, orgId, orgSlug, modelId, modelSlug, seedSourceId, systemId: salesforceId, seedCommitId } = fixture;

  const escomsId = randomUUID();
  const arcgisId = randomUUID();
  const enterpriseId = randomUUID();
  const wayleavesId = randomUUID();
  const mappingId = randomUUID();
  const create = (elementId: string, elementType: 'system' | 'container' | 'capability', name: string, parentId: string | null): Delta =>
    elementType === 'system'
      ? { kind: 'element.create', id: randomUUID(), elementId, elementType, name, parentId, attributes: { lifecycleStatus: 'active', isExternal: false, kind: 'platform' }, sourceId: seedSourceId, confidence: 1 }
      : elementType === 'container'
        ? { kind: 'element.create', id: randomUUID(), elementId, elementType, name, parentId, attributes: { isExternal: false }, sourceId: seedSourceId, confidence: 1 }
        : { kind: 'element.create', id: randomUUID(), elementId, elementType, name, parentId, attributes: {}, sourceId: seedSourceId, confidence: 1 };
  const supports = (from: string, to: string): Delta => ({ kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: from, toElementId: to, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 });
  const mainResult = await commitToBranch(signedIn, {
    modelId,
    branchId: fixture.main.id,
    expectedHeadCommitId: seedCommitId,
    envelope: {
      id: randomUUID(),
      branchId: fixture.main.id,
      parentCommitId: seedCommitId,
      mergedBranchHeadCommitId: null,
      kind: 'manual',
      title: 'seed modules and capabilities',
      body: null,
      deltas: [
        create(escomsId, 'container', 'ESCOMS', salesforceId),
        create(arcgisId, 'system', 'ArcGIS', null),
        create(enterpriseId, 'container', 'Enterprise', arcgisId),
        create(wayleavesId, 'capability', 'Land, Wayleaves & Consents', null),
        create(mappingId, 'capability', 'Network mapping', null),
        supports(escomsId, wayleavesId),
        supports(enterpriseId, mappingId),
      ],
    },
  });
  if (!mainResult.ok) throw new Error(`seeding main: ${mainResult.message}`);
  const main = await getMainBranch(signedIn, modelId);
  if (!main?.head_commit_id) throw new Error('main has no head after seeding');

  const branchId = randomUUID();
  await createChangeBranch(signedIn, { id: branchId, orgId, modelId, name: 'gis-integration', title: 'Gis integration', createdBy: userId, intent: 'propose', mainHeadCommitId: main.head_commit_id });
  const changeResult = await commitToBranch(signedIn, {
    modelId,
    branchId,
    expectedHeadCommitId: main.head_commit_id,
    envelope: {
      id: randomUUID(),
      branchId,
      parentCommitId: main.head_commit_id,
      mergedBranchHeadCommitId: null,
      kind: 'manual',
      title: 'ESCOMS uses Enterprise',
      body: null,
      deltas: [{ kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'uses', fromElementId: escomsId, toElementId: enterpriseId, attributes: {}, sourceId: seedSourceId, confidence: 1 }],
    },
  });
  if (!changeResult.ok) throw new Error(`committing the integration: ${changeResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}`);
  const panel = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Affected capabilities' }) }).last();
  await expect(panel.getByRole('link', { name: 'Land, Wayleaves & Consents' })).toBeVisible();
  // The fixture's own Salesforce isn't marked kind: platform, so its module reads as plain "ESCOMS" here (moduleDisplayName prefixes a platform's modules only).
  await expect(panel.getByText('integration: ESCOMS uses ArcGIS · Enterprise')).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Network mapping' })).toHaveCount(0);
});

test('change page: a change that only adds an enables edge shows its value stream stage, with why (ADR-023 amendment)', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'changeimpactvs', 'ESCOMS');
  const { signedIn, userId, orgId, orgSlug, modelId, modelSlug, seedSourceId, seedCommitId } = fixture;

  const wayleavesId = randomUUID();
  const streamId = randomUUID();
  const stageId = randomUUID();
  const mainResult = await commitToBranch(signedIn, {
    modelId,
    branchId: fixture.main.id,
    expectedHeadCommitId: seedCommitId,
    envelope: {
      id: randomUUID(),
      branchId: fixture.main.id,
      parentCommitId: seedCommitId,
      mergedBranchHeadCommitId: null,
      kind: 'manual',
      title: 'seed a capability and a value stream',
      body: null,
      deltas: [
        { kind: 'element.create', id: randomUUID(), elementId: wayleavesId, elementType: 'capability', name: 'Wayleaves', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
        { kind: 'element.create', id: randomUUID(), elementId: streamId, elementType: 'value_stream', name: 'Getting Connected', parentId: null, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },
        { kind: 'element.create', id: randomUUID(), elementId: stageId, elementType: 'value_stream', name: 'Survey', parentId: streamId, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },
      ],
    },
  });
  if (!mainResult.ok) throw new Error(`seeding main: ${mainResult.message}`);
  const main = await getMainBranch(signedIn, modelId);
  if (!main?.head_commit_id) throw new Error('main has no head after seeding');

  const branchId = randomUUID();
  await createChangeBranch(signedIn, { id: branchId, orgId, modelId, name: 'wayleaves-survey', title: 'Wayleaves enables Survey', createdBy: userId, intent: 'propose', mainHeadCommitId: main.head_commit_id });
  const changeResult = await commitToBranch(signedIn, {
    modelId,
    branchId,
    expectedHeadCommitId: main.head_commit_id,
    envelope: {
      id: randomUUID(),
      branchId,
      parentCommitId: main.head_commit_id,
      mergedBranchHeadCommitId: null,
      kind: 'manual',
      title: 'Wayleaves enables Survey',
      body: null,
      deltas: [{ kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'enables', fromElementId: wayleavesId, toElementId: stageId, attributes: {}, sourceId: seedSourceId, confidence: 1 }],
    },
  });
  if (!changeResult.ok) throw new Error(`committing the enables edge: ${changeResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}`);
  const panel = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Affected value streams' }) }).last();
  await expect(panel.getByRole('link', { name: 'Getting Connected' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Survey' })).toBeVisible();
  await expect(panel.getByText('Wayleaves now enables it')).toBeVisible();
});
