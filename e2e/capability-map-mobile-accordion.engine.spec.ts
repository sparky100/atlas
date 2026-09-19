/**
 * Capability map redesign (density pass): the single-open accordion this
 * view's pre-redesign mobile treatment already used (Check B6,
 * docs/CHECK-U4-2a.md) is now the *only* domain interaction model, at
 * every width — no more separate desktop-always-open grid. This is that
 * behavior's own regression coverage at the narrowest supported width
 * (390px), covering: twelve domains all collapsed by default, opening one
 * reveals its own compact capability cards, its own L3 "on tap" reveal,
 * and opening a second domain closes the first (single-open, not a set
 * of independently-toggled ones) — the redesign's own density goal
 * (never showing every domain's contents at once) depends on this.
 *
 * Same "needs a real Supabase" limitation as e2e/capability-map.spec.ts.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

test('capability map accordion: twelve domains collapse at 390px, one open at a time, compact cards, L3 on tap', async ({ page }) => {
  const env = loadEnv();

  const email = `capmap-mobile-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-map-mobile-accordion fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-map-mobile-accordion fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capmap-mobile-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability Map Mobile Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `capmap-mobile-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capability Map Mobile Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const financeId = randomUUID();
  const l1Names = ['Finance', 'Procurement', 'Human Resources', 'Customer Contact', 'Estates', 'Digital & Technology', 'Legal', 'Risk & Compliance', 'Strategy', 'Communications', 'Operations', 'Research'];
  const l1 = l1Names.map((name, index) => ({ name, elementId: name === 'Finance' ? financeId : randomUUID(), order: (index + 1) * 10 }));
  const l2AId = randomUUID();
  const l2BId = randomUUID();
  const l3Id = randomUUID();

  const deltas: Delta[] = [
    ...l1.map((c): Delta => ({
      kind: 'element.create',
      id: randomUUID(),
      elementId: c.elementId,
      elementType: 'capability',
      name: c.name,
      parentId: null,
      attributes: { order: c.order },
      sourceId: seedSourceId,
      confidence: 1,
    })),
    { kind: 'element.create', id: randomUUID(), elementId: l2AId, elementType: 'capability', name: 'Accounts Payable', parentId: financeId, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: l2BId, elementType: 'capability', name: 'Payroll', parentId: financeId, attributes: { order: 20 }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: l3Id, elementType: 'capability', name: 'Supplier Invoicing', parentId: l2AId, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },
  ];

  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed twelve L1 capabilities, one with L2/L3 children',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding capability-map-mobile-accordion fixture: ${seedResult.message}`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByText('Finance', { exact: true })).toBeVisible();

  // All twelve domain headers are present and collapsed — every name is
  // visible (a collapsed list still shows its own headers), but nothing
  // from inside any domain (L2/L3 names, "Open →") is, and there's no
  // horizontal scroll.
  for (const name of l1Names) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('Accounts Payable')).not.toBeVisible();
  await expect(page.getByText('Payroll')).not.toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);

  const financeToggle = page.getByRole('listitem').filter({ hasText: 'Finance' }).getByRole('button').first();
  const procurementToggle = page.getByRole('listitem').filter({ hasText: 'Procurement' }).getByRole('button').first();

  // Opening Finance reveals its own compact capability cards ("Accounts
  // Payable", "Payroll") — not L3 yet, that's still behind its own tap.
  await expect(financeToggle).toHaveAttribute('aria-expanded', 'false');
  await financeToggle.click();
  await expect(financeToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Accounts Payable')).toBeVisible();
  await expect(page.getByText('Payroll')).toBeVisible();
  await expect(page.getByText('Supplier Invoicing')).not.toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);

  // L3 on tap: the expand toggle on "Accounts Payable"'s own card — the
  // only L2 card with an L3 child while Finance is open, so its own
  // "▸ 1" toggle is the only button whose accessible name ends in a bare
  // digit (every other button here is either a header, whose own trailing
  // text is a coverage sentence, or a reorder button with a named
  // aria-label) — reveals "Supplier Invoicing" underneath it.
  await page.getByRole('button', { name: /\d$/ }).click();
  await expect(page.getByText('Supplier Invoicing')).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);

  // One expanded at a time: opening Procurement closes Finance — its own
  // capability cards disappear again, not just visually collapsed
  // underneath (this is what keeps the redesign's own density goal from
  // creeping back in as more domains get opened over a session).
  await procurementToggle.click();
  await expect(procurementToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(financeToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Accounts Payable')).not.toBeVisible();
  await expect(page.getByText('Payroll')).not.toBeVisible();
  await expect(page.getByText('Supplier Invoicing')).not.toBeVisible();

  // Every domain name is still reachable — none dropped or hidden behind
  // scroll at the narrowest tier.
  for (const name of l1Names) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  expect(await hasHorizontalScroll(page)).toBe(false);
});
