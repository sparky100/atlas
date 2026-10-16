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
import { createServiceRoleClient, createSupabaseClient, type Client } from '../../src/db/client';
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

/** The architect member `addArchitectMember` creates — credentials included so a caller can sign in as them in a second browser context to cast their own review verdict. */
export interface ArchitectMember {
  userId: string;
  email: string;
  password: string;
}

/**
 * F3a's own architect floor (`atlas.submit_merge_request`'s
 * `v_min_architects`, default 1): a propose/explore-intent submit needs a
 * real reviewer set including at least one architect member. This
 * fixture's own owner can't become one themselves (an org must always keep
 * its sole owner — `org-settings-members.engine.spec.ts`'s own precedent,
 * refusing exactly that self-demotion), so a caller whose scenario submits
 * a propose/explore change for review calls this once, after
 * `bootstrapChangeBranchFixture`, to add a second, real member purely to
 * satisfy that floor — inserted directly as service role rather than
 * through the invite-and-accept UI flow these backend-driven specs have no
 * second `page` for.
 *
 * `pickArchitect` (`src/db/deriveReviewers.ts`) always prefers this real
 * architect over the fixture's own owner once one exists, so the owner's
 * own reviewer row is only ever `optional` — the review never reaches
 * "approved" until this architect actually casts a verdict. A caller whose
 * scenario needs that approval opens a second `browser.newContext()` and
 * signs in as them with the email/password returned here (the pattern
 * `golden-path-propose-review-merge.spec.ts` already uses for its own
 * separately-invited architect).
 */
export async function addArchitectMember(env: Env, orgId: string, invitedBy: string): Promise<ArchitectMember> {
  const service = createServiceRoleClient(env);
  const email = `architect-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw new Error(`addArchitectMember: create user: ${createError.message}`);
  const { error: memberError } = await service.from('members').insert({ org_id: orgId, user_id: created.user.id, role: 'architect', invited_by: invitedBy });
  if (memberError) throw new Error(`addArchitectMember: add member: ${memberError.message}`);
  return { userId: created.user.id, email, password };
}

/**
 * Signs an already-existing user (e.g. the architect `addArchitectMember`
 * creates via `auth.admin.createUser`, never through the sign-up UI) into
 * a fresh `page` through `/sign-in`'s own default "signIn" mode — the
 * counterpart to `acceptInviteViaSignUp`'s sign-*up* flow, needed here
 * because this account's own UI session doesn't exist yet. Their very
 * first sign-in (any route, not just sign-up) hits `DisplayNamePrompt` —
 * `atlas.ensure_profile`'s row exists with `display_name` still null,
 * same gate `acceptInviteViaSignUp` clears via its own "Continue" step —
 * so this clears it too, using a name derived from `email` since nothing
 * else here has one to offer.
 */
export async function signInExistingUser(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const displayNameHeading = page.getByRole('heading', { name: 'What should we call you?' });
  const orgsHeading = page.getByRole('heading', { name: 'Your organisations' });
  await expect(displayNameHeading.or(orgsHeading)).toBeVisible();
  // Home renders "Your organisations" while the profile is still loading and
  // swaps to the prompt once it arrives, so seeing the heading first isn't
  // the answer — wait for the page's own requests to settle before deciding.
  await page.waitForLoadState('networkidle');
  if (await displayNameHeading.isVisible()) {
    await page.getByLabel('Display name').fill(email.split('@')[0] ?? email);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(orgsHeading).toBeVisible();
  }
}

/**
 * Clicks "Submit for review", then (for a propose/explore-intent branch)
 * the `ReviewerPicker` panel that opens below the same button — its own
 * derived set already pre-checks the org's architect (`deriveReviewers.ts`'s
 * `pickArchitect`), so nothing further is needed there. `includeSelf`
 * additionally checks the caller's own signed-in user (the org owner, from
 * `bootstrapChangeBranchFixture` + `addArchitectMember` — exactly two
 * members at this point) when a later step needs them to actually cast a
 * verdict (`atlas.set_review_verdict`'s own "you are not a reviewer on
 * this request" check) — their own row is the first *unchecked* checkbox
 * (earliest-joined), so no display name is needed to find it. With
 * `selfApproves`, it is also made the required reviewer in place of the
 * architect, for a test where the caller's own approval approves.
 * `.last()` on the second click: the outer trigger button keeps the same
 * label and stays mounted once the picker opens.
 */
export async function submitForReviewWithReviewers(page: Page, includeSelf: boolean, options: { selfApproves?: boolean } = {}): Promise<void> {
  await page.getByRole('button', { name: 'Submit for review' }).click();
  // The picker loads its member list first ("Loading reviewers…"); until it
  // has, the only "Submit for review" on the page is the trigger itself, so
  // clicking `.last()` too early just re-clicks the trigger and nothing is
  // submitted. Wait for the picker's own second button.
  await expect(page.getByRole('button', { name: 'Submit for review' })).toHaveCount(2);
  if (includeSelf) {
    await page.getByRole('checkbox', { checked: false }).first().check();
    if (options.selfApproves) {
      // F3a: only *required* reviewers' approvals count, and the picker
      // pre-checks the org's architect as required. When the caller's own
      // approval is meant to be the one that approves, it becomes the
      // required reviewer (an owner counts toward the org's architect floor,
      // 20260926010000) and the architect stays on as optional. The caller's
      // row is listed first (earliest-joined), so its "required" box is first.
      const requiredBoxes = page.getByRole('checkbox', { name: 'required' });
      await expect(requiredBoxes).toHaveCount(2);
      await requiredBoxes.nth(0).check();
      await requiredBoxes.nth(1).uncheck();
    }
  }
  await page.getByRole('button', { name: 'Submit for review' }).last().click();
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
    title: `seed ${systemName}`,
    body: null,
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
