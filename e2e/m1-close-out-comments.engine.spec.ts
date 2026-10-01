/**
 * M1 close-out item 3: "Playwright: comment on an element from a branch
 * view, merge, see it on main; mention a member and see it in the tray."
 *
 * Two things this test proves end-to-end, through the real UI, that
 * `comments.integration.test.ts` only proves at the API level:
 *  1. A comment posted on an element that exists only on a draft change
 *     branch (not yet on main) is visible there, survives the branch's
 *     merge, and reads on main's own element page afterward — the same
 *     acceptance criterion `comments.integration.test.ts`'s own "a comment
 *     on a branch element survives merge to main" case already covers,
 *     now through Post/Approve/Merge buttons instead of direct RPC calls.
 *  2. `@mention`ing a fellow member in that comment's body puts a
 *     notification in their own tray — a second real browser session,
 *     signed in as them, same pattern e2e/add-a-system-flow.spec.ts's own
 *     "propose a change" test already uses for a second real user.
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { getProfile } from '../src/db/profiles';
import { addArchitectMember, bootstrapChangeBranchFixture, submitForReviewWithReviewers } from './fixtures/changeBranchFixture';

test('comment on a branch-only element, merge the change, see the comment on main; mentioning a member notifies their tray', async ({ page, browser }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'm1closeout', 'Existing System');
  const { signedIn: owner, userId: ownerId, orgId, orgSlug, modelId, modelSlug, seedSourceId } = fixture;
  // F3a's own architect floor — see addArchitectMember's own doc comment.
  // The owner needs to be in the reviewer set too: they cast the approve
  // verdict below. `submitForReviewWithReviewers`'s own "first unchecked
  // checkbox" trick still finds the owner correctly with bob (a third,
  // non-architect member, added below) also in the org — the owner is
  // always the earliest-joined member (`listMembers`'s own `order('joined_at')`),
  // so their row is always first regardless of how many others exist.
  await addArchitectMember(env, orgId, ownerId);

  // A second real member, in their own browser session — the mention
  // target whose own tray this test checks. Added directly (`members_insert`'s
  // RLS lets an owner insert any member row) — there's no invite UI yet
  // (SPEC §11), same as e2e/add-a-system-flow.spec.ts's own contributor.
  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  const bobEmail = `m1closeout-bob-${randomUUID()}@example.test`;
  const bobPassword = `${randomUUID()}Aa1!`;
  await bobPage.goto('/sign-in');
  await bobPage.getByText("Don't have an account? Create one").click();
  await bobPage.getByLabel('Email').fill(bobEmail);
  await bobPage.getByLabel('Password').fill(bobPassword);
  await bobPage.getByRole('button', { name: 'Create account' }).click();
  await expect(bobPage.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const bob = createSupabaseClient(env);
  const { error: bobSignInError } = await bob.auth.signInWithPassword({ email: bobEmail, password: bobPassword });
  if (bobSignInError) throw new Error(`m1closeout bob sign-in: ${bobSignInError.message}`);
  const { data: bobUserData, error: getBobError } = await bob.auth.getUser();
  if (getBobError) throw new Error(`m1closeout: could not read bob's user: ${getBobError.message}`);
  const bobId = bobUserData.user.id;

  const { error: memberError } = await owner.from('members').insert({ org_id: orgId, user_id: bobId, role: 'contributor', invited_by: ownerId });
  if (memberError) throw new Error(`m1closeout: could not add bob as a member: ${memberError.message}`);
  const bobProfile = await getProfile(owner, bobId);
  if (!bobProfile) throw new Error('atlas.ensure_profile did not create a profile for bob');

  // 1. Create the change branch through the real "Changes" form.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  const changeName = `add-draft-system-${randomUUID().slice(0, 8)}`;
  const changeTitle = 'Add a draft-only system';
  await page.getByPlaceholder('Name (e.g. retire-legacy-crm)').fill(changeName);
  await page.getByPlaceholder('Title (e.g. Retire the legacy CRM)').fill(changeTitle);
  await page.getByRole('button', { name: 'Create change' }).click();
  // Sticky ref: a successful create lands inside the new change's own page
  // directly — no separate "find the row, click Open →" step needed.
  await expect(page.getByRole('heading', { name: changeTitle })).toBeVisible();
  const branchIdMatch = /\/changes\/([^/?]+)/.exec(page.url());
  if (!branchIdMatch?.[1]) throw new Error(`could not read the branch id out of ${page.url()}`);
  const branchId = branchIdMatch[1];

  // A system that exists on this branch only, seeded directly onto its own
  // head (Node-side — this test is about the comment/merge UI, not the
  // system-creation UI e2e/add-a-system-flow.spec.ts already covers).
  const branch = await getBranch(owner, branchId);
  if (!branch?.head_commit_id) throw new Error('change branch has no head commit');
  const draftSystemId = randomUUID();
  const draftSystemName = 'Draft-Only System';
  const draftDeltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: draftSystemId, elementType: 'system', name: draftSystemName, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
  ];
  const draftEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: branch.id,
    parentCommitId: branch.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: `add ${draftSystemName}`,
    body: null,
    deltas: draftDeltas,
  };
  const draftResult = await commitToBranch(owner, { modelId, branchId: branch.id, expectedHeadCommitId: branch.head_commit_id, envelope: draftEnvelope });
  if (!draftResult.ok) throw new Error(`m1closeout seeding the draft system: ${draftResult.message}`);

  // Not on main yet — the whole premise of "a comment on a branch element"
  // being distinct from an ordinary one (`useElementPage.ts`'s own
  // `notPresentAtRef` state, ElementPage.tsx's own rendering of it).
  // An element page with nothing to show at this ref sends you back rather
  // than leaving a dead end (#313) — so its heading never settles here.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${draftSystemId}`);
  await expect(page).not.toHaveURL(new RegExp(`/e/${draftSystemId}$`), { timeout: 15_000 });

  // 2. Comment on it from the branch's own view, mentioning bob.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${draftSystemId}?ref=branch:${branchId}`);
  await expect(page.getByRole('heading', { name: draftSystemName })).toBeVisible();
  const commentsSection = page.locator('section').filter({ has: page.getByRole('button', { name: /^Comments/ }) });
  await commentsSection.scrollIntoViewIfNeeded();
  // Trailing text after the mention, not the comment's very last word —
  // `activeMentionQuery` (src/ui/comments/mentionAutocomplete.ts) treats a
  // cursor sitting right at the end of an `@handle` as still mid-mention,
  // which would leave the suggestions dropdown open (and intercepting the
  // click below) after a plain `.fill()`.
  const commentBody = `@${bobProfile.handle} — worth a look before we merge this.`;
  await commentsSection.getByPlaceholder('Write a comment…').fill(commentBody);
  await expect(commentsSection.getByText(`Will notify: @${bobProfile.handle}`)).toBeVisible();
  await commentsSection.getByRole('button', { name: 'Post' }).click();
  await expect(commentsSection.getByText(commentBody)).toBeVisible();
  // The root's own "on change: <title>" tag (comments.branch_id, display
  // metadata only — CommentThread.tsx's own comment) confirms this comment
  // really is branch-scoped, not a coincidence of the anchor matching.
  await expect(commentsSection.getByText(`on change: ${changeTitle}`)).toBeVisible();

  // 3. Bob's own tray, in his own session, sees the mention — before the
  // change is even submitted for review, since mentions notify off the
  // comment itself, never off merge state.
  await bobPage.goto(`/o/${orgSlug}/m/${modelSlug}`);
  const bobTrayToggle = bobPage.getByRole('button', { name: /Notifications/ });
  await expect(bobTrayToggle).toBeVisible({ timeout: 15_000 });
  await bobTrayToggle.click();
  // The tray truncates a long body to 80 chars (`truncateNotificationBody`,
  // src/ui/comments/notificationFormat.ts) — bob's own handle alone can run
  // past a third of that, so this checks the guaranteed-untruncated start
  // of the body (the `@mention` itself, at position 0) plus the "mentioned
  // you" wording, rather than the full sentence.
  await expect(bobPage.getByText('mentioned you', { exact: false })).toBeVisible();
  await expect(bobPage.getByText(`@${bobProfile.handle}`, { exact: false })).toBeVisible();

  // 4. Submit, approve, merge (the same real flow e2e/change-branch-merge.spec.ts
  // exercises for an attribute edit — here for a whole new element instead).
  // Back to the change's own page — step 2 above left `page` on the
  // element page instead.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}`);
  await submitForReviewWithReviewers(page, true, { selfApproves: true });
  await expect(page).toHaveURL(new RegExp(`/o/${orgSlug}/m/${modelSlug}/review/`));
  await expect(page.getByText('pending', { exact: true }).first()).toBeVisible();
  const approveButton = page.getByRole('button', { name: 'Approve' });
  await expect(approveButton).toBeEnabled();
  await approveButton.click();
  await expect(page.getByText('approved', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Merge' }).click();
  await expect(page.getByText('merged', { exact: true }).first()).toBeVisible();

  // 5. Now on main: the same element, the same comment, still there.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${draftSystemId}`);
  await expect(page.getByRole('heading', { name: draftSystemName })).toBeVisible();
  const mainCommentsSection = page.locator('section').filter({ has: page.getByRole('button', { name: /^Comments/ }) });
  await mainCommentsSection.scrollIntoViewIfNeeded();
  await expect(mainCommentsSection.getByText(commentBody)).toBeVisible();

  await bobContext.close();
});
