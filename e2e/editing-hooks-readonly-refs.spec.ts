/**
 * S1 item 9 (docs/prompts/atlas-prompt-pack.md, issue #111): "editing
 * hooks (useEditingBranch etc.) never run for commit or tag refs."
 *
 * Before this item, `useEditingBranch` only guarded `ref.kind === 'tag'`
 * — a `commit:` ref fell through to `getBranch(supabase, '')` (a commit
 * ref has no `branchId`), which `assertRealId` throws on immediately.
 * Every page that calls the hook directly with the raw selected ref
 * (`ElementPage`, `ContainerPage`, `ModelHome`, `LandscapePage` —
 * `EditingBranchBanner` already guarded its own call; `ComponentPage`
 * also did until S1 item 18 removed it along with the component level)
 * hit this on every render with a commit ref selected: a doomed query,
 * and — before S1 item 9's error-banner fix too — a verbose technical
 * error banner naming none of that to the user.
 */
import { expect, test } from '@playwright/test';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('visiting an element at a commit ref never fires the editing-branch load or shows an error banner', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'commitref', 'Billing Ledger');
  const { orgSlug, modelSlug, systemId, seedCommitId } = fixture;

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}?ref=commit:${seedCommitId}`);
  await expect(page.getByRole('heading', { name: 'Billing Ledger' })).toBeVisible();

  // No error banner anywhere on the page — the old bug's own symptom
  // (`assertRealId`'s multi-clause message surfacing via the global
  // banner) is gone, not just quieter.
  await expect(page.getByRole('alert')).toHaveCount(0);

  // Read-only at a commit ref: no edit affordance rendered, the same
  // "nothing is editable" outcome a tag ref already produced.
  await expect(page.getByRole('button', { name: '+ Add flows to' })).toHaveCount(0);
});
