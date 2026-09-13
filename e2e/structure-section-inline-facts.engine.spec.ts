/**
 * Check C3 (docs/CHECK-U4-2a.md): "Structure section: single-line facts
 * inline ('Level 1', 'Parent: Finance', 'Children: 5'); label-over-value
 * only for values that wrap" — found "Not started."
 *
 * Level and Parent (StructureSection.tsx's `.groupInline`) are each one
 * short scalar/single link — this checks the label and its value share
 * one line (near-equal `top` in the bounding rect, the same technique
 * this codebase has no CSS-module-selector-free alternative to for a
 * pure layout assertion). Children keeps `.group`'s label-over-value
 * column, since its own child list genuinely wraps — checked the
 * opposite way, confirming the label and its first list item do *not*
 * share a line.
 *
 * Two capabilities, parent and child, seeded directly (a two-level tree)
 * so one page (the parent's) exercises Level + Children, and the other
 * (the child's) exercises Level + Parent, in a single fixture.
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Locator } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

async function sameLine(a: Locator, b: Locator): Promise<boolean> {
  const [boxA, boxB] = await Promise.all([a.boundingBox(), b.boundingBox()]);
  if (!boxA || !boxB) throw new Error('one of the two elements has no bounding box (not visible?)');
  return Math.abs(boxA.y - boxB.y) < 6;
}

test('Structure section: Level and Parent render inline (label and value share a line); Children keeps its own wrapping list below the label', async ({ page }) => {
  const env = loadEnv();

  const email = `structure-inline-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`structure-section-inline-facts fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`structure-section-inline-facts fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `structure-inline-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Structure Inline Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `structure-inline-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Structure Inline Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const parentId = randomUUID();
  const childId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: parentId, elementType: 'capability', name: 'Finance', parentId: null, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: childId, elementType: 'capability', name: 'Accounts Payable', parentId, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a two-level capability tree',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding structure-section-inline-facts fixture: ${seedResult.message}`);

  // Scoped to the "Structure" section specifically — `Text`/bare numbers
  // like "1"/"2" aren't unique across the whole page (confidence badges,
  // "< 1mo" timestamps, etc.), and CollapsibleSection.tsx's own `<section>`
  // has no accessible name of its own to query by role.
  const structureSection = (p: typeof page) => p.locator('section').filter({ has: p.getByRole('button', { name: 'Structure' }) });

  // --- The parent's own page: Level 1 (inline), Children (1) with its
  // own wrapping list below (not inline with the label).
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${parentId}`);
  await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();

  const parentStructure = structureSection(page);
  const levelLabel = parentStructure.getByText('Level', { exact: true });
  const levelValue = parentStructure.getByText('1', { exact: true });
  await expect(levelLabel).toBeVisible();
  expect(await sameLine(levelLabel, levelValue)).toBe(true);

  const childrenLabel = parentStructure.getByText('Children (1)', { exact: true });
  const childLink = parentStructure.getByRole('link', { name: /Accounts Payable/ });
  await expect(childrenLabel).toBeVisible();
  await expect(childLink).toBeVisible();
  expect(await sameLine(childrenLabel, childLink)).toBe(false);

  // --- The child's own page: Level 2 and Parent: Finance, both inline.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${childId}`);
  await expect(page.getByRole('heading', { name: 'Accounts Payable' })).toBeVisible();

  const childStructure = structureSection(page);
  const childLevelLabel = childStructure.getByText('Level', { exact: true });
  const childLevelValue = childStructure.getByText('2', { exact: true });
  await expect(childLevelLabel).toBeVisible();
  expect(await sameLine(childLevelLabel, childLevelValue)).toBe(true);

  const parentLabel = childStructure.getByText('Parent:', { exact: true });
  const parentLink = childStructure.getByRole('link', { name: /Finance/ });
  await expect(parentLabel).toBeVisible();
  await expect(parentLink).toBeVisible();
  expect(await sameLine(parentLabel, parentLink)).toBe(true);
});
