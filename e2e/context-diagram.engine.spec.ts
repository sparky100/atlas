/**
 * V1 — the context diagram (docs/prompts/atlas-prompt-pack.md). The
 * sprint's own named Playwright scenario, verbatim: "SAP with FI and PM
 * modules and a Salesforce flow to FI renders the flow to the FI tile; an
 * external organisation actor renders outside the boundary."
 *
 * The desktop canvas's own tile/edge drawing is pixels Playwright can't
 * inspect (UI-principles §8.7 — the element page, and here the mobile
 * list, are the accessible view) — same limitation
 * e2e/platforms-and-modules.spec.ts's own module comment already notes for
 * the landscape's platform band. Verified two ways instead: the mobile
 * list (a real DOM group, at <768px) for the actual content, and a
 * `data-scale`/`data-tx`/`data-ty`-bearing canvas wrapper (same
 * `LandscapeCanvas.tsx` convention `ContextDiagramCanvas.tsx` reuses) to
 * confirm the desktop canvas renders at all, without needing to read its
 * pixels.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { getOrCreateManualSource } from '../src/db/sources';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('SAP with FI and PM modules and a Salesforce flow to FI renders the flow to the FI tile; an external organisation actor renders outside the boundary', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'ctxdiagram', 'SAP');
  const { signedIn: owner, orgId, orgSlug, modelId, modelSlug, systemId: sapId, userId: ownerId, main } = fixture;

  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: ownerId });
  const fiId = randomUUID();
  const pmId = randomUUID();
  const financeId = randomUUID();
  const assetManagementId = randomUUID();
  const salesforceId = randomUUID();
  const ofgemId = randomUUID();

  const deltas: Delta[] = [
    { kind: 'element.update', id: randomUUID(), elementId: sapId, elementType: 'system', attribute: 'kind', value: 'platform', previousDeltaId: fixture.createDeltaId, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: fiId, elementType: 'container', name: 'FI', parentId: sapId, attributes: { isExternal: false }, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: pmId, elementType: 'container', name: 'PM', parentId: sapId, attributes: { isExternal: false }, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: financeId, elementType: 'capability', name: 'Finance', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: assetManagementId, elementType: 'capability', name: 'Asset Management', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: fiId, toElementId: financeId, attributes: { role: 'primary' }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: pmId, toElementId: assetManagementId, attributes: { role: 'primary' }, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: salesforceId, elementType: 'system', name: 'Salesforce', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 },
    // The named scenario's own flow: Salesforce flows to FI — the module
    // directly, not SAP itself (S1 item 20's container↔system rules).
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'flows_to', fromElementId: salesforceId, toElementId: fiId, attributes: { description: 'sends billing events to' }, sourceId: source.id, confidence: 1 },
    // The named scenario's own external actor, using SAP directly (not a
    // module) — S1 item 11a's `isExternal`/`externalOrganisation`.
    { kind: 'element.create', id: randomUUID(), elementId: ofgemId, elementType: 'actor', name: 'Ofgem', parentId: null, attributes: { subtype: 'organisation', isExternal: true, externalOrganisation: 'Ofgem' }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'uses', fromElementId: ofgemId, toElementId: sapId, attributes: { description: 'submits RIIO returns to' }, sourceId: source.id, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed SAP as a platform with FI/PM, a Salesforce flow to FI, and an external actor', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seed context-diagram fixture: ${seedResult.message}`);

  // 1. Desktop: the canvas renders (a real <canvas>, with the same
  // transform-exposing wrapper attributes LandscapeCanvas.tsx already
  // uses) and the header's own "Supports:" line is grouped by module —
  // V1's own "Header keeps Supports ... grouped by module for platforms."
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${sapId}`);
  await expect(page.getByRole('heading', { name: 'Context' })).toBeVisible();
  const supportsLine = page.getByText('Supports:', { exact: false });
  await expect(supportsLine).toBeVisible();
  const supportsText = await supportsLine.innerText();
  expect(supportsText).toContain('FI');
  expect(supportsText).toContain('Finance');
  expect(supportsText).toContain('PM');
  expect(supportsText).toContain('Asset Management');
  const canvasWrapper = page.locator('[data-scale]');
  await expect(canvasWrapper).toBeVisible();
  await expect(canvasWrapper).toHaveAttribute('data-scale', /.+/);
  await expect(page.getByRole('img', { name: /Context diagram/ })).toBeVisible();

  // 2. Mobile (<768px): the same content as a list grouped by direction —
  // Salesforce's own flow to FI shows under "Flows in" with the FI module
  // named directly (not just "SAP"), and Ofgem shows under "People",
  // flagged external, with its own verb phrase.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${sapId}`);
  await expect(page.getByRole('link', { name: 'SAP' }).first()).toBeVisible();

  const flowsInGroup = page.getByRole('button', { name: /^Flows in/ });
  await expect(flowsInGroup).toBeVisible();
  await flowsInGroup.click();
  await expect(page.getByText('Salesforce', { exact: true })).toBeVisible();
  await expect(page.getByText('⇢ sends billing events to')).toBeVisible();

  const peopleGroup = page.getByRole('button', { name: /^People/ });
  await expect(peopleGroup).toBeVisible();
  await peopleGroup.click();
  await expect(page.getByText('Ofgem', { exact: true })).toBeVisible();
  await expect(page.getByText('external', { exact: true })).toBeVisible();
  await expect(page.getByText(/submits RIIO returns to/)).toBeVisible();
});

/**
 * V1 fix, "two adjacent-module verb labels never render on top of each
 * other": two neighbours, each flowing to one of two adjacent modules
 * (`MODULE_WIDTH + MODULE_GUTTER_X` = 80px apart, per
 * `contextDiagramLayout.ts`), each with a 25+ character verb — long enough
 * that a naive pill, centred at each edge's own curve midpoint, would
 * overlap the other's before `resolveEdgeLabelOverlaps` ever ran.
 *
 * Desktop pixel-level non-overlap is `contextDiagramLayout.test.ts`'s own
 * job — this exact scenario is one of its 33 unit tests — not this file's:
 * the desktop canvas's own drawing is pixels Playwright can't inspect
 * (this file's own module comment above), so what's left to check here is
 * that both edges genuinely reach the diagram with their full, untruncated
 * verb text intact, not silently dropped or concatenated together, plus
 * the desktop canvas still renders at all.
 */
