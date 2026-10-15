/**
 * Export XLSX downloads a workbook an import can read back (2026-10-08): a
 * module's sheet names its platform ("Parent system"), every sheet ends in
 * the element's Atlas ID, and the Relationships sheet carries the
 * `supports` edge with its role — the three things a real export lacked,
 * which is why re-importing it created modules with no platform and linked
 * no system to a capability. The importer reading it back is covered by
 * `src/capture/exportRoundTrip.test.ts`; this covers the real download.
 *
 * Same "needs a real Supabase" limitation as e2e/element-header.engine.spec.ts.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import * as XLSX from 'xlsx';
import type { Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('Export XLSX writes each module\'s platform, an Atlas ID on every sheet, and the supports relationships', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'exportroundtrip', 'Salesforce');
  const { signedIn, orgSlug, modelId, modelSlug, seedSourceId, systemId: platformId, seedCommitId } = fixture;

  const moduleId = randomUUID();
  const capabilityId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.update', id: randomUUID(), elementId: platformId, elementType: 'system', attribute: 'kind', value: 'platform', previousDeltaId: fixture.createDeltaId, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: moduleId, elementType: 'container', name: 'ESCOMS', parentId: platformId, attributes: { isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Land, Wayleaves & Consents', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: moduleId, toElementId: capabilityId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
  ];
  const seeded = await commitToBranch(signedIn, {
    modelId,
    branchId: fixture.main.id,
    expectedHeadCommitId: seedCommitId,
    envelope: { id: randomUUID(), branchId: fixture.main.id, parentCommitId: seedCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed a platform, a module and a capability', body: null, deltas },
  });
  if (!seeded.ok) throw new Error(`seeding: ${seeded.message}`);
  const main = await getMainBranch(signedIn, modelId);
  if (!main?.head_commit_id) throw new Error('main has no head after seeding');

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/elements`);
  await expect(page.getByRole('heading', { name: 'Elements' })).toBeVisible();
  // The browse table names a module "Platform · Module".
  await expect(page.getByText('Salesforce · ESCOMS', { exact: true }).first()).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export XLSX' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('download produced no local file path');

  const workbook = XLSX.read(await readFile(path));
  const rows = (sheet: string) => XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheet] ?? {}, { header: 1, defval: '' });

  const containers = rows('Containers');
  const header = containers[0] ?? [];
  expect(header.slice(0, 4)).toEqual(['Name', 'Type', 'Owner', 'Parent system']);
  expect(header[header.length - 1]).toBe('Atlas ID');
  expect(containers[1]?.slice(0, 4)).toEqual(['ESCOMS', 'container', '', 'Salesforce']);
  expect(containers[1]?.[header.length - 1]).toBe(moduleId);

  for (const sheet of ['Capabilities', 'Systems', 'Containers']) {
    const sheetHeader = rows(sheet)[0] ?? [];
    expect(sheetHeader[sheetHeader.length - 1]).toBe('Atlas ID');
  }
  expect(rows('Capabilities')[0]?.[3]).toBe('Parent capability');

  expect(rows('Relationships')).toContainEqual(['ESCOMS', 'supports', 'Land, Wayleaves & Consents', '', 'primary', '', '']);
});
