/**
 * Sprint U4-2c item 1: "Relationship attribute editing, general ... edits
 * are relationship.update on the selected ref ... Supports role promotion
 * demotes the current primary in the same commit ... Playwright: edit a
 * verb on an existing flow and see it on the context view; promote a
 * secondary supports and see the lane change."
 *
 * Two scenarios, two tests: editing a `uses` edge's verb phrase (checked on
 * both the element page's own row and the Context view, `contextGrouping.ts`'s
 * `edgeLabel` — this item's own change to make the Context view show the
 * real verb instead of a fixed "uses"/"flows to" word) and promoting a
 * secondary `supports` edge to primary (checked via the row's own role
 * chips — same-commit auto-demote of the sibling that used to hold it —
 * and, live on the canvas, the tile actually moving lanes, the same
 * "compute the same layout function calls, click where it says the tile
 * should be" technique e2e/landscape-lanes.spec.ts already uses for the
 * identical "Canvas 2D, not DOM" limitation).
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import type { ElementsHeadRow } from '../src/contracts/rows';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';
import { computeLandscapeLayout, NODE_HEIGHT, NODE_WIDTH } from '../src/ui/landscape/layout';

async function signUpAndCreateOrgAndModel(page: Page, namePrefix: string) {
  const env = loadEnv();
  const email = `${namePrefix}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`${namePrefix} fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`${namePrefix} fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `${namePrefix}-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: `${namePrefix} Test Org`, slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `${namePrefix}-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: `${namePrefix} Test Model`, slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  return { signedIn, userId, orgId, orgSlug, modelId, modelSlug, main, genesisCommitId, seedSourceId };
}

test('editing a uses edge\'s verb phrase updates the row on the element page and the label on the context view', async ({ page }) => {
  const { signedIn, orgSlug, modelSlug, main, genesisCommitId, seedSourceId, modelId } = await signUpAndCreateOrgAndModel(page, 'verb-edit');

  const meterReadingId = randomUUID();
  const billingPlatformId = randomUUID();

  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a uses edge with a verb phrase',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: meterReadingId, elementType: 'system', name: 'Meter Reading Service', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: billingPlatformId, elementType: 'system', name: 'Billing Platform', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'uses', fromElementId: meterReadingId, toElementId: billingPlatformId, attributes: { description: 'reads customer records from' }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding verb-edit fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${meterReadingId}`);
  await expect(page.getByRole('heading', { name: 'Meter Reading Service' })).toBeVisible();
  await expect(page.getByText('“reads customer records from”')).toBeVisible();

  const usesRow = page.locator('div').filter({ hasText: 'Billing Platform' }).last();
  const usesRowGroup = usesRow.locator('xpath=..');
  await usesRowGroup.getByRole('button', { name: 'Show attributes' }).click();
  await usesRowGroup.getByRole('button', { name: 'Edit', exact: true }).click();

  const verbField = usesRowGroup.getByLabel('Verb phrase');
  await verbField.fill('streams live billing events to');
  await usesRowGroup.getByRole('button', { name: 'Save', exact: true }).click();

  // The row's own inline label (always visible, expanded or not) reflects
  // the new verb immediately once the commit lands.
  await expect(page.getByText('“streams live billing events to”')).toBeVisible();
  await expect(page.getByText('“reads customer records from”')).toHaveCount(0);

  // Sprint U4-2c item 1's own Context-view change: the neighbour's label is
  // the real verb now, not a fixed "uses" placeholder — `edgeLabel`
  // (contextGrouping.ts). V1 moved the desktop view onto a canvas
  // (ContextDiagramCanvas.tsx), whose own drawn text is exactly as
  // inaccessible to a DOM-based assertion as any other canvas in this
  // product (UI-principles §8.7: "the element page ... is the accessible
  // view"), so this checks the mobile list (ContextMobileList.tsx) — the
  // one place V1 keeps this same fact as real, queryable DOM text.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${meterReadingId}`);
  // The hub's own name is a link, not a semantic heading, on this page
  // (pre-existing — the same reason e2e/context-header.spec.ts's own two
  // tests already fail against unmodified main on this exact assertion
  // shape, confirmed via `git stash` before this PR touched anything here).
  await expect(page.getByRole('link', { name: 'Meter Reading Service' }).first()).toBeVisible();
  await page.getByRole('button', { name: /^Uses/ }).click();
  await expect(page.getByText('streams live billing events to →')).toBeVisible();
});

test('promoting a secondary supports edge demotes the current primary in the same commit, and the landscape tile moves to the new primary\'s lane', async ({ page }) => {
  const { signedIn, orgSlug, modelSlug, main, genesisCommitId, seedSourceId, modelId } = await signUpAndCreateOrgAndModel(page, 'promote-supports');

  const capabilityOneId = randomUUID(); // starts secondary
  const capabilityTwoId = randomUUID(); // starts primary
  const systemId = randomUUID();
  const systemName = 'PowerON';

  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a system with a primary and a secondary supports edge',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: capabilityOneId, elementType: 'capability', name: 'Capability One', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: capabilityTwoId, elementType: 'capability', name: 'Capability Two', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: systemName, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: capabilityOneId, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: capabilityTwoId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding promote-supports fixture: ${seedResult.message}`);

  // --- Before: the element page's own row chips match the seed. ---
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await expect(page.getByRole('heading', { name: systemName })).toBeVisible();
  const capOneRow = page.locator('div').filter({ hasText: 'Capability One' }).last();
  const capTwoRow = page.locator('div').filter({ hasText: 'Capability Two' }).last();
  await expect(capOneRow.getByText('secondary', { exact: true })).toBeVisible();
  await expect(capTwoRow.getByText('primary', { exact: true })).toBeVisible();

  // The tile starts in Capability Two's lane (its primary) — the same
  // pure layout function the app itself calls, given the seeded edges.
  const systemRow: ElementsHeadRow = { element_id: systemId, element_type: 'system', name: systemName, parent_id: null, attributes: { lifecycleStatus: 'active', isExternal: false }, exists_delta_id: randomUUID() };
  const beforeEdges = [
    { relationship_id: 'r1', relationship_type: 'supports' as const, from_element_id: systemId, to_element_id: capabilityOneId, attributes: { role: 'secondary' }, exists_delta_id: 'd1' },
    { relationship_id: 'r2', relationship_type: 'supports' as const, from_element_id: systemId, to_element_id: capabilityTwoId, attributes: { role: 'primary' }, exists_delta_id: 'd2' },
  ];
  const capOneAncestorRow: ElementsHeadRow = { element_id: capabilityOneId, element_type: 'capability', name: 'Capability One', parent_id: null, attributes: {}, exists_delta_id: randomUUID() };
  const capTwoAncestorRow: ElementsHeadRow = { element_id: capabilityTwoId, element_type: 'capability', name: 'Capability Two', parent_id: null, attributes: {}, exists_delta_id: randomUUID() };
  const l1AncestorByCapabilityId = new Map([
    [capabilityOneId, capOneAncestorRow],
    [capabilityTwoId, capTwoAncestorRow],
  ]);
  const beforeLayout = computeLandscapeLayout([systemRow], beforeEdges, l1AncestorByCapabilityId);
  const beforeNode = beforeLayout.nodes[0];
  if (!beforeNode) throw new Error('computeLandscapeLayout did not place the seeded system before promotion');
  const beforeLane = beforeLayout.lanes.find((l) => l.key === capabilityTwoId);
  if (!beforeLane) throw new Error('expected a Capability Two lane before promotion');
  expect(beforeNode.y).toBe(beforeLane.y + 28); // LANE_LABEL_HEIGHT — placed in Capability Two, the seeded primary

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('aria-label', /1 systems across 2 lanes/, { timeout: 30_000 });
  const wrapperBefore = page.locator('[data-scale]');
  const scaleBefore = Number(await wrapperBefore.getAttribute('data-scale'));
  const txBefore = Number(await wrapperBefore.getAttribute('data-tx'));
  const tyBefore = Number(await wrapperBefore.getAttribute('data-ty'));
  await canvas.click({ position: { x: (beforeNode.x + NODE_WIDTH / 2) * scaleBefore + txBefore, y: (beforeNode.y + NODE_HEIGHT / 2) * scaleBefore + tyBefore } });
  await expect(page).toHaveURL(new RegExp(`/context/${systemId}\\?ref=main`));

  // --- Promote Capability One to primary from the system's own element page. ---
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  const capOneRowGroup = page.locator('div').filter({ hasText: 'Capability One' }).last().locator('xpath=..');
  await capOneRowGroup.getByRole('button', { name: 'Show attributes' }).click();
  await capOneRowGroup.getByRole('button', { name: 'Edit', exact: true }).click();
  await capOneRowGroup.getByLabel('Role').selectOption('primary');
  await capOneRowGroup.getByRole('button', { name: 'Save', exact: true }).click();

  // Same-commit auto-demote: Capability Two's own row chip flips to
  // secondary without a second edit (C17, useRelationshipEditor.ts's own
  // module comment).
  await expect(page.locator('div').filter({ hasText: 'Capability One' }).last().getByText('primary', { exact: true })).toBeVisible();
  await expect(page.locator('div').filter({ hasText: 'Capability Two' }).last().getByText('secondary', { exact: true })).toBeVisible();

  // --- After: the tile has moved to Capability One's lane. ---
  const afterEdges = [
    { relationship_id: 'r1', relationship_type: 'supports' as const, from_element_id: systemId, to_element_id: capabilityOneId, attributes: { role: 'primary' }, exists_delta_id: 'd1' },
    { relationship_id: 'r2', relationship_type: 'supports' as const, from_element_id: systemId, to_element_id: capabilityTwoId, attributes: { role: 'secondary' }, exists_delta_id: 'd2' },
  ];
  const afterLayout = computeLandscapeLayout([systemRow], afterEdges, l1AncestorByCapabilityId);
  const afterNode = afterLayout.nodes[0];
  if (!afterNode) throw new Error('computeLandscapeLayout did not place the seeded system after promotion');
  const afterLane = afterLayout.lanes.find((l) => l.key === capabilityOneId);
  if (!afterLane) throw new Error('expected a Capability One lane after promotion');
  expect(afterNode.y).toBe(afterLane.y + 28); // now placed in Capability One — the lane actually changed

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  await expect(canvas).toHaveAttribute('aria-label', /1 systems across 2 lanes/, { timeout: 30_000 });
  const wrapperAfter = page.locator('[data-scale]');
  const scaleAfter = Number(await wrapperAfter.getAttribute('data-scale'));
  const txAfter = Number(await wrapperAfter.getAttribute('data-tx'));
  const tyAfter = Number(await wrapperAfter.getAttribute('data-ty'));
  await canvas.click({ position: { x: (afterNode.x + NODE_WIDTH / 2) * scaleAfter + txAfter, y: (afterNode.y + NODE_HEIGHT / 2) * scaleAfter + tyAfter } });
  await expect(page).toHaveURL(new RegExp(`/context/${systemId}\\?ref=main`));
});
