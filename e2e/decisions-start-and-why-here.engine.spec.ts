/**
 * Prompt pack F3 PR6: "Start a decision" from a health finding
 * (`ArchitectHome.tsx`'s Assurance panel — F3's own named "SAP PM" golden
 * path) and from a weak-capability tile (`DirectorHome.tsx`'s door — F3's
 * second named golden path), "why is this here" (an element's own linked
 * decisions, `ElementPage.tsx`), and "Export as ADR markdown"
 * (`exportDecisionAsAdr.ts`, copied to the clipboard).
 *
 * Same "needs a real Supabase" limitation as every other spec here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('start a decision from a critical-support-end health finding, choose the one option added, and find it again from the system\'s own "why is this here" section; export it as ADR markdown', async ({ page }) => {
  // "Copy as ADR markdown" writes to the clipboard the same way
  // `ElementHeader.tsx`'s own "Copy element ID" already does — no other
  // spec here asserts clipboard content, so this is the one place that
  // needs the permission granted explicitly rather than relying on a
  // headless Chromium default.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:5173' });
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'startdecision', 'SAP PM');
  const { signedIn: owner, orgSlug, modelId, modelSlug, systemId, createDeltaId, seedSourceId, main } = fixture;

  // The fixture's own system is 'active' by default — make it critical and
  // past its vendor support end, the exact `findCriticalSystemsPastOrNearSupportEnd`
  // condition (never a fake flag).
  const deltas: Delta[] = [
    { kind: 'element.update', id: randomUUID(), elementId: systemId, elementType: 'system', attribute: 'criticality', value: 'critical', previousDeltaId: createDeltaId, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.update', id: randomUUID(), elementId: systemId, elementType: 'system', attribute: 'supportEndsAt', value: '2020-01-01', previousDeltaId: createDeltaId, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'make SAP PM critical and past support end', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`startdecision fixture: seeding criticality/support end: ${seedResult.message}`);

  // 1. The architect door's own Assurance panel names it — a single-item
  // decision-shaped finding gets a direct "Start a decision →" right on
  // its own card (architect-door layout prompt's per-item-actions answer:
  // only a *multi*-item decision-shaped finding opens the browse table
  // instead — see the separate `browse-table-decision-row-action.engine.spec.ts`
  // for that case).
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await expect(page.getByRole('heading', { name: 'Assurance' })).toBeVisible();
  await expect(page.getByText('1 critical system past or near vendor support end')).toBeVisible();
  await expect(page.getByText('SAP PM', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Start a decision →' }).click();

  // 2. Lands on /decisions with title/context/link pre-filled.
  await expect(page).toHaveURL(/\/decisions\?/);
  await expect(page.getByPlaceholder('Title (e.g. What replaces SAP PM?)')).toHaveValue('Replace SAP PM?');
  await expect(page.getByPlaceholder('Context — why this decision needs making')).toHaveValue(/SAP PM/);
  await expect(page.getByText('SAP PM', { exact: true }).first()).toBeVisible(); // the pre-linked system, as a chip in the picker

  await page.getByRole('combobox').selectOption({ value: fixture.userId });
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: 'Replace SAP PM?' })).toBeVisible();
  const decisionUrlMatch = /\/decisions\/([^/?]+)/.exec(page.url());
  if (!decisionUrlMatch?.[1]) throw new Error(`could not read the decision id out of ${page.url()}`);

  // 3. Add one option and choose it (PR5's own mechanism, already covered
  // end to end by decisions-options-compare-choose.engine.spec.ts — here
  // only enough to get an accepted decision to look up from the system's
  // own page).
  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByPlaceholder('Name (e.g. replace-with-workday)').fill(`replacement-${randomUUID().slice(0, 8)}`);
  await page.getByPlaceholder('Title (e.g. Replace with Workday)').fill('Replace with Workday');
  await page.getByRole('button', { name: 'Add option' }).click();
  await expect(page.getByText('Replace with Workday')).toBeVisible();

  await page.getByRole('button', { name: 'Choose' }).click();
  await page.getByPlaceholder('The reasons this option was chosen over the others').fill('Workday is the only realistic replacement in budget.');
  await page.getByRole('button', { name: 'Confirm choice' }).click();
  await expect(page.getByText('accepted', { exact: true })).toBeVisible();
  await expect(page.getByText('chosen', { exact: true })).toBeVisible();

  // 4. "Export as ADR markdown" — clipboard copy, ElementHeader's own
  // "Copy element ID" pattern, not a download (nothing in this app offers one).
  await page.getByRole('button', { name: 'Copy as ADR markdown' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();

  // 5. "Why is this here": back on SAP PM's own element page, the
  // Decisions section names the decision and its chosen option.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}?ref=main`);
  await expect(page.getByRole('heading', { name: 'SAP PM' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Replace SAP PM?' })).toBeVisible();
  await expect(page.getByText('Chosen:', { exact: false })).toBeVisible();
  await expect(page.getByText('Replace with Workday', { exact: false })).toBeVisible();
});

test('start a decision from the director door\'s own weak-capability tile', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'startdecisiondirector', 'Legacy Case System');
  const { signedIn: owner, orgSlug, modelId, modelSlug, systemId, createDeltaId, seedSourceId, main } = fixture;

  const capabilityId = randomUUID();
  const supportsId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Adult Social Care', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.update', id: randomUUID(), elementId: systemId, elementType: 'system', attribute: 'lifecycleStatus', value: 'retiring', previousDeltaId: createDeltaId, sourceId: seedSourceId, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: supportsId, relationshipType: 'supports', fromElementId: systemId, toElementId: capabilityId, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed a weak (retiring, no planned replacement) capability', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`startdecisiondirector fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where to focus' })).toBeVisible();

  const tile = page.getByRole('link', { name: /Adult Social Care/ });
  await expect(tile).toBeVisible();
  await expect(tile.getByText('retiring system, no replacement')).toBeVisible();

  await page.getByRole('link', { name: 'Start a decision →' }).click();
  await expect(page).toHaveURL(/\/decisions\?/);
  await expect(page.getByPlaceholder('Title (e.g. What replaces SAP PM?)')).toHaveValue('What improves Adult Social Care?');
  await expect(page.getByPlaceholder('Context — why this decision needs making')).toHaveValue(/Adult Social Care/);
  await expect(page.getByPlaceholder('Context — why this decision needs making')).toHaveValue(/lifecycle exposure/);
});
