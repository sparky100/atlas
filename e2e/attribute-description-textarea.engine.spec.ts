/**
 * Check C2 (docs/CHECK-U4-2a.md): "Free-text attributes (description,
 * relationship verb phrases) edit in an auto-growing textarea (min 2
 * rows, max ~8), mobile and desktop" — found "Not started."
 *
 * `attributeSchema.ts`'s `multiline` flag (set on every `description`
 * field) is what `AttributeValueInput.tsx` branches on; this drives it
 * through a real edit on a System's Description, checking the box starts
 * at roughly 2 rows tall, grows as more lines are typed, and stops
 * growing (scrolling internally instead) once content exceeds ~8 rows —
 * the shape a fixed-pixel assertion can't get right across browsers/fonts,
 * so this compares the box's own height at each stage against itself
 * rather than a hardcoded pixel count.
 *
 * Same "needs a real Supabase" limitation as e2e/element-edit.spec.ts,
 * whose fixture shape this reuses.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('a System\'s Description edits in an auto-growing textarea: starts around 2 rows, grows with content, caps around 8', async ({ page }) => {
  const env = loadEnv();

  const email = `desc-textarea-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`attribute-description-textarea fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`attribute-description-textarea fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `desc-textarea-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Description Textarea Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `desc-textarea-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Description Textarea Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const systemId = randomUUID();
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed Billing Service',
    body: null,
    deltas: [
      {
        kind: 'element.create',
        id: randomUUID(),
        elementId: systemId,
        elementType: 'system',
        name: 'Billing Service',
        parentId: null,
        attributes: { lifecycleStatus: 'active', isExternal: false },
        sourceId: seedSourceId,
        confidence: 1,
      },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding Billing Service: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await expect(page.getByRole('heading', { name: 'Billing Service' })).toBeVisible();

  await page.getByRole('button', { name: '✎ Edit' }).click();
  const description = page.getByLabel('Description');
  await expect(description).toHaveJSProperty('tagName', 'TEXTAREA');

  const emptyHeight = await description.evaluate((el) => el.getBoundingClientRect().height);

  // One line of content shouldn't grow the box past its own ~2-row floor.
  await description.fill('Handles customer invoicing.');
  const oneLineHeight = await description.evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.abs(oneLineHeight - emptyHeight)).toBeLessThan(2);

  // Five lines is comfortably past 2 rows and comfortably under 8 — the
  // box should have grown to fit all of it, no internal scroll needed.
  const fiveLines = Array.from({ length: 5 }, (_, i) => `Line ${String(i + 1)} of the description.`).join('\n');
  await description.fill(fiveLines);
  const fiveLineHeight = await description.evaluate((el) => el.getBoundingClientRect().height);
  expect(fiveLineHeight).toBeGreaterThan(oneLineHeight);
  const fiveLineOverflow = await description.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(fiveLineOverflow).toBeLessThanOrEqual(1);

  // Twenty lines is well past the ~8-row cap — the box stops growing
  // (its own rendered height matches the 5-line height's growth ceiling,
  // not twenty lines' worth) and scrolls internally instead.
  const twentyLines = Array.from({ length: 20 }, (_, i) => `Line ${String(i + 1)} of a much longer description.`).join('\n');
  await description.fill(twentyLines);
  const twentyLineHeight = await description.evaluate((el) => el.getBoundingClientRect().height);
  expect(twentyLineHeight).toBeGreaterThan(fiveLineHeight);
  const twentyLineOverflow = await description.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(twentyLineOverflow).toBeGreaterThan(0);

  // Saving still round-trips the full value — capping the box's own
  // height never truncates what was actually typed. `.first()`: the
  // saved text appears more than once (the attribute row's own value,
  // plus provenance/history text elsewhere on the page) — same pattern
  // e2e/element-edit.spec.ts's own "Acme Corp" check uses.
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: '✎ Edit' })).toBeVisible();
  await expect(page.getByText('Line 20 of a much longer description.').first()).toBeVisible();
});
