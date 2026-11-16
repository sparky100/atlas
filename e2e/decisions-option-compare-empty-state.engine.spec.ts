/**
 * F6.3 (Part B)'s own-delta rework — golden path 1 of 3 (the sprint's own
 * go-ahead, decision 4/item 2): two options that neither one ever commits
 * anything to. `compareOptions.ts`'s own-delta derivation
 * (`summarizeOwnDeltas`/`listOwnDeltas`, fork-scoped) must produce an empty
 * `OptionTouch` for both — no rows differ from main in either option, so
 * every "What changes" row collapses and the panel shows the empty-state
 * sentence, and each option's own criteria-grid header reads "No changes
 * recorded yet" rather than a derived summary.
 *
 * Named `.engine.spec.ts` (not `golden-path-*.spec.ts`) to match this
 * area's existing precedent (`decisions-options-compare-choose.engine.spec.ts`):
 * the decision-comparison flow needs real seeded model data reached via
 * `commitToBranch`/`bootstrapChangeBranchFixture`, not a click-only path
 * from Home, so it does not qualify as CLAUDE.md's "golden path" coverage
 * shape even though the sprint's own instructions call it that informally.
 * Same "needs a real Supabase" limitation as every other spec here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

function makeCapability(id: string, elementId: string, name: string, sourceId: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'capability', name, parentId: null, attributes: {}, sourceId, confidence: 1 };
}
function makeSupports(id: string, relationshipId: string, fromElementId: string, toElementId: string, sourceId: string): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType: 'supports', fromElementId, toElementId, attributes: { role: 'secondary' }, sourceId, confidence: 1 };
}

test('two like-for-like options with no commits of their own show the empty-state sentence and "No changes recorded yet"', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'decisionemptystate', 'Ledger Service');
  const { signedIn: owner, orgSlug, modelId, modelSlug, systemId, seedSourceId } = fixture;

  const capabilityId = randomUUID();
  const supportsId = randomUUID();
  const main = await getMainBranch(owner, modelId);
  if (!main?.head_commit_id) throw new Error('main branch not found');
  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a capability for the comparison table',
    body: null,
    deltas: [makeCapability(randomUUID(), capabilityId, 'Finance', seedSourceId), makeSupports(randomUUID(), supportsId, systemId, capabilityId, seedSourceId)],
  };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`decisionemptystate fixture: seeding a capability: ${seedResult.message}`);

  // 1. Start the decision, linking Finance as its one concern.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await page.getByRole('link', { name: 'Decisions' }).click();
  const decisionTitle = `Which replaces Ledger Service? ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Title (e.g. What replaces SAP PM?)').fill(decisionTitle);
  await page.getByPlaceholder('Context — why this decision needs making').fill('Ledger Service needs a real replacement plan.');
  await page.getByRole('combobox').selectOption({ value: fixture.userId });
  await page.getByPlaceholder('Search capabilities or systems this decision concerns…').fill('Finance');
  await page.getByRole('button', { name: 'Finance' }).click();
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();

  // 2. Add two options — neither one gets a single extra commit.
  const optionNames = ['option-a', 'option-b'].map((n) => `${n}-${randomUUID().slice(0, 8)}`);
  for (const [i] of optionNames.entries()) {
    await page.getByRole('button', { name: '+ Add an option' }).click();
    await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill(`Option ${String(i + 1)}`);
    await page.getByRole('button', { name: 'Add option' }).click();
    await expect(page.getByText('Option ' + String(i + 1))).toBeVisible();
  }

  // 3. Both criteria-grid headers read "No changes recorded yet" — the
  // own-delta summary is null for a zero-delta option (`optionChangeSummary.ts`).
  const criteriaGridTable = page.locator('table').first();
  const optionAHeader = criteriaGridTable.locator('th', { hasText: 'Option 1' });
  const optionBHeader = criteriaGridTable.locator('th', { hasText: 'Option 2' });
  await expect(optionAHeader).toContainText('No changes recorded yet');
  await expect(optionBHeader).toContainText('No changes recorded yet');

  // 4. "What changes" shows the empty-state sentence — Finance's own
  // metric rows and the scoped-crossings row all collapse (neither option
  // differs from main on anything), so nothing is left in the visible table.
  await expect(page.getByText("These options don't change the structure of anything in scope.")).toBeVisible();
});
