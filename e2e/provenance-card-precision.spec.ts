/**
 * Prompt 7h bug fix: "Provenance card: recorded/effective as precise
 * relative time or date; 'Loading history…' replaced by real history or
 * omitted." `ProvenanceCard.tsx`'s own "Effective"/"Recorded" rows used
 * to show the same coarse monthly staleness bucket `ProvenanceBadge`'s
 * compact badge uses for its stale-colour threshold ("< 1mo ago") — a
 * fact recorded moments ago read exactly the same as one recorded three
 * weeks ago. `FactBadge.tsx`'s own supersession-chain fetch failure also
 * used to leave the card reading "Loading history…" forever instead of
 * omitting the "Previously" section the way a real, empty chain already
 * does.
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('provenance card: Effective/Recorded read a precise relative time, and the supersession chain stops loading', async ({ page }) => {
  const env = loadEnv();

  const email = `provenance-card-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`provenance-card-precision fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`provenance-card-precision fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `provenance-card-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Provenance Card Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `provenance-card-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Provenance Card Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const systemId = randomUUID();
  const systemName = 'Payments Gateway';
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: systemName, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: `seed ${systemName}`,
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding provenance-card-precision fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await expect(page.getByRole('heading', { name: systemName })).toBeVisible();

  // ElementHeader.tsx's own existence-fact badge (`FactBadge`) — the only
  // provenance badge on the page for a freshly seeded element with no
  // attributes filled in yet. `ProvenanceBadge.tsx` sets a `title` of
  // "<kind>, <age> old" on the compact badge itself; hovering it opens
  // `FactBadge`'s popover (mouseenter), which is `ProvenanceCard`.
  const badge = page.getByTitle(/old$/).first();
  await badge.hover();

  const card = page.getByRole('tooltip');
  await expect(card).toBeVisible();

  // The bug itself: recorded moments ago used to read "< 1mo ago" (the
  // coarse staleness bucket) — now the same precise wording the activity
  // feed already used (`formatCommitActivityTime`).
  const effectiveRow = card.locator('div').filter({ hasText: 'Effective' }).last();
  const recordedRow = card.locator('div').filter({ hasText: 'Recorded' }).last();
  await expect(effectiveRow).toContainText('just now');
  await expect(recordedRow).toContainText('just now');
  await expect(card).not.toContainText('< 1mo ago');

  // The chain fetch (real Supabase) resolves quickly for a single-delta
  // element — "Loading history…" must not be the card's final state.
  await expect(card.getByText('Loading history…')).toBeHidden({ timeout: 10_000 });
});
