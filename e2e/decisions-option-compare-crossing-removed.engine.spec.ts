/**
 * F6.3 (Part B)'s own-delta rework — golden path 2 of 3 (the sprint's own
 * go-ahead, decision 4/item 2): an option that retracts a boundary-
 * crossing edge, with no other structural change in scope. Only the
 * "Scoped crossings" row should be visible (Finance's own four metric rows
 * never change, so they stay collapsed) — and expanding "Also affected"
 * must show the OT system the option's own `element.update` touched,
 * with its owner read off the option's own projection (decision 2).
 *
 * Named `.engine.spec.ts` — see `decisions-option-compare-empty-state.engine.spec.ts`'s
 * own module comment for why (real seeded data via `commitToBranch`, not a
 * click-only path from Home). Same "needs a real Supabase" limitation as
 * every other spec here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getBranch, getMainBranch } from '../src/db/branches';
import { commitToBranch } from '../src/db/commits';
import { getElementHead } from '../src/db/elements';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

function makeCapability(id: string, elementId: string, name: string, sourceId: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'capability', name, parentId: null, attributes: {}, sourceId, confidence: 1 };
}
function makeSystem(id: string, elementId: string, name: string, sourceId: string, domain?: 'ot'): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false, ...(domain ? { domain } : {}) }, sourceId, confidence: 1 };
}
function makeActor(id: string, elementId: string, name: string, sourceId: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'actor', name, parentId: null, attributes: { subtype: 'team', isExternal: false }, sourceId, confidence: 1 };
}
function makeSupports(id: string, relationshipId: string, fromElementId: string, toElementId: string, sourceId: string): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType: 'supports', fromElementId, toElementId, attributes: { role: 'secondary' }, sourceId, confidence: 1 };
}
function makeOwns(id: string, relationshipId: string, fromElementId: string, toElementId: string, sourceId: string): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType: 'owns', fromElementId, toElementId, attributes: { role: 'business' }, sourceId, confidence: 1 };
}

test('an option that removes a boundary crossing shows only that row plus the summary line, and "Also affected" once expanded', async ({ page }) => {
  const env = loadEnv();
  // The fixture's own seeded system stands in for the IT-side system — no
  // `domain` set, so it defaults to `'it'` (`domainOf`'s own doc comment).
  const fixture = await bootstrapChangeBranchFixture(page, env, 'decisioncrossing', 'IT System');
  const { signedIn: owner, orgSlug, modelId, modelSlug, systemId: itSystemId, seedSourceId } = fixture;

  const capabilityId = randomUUID();
  const supportsId = randomUUID();
  const otSystemId = randomUUID();
  const crossingId = randomUUID();
  const crossingCreateDeltaId = randomUUID();
  const ownerActorId = randomUUID();
  const ownsId = randomUUID();
  const main = await getMainBranch(owner, modelId);
  if (!main?.head_commit_id) throw new Error('main branch not found');
  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed Finance, an OT system, a boundary crossing, and its owner',
    body: null,
    deltas: [
      makeCapability(randomUUID(), capabilityId, 'Finance', seedSourceId),
      makeSupports(randomUUID(), supportsId, itSystemId, capabilityId, seedSourceId),
      makeSystem(randomUUID(), otSystemId, 'OT System', seedSourceId, 'ot'),
      { kind: 'relationship.create', id: crossingCreateDeltaId, relationshipId: crossingId, relationshipType: 'uses', fromElementId: itSystemId, toElementId: otSystemId, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      makeActor(randomUUID(), ownerActorId, 'Ops Team', seedSourceId),
      makeOwns(randomUUID(), ownsId, ownerActorId, otSystemId, seedSourceId),
    ],
  };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`decisioncrossing fixture: seeding: ${seedResult.message}`);

  // 1. Start the decision, linking Finance as its one concern (not the OT
  // system directly — "Also affected" is what surfaces it).
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await page.getByRole('link', { name: 'Decisions' }).click();
  const decisionTitle = `Which removes the OT crossing? ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Title (e.g. What replaces SAP PM?)').fill(decisionTitle);
  await page.getByPlaceholder('Context — why this decision needs making').fill('The IT/OT crossing needs decommissioning.');
  await page.getByRole('combobox').selectOption({ value: fixture.userId });
  await page.getByPlaceholder('Search capabilities or systems this decision concerns…').fill('Finance');
  await page.getByRole('button', { name: 'Finance' }).click();
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();

  // 2. Add one option.
  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill('Option 1');
  await page.getByRole('button', { name: 'Add option' }).click();
  await expect(page.getByText('Option 1')).toBeVisible();

  // 3. Retract the crossing edge on the option's own branch, plus an
  // `element.update` on the OT system itself — the latter is what makes
  // the OT system show up in "Also affected" (a pure relationship-only
  // touch produces no element-side entry there, decision 2's own scope).
  const decisionUrlMatch = /\/decisions\/([^/?]+)/.exec(page.url());
  if (!decisionUrlMatch?.[1]) throw new Error(`could not read the decision id out of ${page.url()}`);
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  const optionRow = page.locator('li', { hasText: 'Option 1' });
  await optionRow.getByRole('link', { name: 'Open →' }).click();
  const optionBranchIdMatch = /\/changes\/([^/?]+)/.exec(page.url());
  if (!optionBranchIdMatch?.[1]) throw new Error(`could not read the option's branch id out of ${page.url()}`);
  const optionBranchId = optionBranchIdMatch[1];
  const optionBranch = await getBranch(owner, optionBranchId);
  if (!optionBranch?.head_commit_id) throw new Error("the option's own branch has no head commit");
  const otSystemRow = await getElementHead(owner, optionBranch.head_commit_id, otSystemId);
  const optionEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: optionBranchId,
    parentCommitId: optionBranch.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'decommission the IT/OT crossing',
    body: null,
    deltas: [
      { kind: 'relationship.retract', id: randomUUID(), relationshipId: crossingId, relationshipType: 'uses', previousDeltaId: crossingCreateDeltaId, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.update', id: randomUUID(), elementId: otSystemId, elementType: 'system', attribute: 'criticality', value: 'high', previousDeltaId: otSystemRow?.exists_delta_id ?? '', sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const optionResult = await commitToBranch(owner, { modelId, branchId: optionBranchId, expectedHeadCommitId: optionBranch.head_commit_id, envelope: optionEnvelope });
  if (!optionResult.ok) throw new Error(`decisioncrossing: retracting the crossing on the option: ${optionResult.message}`);

  // 4. Back on the decision page: only "Scoped crossings" is visible —
  // Finance's own metric rows never changed, so they collapse.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/decisions/${decisionUrlMatch[1]}`);
  const whatChangesTable = page.locator('table').filter({ has: page.locator('th', { hasText: 'Row' }) });
  await expect(whatChangesTable).toBeVisible();
  await expect(whatChangesTable).toContainText('Scoped crossings');
  await expect(whatChangesTable).toContainText('1 → 0 crossings (-1)');
  await expect(whatChangesTable).not.toContainText('Coverage');
  await expect(whatChangesTable).not.toContainText('Lifecycle');

  // 5. The option's own summary line reads the re-point, off the option's
  // own deltas.
  const criteriaGridTable = page.locator('table').first();
  await expect(criteriaGridTable.locator('th', { hasText: 'Option 1' })).toContainText('Re-points 1 connection');

  // 6. Expand the collapsed group (Finance's own unchanged rows), then
  // check "Also affected" shows the OT system with its owner, read off the
  // option's own projection.
  await page.getByRole('button', { name: /rows unchanged in all options/ }).click();
  await expect(page.getByText('Finance').first()).toBeVisible();

  await expect(page.getByRole('heading', { name: /Also affected/ })).toBeVisible();
  const alsoAffectedList = page.locator('h3', { hasText: 'Also affected' }).locator('xpath=following-sibling::ul[1]');
  await expect(alsoAffectedList.getByText('OT System')).toBeVisible();
  await expect(alsoAffectedList).toContainText('Owned by Ops Team (business)');
});