test('two neighbours connected to adjacent modules with 25+ character verbs render two non-intersecting labels', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'ctxlabels', 'SAP');
  const { signedIn: owner, orgId, orgSlug, modelId, modelSlug, systemId: sapId, userId: ownerId, main } = fixture;

  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: ownerId });
  const fiId = randomUUID();
  const pmId = randomUUID();
  const financeId = randomUUID();
  const assetManagementId = randomUUID();
  const salesforceId = randomUUID();
  const workdayId = randomUUID();

  const salesforceVerb = 'sends billing events across the settlement network to';
  const workdayVerb = 'submits reconciliation and payroll adjustment records to';
  expect(salesforceVerb.length).toBeGreaterThanOrEqual(25);
  expect(workdayVerb.length).toBeGreaterThanOrEqual(25);

  const deltas: Delta[] = [
    { kind: 'element.update', id: randomUUID(), elementId: sapId, elementType: 'system', attribute: 'kind', value: 'platform', previousDeltaId: fixture.createDeltaId, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: fiId, elementType: 'container', name: 'FI', parentId: sapId, attributes: { isExternal: false }, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: pmId, elementType: 'container', name: 'PM', parentId: sapId, attributes: { isExternal: false }, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: financeId, elementType: 'capability', name: 'Finance', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: assetManagementId, elementType: 'capability', name: 'Asset Management', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: fiId, toElementId: financeId, attributes: { role: 'primary' }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: pmId, toElementId: assetManagementId, attributes: { role: 'primary' }, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: salesforceId, elementType: 'system', name: 'Salesforce', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: workdayId, elementType: 'system', name: 'Workday', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 },
    // Two neighbours, each attached to one of two adjacent modules — the
    // exact geometry `contextDiagramLayout.ts`'s own bug-fix comment
    // names: FI and PM sit only `MODULE_WIDTH + MODULE_GUTTER_X` (80px)
    // apart, far closer than either of these long verbs' own pill width.
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'flows_to', fromElementId: salesforceId, toElementId: fiId, attributes: { description: salesforceVerb }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'flows_to', fromElementId: workdayId, toElementId: pmId, attributes: { description: workdayVerb }, sourceId: source.id, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed SAP with two adjacent-module neighbours, each with a 25+ character verb', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seed adjacent-module label fixture: ${seedResult.message}`);

  // Desktop: the canvas renders, unremarkably (its own label placement is
  // pixels Playwright can't inspect — see this file's own module comment,
  // and `contextDiagramLayout.test.ts`'s own unit coverage of this exact
  // scenario for the actual non-overlap guarantee).
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${sapId}`);
  await expect(page.getByRole('heading', { name: 'Context' })).toBeVisible();
  await expect(page.locator('[data-scale]')).toBeVisible();
  await expect(page.getByRole('img', { name: /Context diagram/ })).toBeVisible();

  // Mobile: both edges reached the diagram with their full, untruncated
  // verb intact — not silently dropped, truncated, or concatenated
  // together by whatever placement logic the desktop canvas applies.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${sapId}`);
  const flowsInGroup = page.getByRole('button', { name: /^Flows in/ });
  await expect(flowsInGroup).toBeVisible();
  await flowsInGroup.click();
  await expect(page.getByText('Salesforce', { exact: true })).toBeVisible();
  await expect(page.getByText(`⇢ ${salesforceVerb}`)).toBeVisible();
  await expect(page.getByText('Workday', { exact: true })).toBeVisible();
  await expect(page.getByText(`⇢ ${workdayVerb}`)).toBeVisible();
});
