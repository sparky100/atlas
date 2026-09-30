/**
 * Prompt pack F3 PR5's own verification bullet: "F3's first golden path
 * end to end" (the parts PR5 itself builds — "Start a decision" from a
 * health finding is PR6, not yet built, so this creates the decision from
 * the Decisions page's own form, same as
 * decisions-create-list-detail.engine.spec.ts). Add three options,
 * confirm the comparison table shows genuinely per-branch numbers (not
 * main's data leaking into every option — one option gets a real extra
 * commit so its own row must differ from the other two), choose one,
 * confirm the decision closes and the chosen option's intent flips to
 * `propose`, submit/approve/merge it through F0/PR3's ordinary review
 * path unchanged, and confirm the other two options read `cancelled`.
 *
 * Same "needs a real Supabase" limitation as every other spec here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getBranch, getMainBranch } from '../src/db/branches';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { addArchitectMember, bootstrapChangeBranchFixture, signInExistingUser, submitForReviewWithReviewers } from './fixtures/changeBranchFixture';

function makeCapability(id: string, elementId: string, name: string, sourceId: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'capability', name, parentId: null, attributes: {}, sourceId, confidence: 1 };
}
function makeSystem(id: string, elementId: string, name: string, sourceId: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 };
}
function makeSupports(id: string, relationshipId: string, fromElementId: string, toElementId: string, sourceId: string): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType: 'supports', fromElementId, toElementId, attributes: { role: 'secondary' }, sourceId, confidence: 1 };
}

test('add three options to a decision, compare them, choose one; the chosen option flips to propose and merges through the ordinary review path; the others show cancelled', async ({ page, browser }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'decisioncompare', 'Ledger Service');
  const { signedIn: owner, orgId, userId, orgSlug, modelId, modelSlug, systemId, seedSourceId } = fixture;
  // F3a's own architect floor — see addArchitectMember's own doc comment.
  // Chosen decision options flip to propose intent (below), so the owner
  // needs to be in the reviewer set too: they cast the approve verdict.
  const architect = await addArchitectMember(env, orgId, userId);

  // A capability the decision will concern, with the fixture's own system
  // already supporting it — the comparison table's one real row.
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
  if (!seedResult.ok) throw new Error(`decisioncompare fixture: seeding a capability: ${seedResult.message}`);

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

  // 2. Add three options.
  const optionNames = ['option-a', 'option-b', 'option-c'].map((n) => `${n}-${randomUUID().slice(0, 8)}`);
  for (const [i, name] of optionNames.entries()) {
    await page.getByRole('button', { name: '+ Add an option' }).click();
    await page.getByPlaceholder('Name (e.g. replace-with-workday)').fill(name);
    await page.getByPlaceholder('Title (e.g. Replace with Workday)').fill(`Option ${String(i + 1)}`);
    await page.getByRole('button', { name: 'Add option' }).click();
    await expect(page.getByText('Option ' + String(i + 1))).toBeVisible();
  }

  // 3. Give option B a real, distinguishing commit — a second system
  // supporting Finance — so the comparison table's own numbers must
  // actually differ per option, not just echo main's for all three.
  const decisionUrlMatch = /\/decisions\/([^/?]+)/.exec(page.url());
  if (!decisionUrlMatch?.[1]) throw new Error(`could not read the decision id out of ${page.url()}`);
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  const optionBRow = page.locator('li', { hasText: 'Option 2' });
  await optionBRow.getByRole('link', { name: 'Open →' }).click();
  const optionBBranchIdMatch = /\/changes\/([^/?]+)/.exec(page.url());
  if (!optionBBranchIdMatch?.[1]) throw new Error(`could not read option B's branch id out of ${page.url()}`);
  const optionBBranchId = optionBBranchIdMatch[1];
  const optionBBranch = await getBranch(owner, optionBBranchId);
  if (!optionBBranch?.head_commit_id) throw new Error("option B's own branch has no head commit");
  const secondSystemId = randomUUID();
  const secondSupportsId = randomUUID();
  const extraEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: optionBBranchId,
    parentCommitId: optionBBranch.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'add a second system supporting Finance, on option B only',
    body: null,
    deltas: [makeSystem(randomUUID(), secondSystemId, 'Second System', seedSourceId), makeSupports(randomUUID(), secondSupportsId, secondSystemId, capabilityId, seedSourceId)],
  };
  const extraResult = await commitToBranch(owner, { modelId, branchId: optionBBranchId, expectedHeadCommitId: optionBBranch.head_commit_id, envelope: extraEnvelope });
  if (!extraResult.ok) throw new Error(`decisioncompare: seeding option B's extra commit: ${extraResult.message}`);

  // 4. Back on the decision page: F6.3's own "What changes" table shows
  // Finance's own Coverage row un-collapsed (option B genuinely differs),
  // main's column at "1 system" and option B's own column reading the
  // delta ("1 → 2 systems (+1)") — proof the fold is genuinely per-branch,
  // not raw counts repeated per option the way the pre-rework table did.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/decisions/${decisionUrlMatch[1]}`);
  const whatChangesTable = page.locator('table').filter({ has: page.locator('th', { hasText: 'Row' }) });
  await expect(whatChangesTable).toBeVisible();
  const coverageRow = whatChangesTable.locator('tr', { hasText: 'Coverage' });
  await expect(coverageRow).toContainText('1 system'); // main's own column, still just Ledger Service
  await expect(coverageRow).toContainText('1 → 2 systems (+1)'); // option B's own column

  // 5. Choose option B — the criteria grid's own merged option header now
  // carries the "Choose" action (F6.3 folded the old separate Options list
  // into these headers).
  const optionBHeader = page.locator('th', { hasText: 'Option 2' });
  await optionBHeader.getByRole('button', { name: 'Choose' }).click();
  await page.getByPlaceholder('The reasons this option was chosen over the others').fill('Option B is the only one that actually adds the replacement capacity.');
  await page.getByRole('button', { name: 'Confirm choice' }).click();

  await expect(page.getByText('accepted', { exact: true })).toBeVisible();
  await expect(page.getByText('chosen', { exact: true })).toBeVisible();
  await expect(page.getByText('Option B is the only one that actually adds the replacement capacity.')).toBeVisible();

  // 6. Options A and C read cancelled; option B's own page now reads
  // "Proposing: ..." (F0's own intent-flip) and goes through the ordinary
  // review path (F0/PR3), unchanged by any of this. Scoped to the criteria
  // grid specifically (the page's *first* table) — the "What changes"
  // table's own headers repeat each option's full, unstripped label too,
  // which would otherwise make this locator ambiguous.
  const criteriaGridTable = page.locator('table').first();
  await expect(criteriaGridTable.locator('th', { hasText: 'Option 1' })).toContainText('cancelled');
  await expect(criteriaGridTable.locator('th', { hasText: 'Option 3' })).toContainText('cancelled');

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes/${optionBBranchId}`);
  await expect(page.getByRole('heading', { name: /^Proposing: Option 2/ })).toBeVisible();
  await submitForReviewWithReviewers(page, true);
  await expect(page).toHaveURL(new RegExp(`/o/${orgSlug}/m/${modelSlug}/review/`));
  const reviewUrl = page.url();
  const approveButton = page.getByRole('button', { name: 'Approve' });
  await expect(approveButton).toBeEnabled();
  await approveButton.click();

  // `pickArchitect` (`deriveReviewers.ts`) always prefers a real architect
  // over the owner once one exists, so the owner's own reviewer row above
  // is `optional` — only the architect's own approval counts toward "N of
  // N required approvers". Sign in as them in a second browser context
  // (the pattern `golden-path-propose-review-merge.spec.ts` already uses)
  // and cast their verdict too.
  const architectContext = await browser.newContext();
  const architectPage = await architectContext.newPage();
  await signInExistingUser(architectPage, architect.email, architect.password);
  await architectPage.goto(reviewUrl);
  await architectPage.getByRole('button', { name: 'Approve' }).click();
  await expect(architectPage.getByText('approved', { exact: true }).first()).toBeVisible();
  await architectContext.close();

  // `page` has no realtime subscription onto the request it's already
  // loaded, so a reload is needed to see the architect's own verdict.
  await page.reload();
  await expect(page.getByText('approved', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Merge' }).click();
  await expect(page.getByText('merged', { exact: true }).first()).toBeVisible();
});
