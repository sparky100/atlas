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

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}`);
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
});
