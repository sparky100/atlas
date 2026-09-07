/**
 * Shared bootstrap for Sprint C1's change-branch specs
 * (e2e/change-branch-merge.spec.ts, e2e/merge-field-conflict.spec.ts):
 * sign up a fresh user through the real UI, create an org/model as them,
 * and seed one System on top of main's existing genesis commit (ADR-018:
 * main already has a real head — its genesis commit, made by
 * atlas.on_model_created — the instant createModel's insert fires, so
 * there's no bootstrap left to do here beyond reading it). Factored out of
 * the sign-up-plus-seed boilerplate e2e/element-edit.spec.ts and
 * e2e/versions.spec.ts each already carry inline.
 */
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type { CommitEnvelope } from '../../src/contracts/delta';
import { getMainBranch } from '../../src/db/branches';
import { createSupabaseClient, type Client } from '../../src/db/client';
import { commitToBranch } from '../../src/db/commits';
import type { Env } from '../../src/db/env';
import { createModel } from '../../src/db/models';
import { createOrganisation } from '../../src/db/organisations';
import type { BranchRow } from '../../src/db/types';

export interface ChangeBranchFixture {
  signedIn: Client;
  userId: string;
  orgId: string;
  orgSlug: string;
  modelId: string;
  modelSlug: string;
  main: BranchRow;
  genesisCommitId: string;
  seedSourceId: string;
  systemId: string;
  /** The commit that created `systemId` — main's head once this fixture returns, and every change branch's fork point. */
  seedCommitId: string;
  /** The `element.create` delta's own id — a conflict scenario diverging two sides from the same fact needs this as `previousDeltaId`. */
  createDeltaId: string;
}

/**
 * Signs up `prefix-{uuid}@example.test` through `/sign-in`, creates an org
 * and model as them, seeds the model's genesis commit (service-role — see
 * module comment) and one System named `systemName` via the real
 * `commitToBranch` path. Leaves `page` on the "Your organisations" screen,
 * signed in — callers navigate wherever their own scenario needs from
 * there.
 */
export async function bootstrapChangeBranchFixture(page: Page, env: Env, prefix: string, systemName: string): Promise<ChangeBranchFixture> {
  const email = `${prefix}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`${prefix} fixture sign-in: ${signInError.message}`);

  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`${prefix} fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `${prefix}-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: `${prefix} Test Org`, slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `${prefix}-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: `${prefix} Test Model`, slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const systemId = randomUUID();
  const createDeltaId = randomUUID();
  const seedCommitId = randomUUID();
  const envelope: CommitEnvelope = {
    id: seedCommitId,
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    message: `seed ${systemName}`,
    deltas: [
      {
        kind: 'element.create',
        id: createDeltaId,
        elementId: systemId,
        elementType: 'system',
        name: systemName,
        parentId: null,
        attributes: { lifecycleStatus: 'active', isExternal: false },
        sourceId: seedSourceId,
        confidence: 1,
      },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding ${systemName}: ${seedResult.message}`);

  const refreshedMain = await getMainBranch(signedIn, modelId);
  if (!refreshedMain) throw new Error('main branch disappeared after seeding');

  return { signedIn, userId, orgId, orgSlug, modelId, modelSlug, main: refreshedMain, genesisCommitId, seedSourceId, systemId, seedCommitId, createDeltaId };
}
