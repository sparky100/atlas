/**
 * S2 flow 8 (docs/prompts/atlas-prompt-pack.md): "comment on an element
 * from a change's view, mention a member, see it in the tray, resolve
 * after merge." Click-only from Home; the second member is added via the
 * real invite-by-email UI (`inviteMemberFromHome`/`acceptInviteViaSignUp`),
 * not `members.insert` — the shortcut `m1-close-out-comments.spec.ts` uses
 * for its own, narrower purpose.
 */
import { expect, test } from '@playwright/test';
import { acceptInviteViaSignUp, addSystemFromHome, goToModelHome, inviteMemberFromHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('comment on an element from a change\'s view, mention a member, see it in their tray, resolve after merge', async ({ page, browser }) => {
  const { orgName } = await signUpCreateOrgAndModel(page, 'goldenpath8');

  const bobEmail = `goldenpath8-bob-${String(Date.now())}@example.test`;
  const bobDisplayName = 'Bob Reviewer';
  await inviteMemberFromHome(page, orgName, bobEmail, 'contributor');

  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await acceptInviteViaSignUp(bobPage, bobEmail, bobDisplayName);

  // Back as the owner: into the model, a change, and a draft-only system.
  // `inviteMemberFromHome` leaves `page` on Org settings, not OrgHome.
  await page.getByRole('link', { name: 'Atlas' }).click();
  await page.getByRole('link', { name: orgName }).click();
  await page.getByRole('link', { name: /goldenpath8 Model/ }).click();
  await page.getByRole('link', { name: 'Changes' }).click();
  const changeTitle = 'Add a draft-only system';
  await page.getByPlaceholder('Name (e.g. retire-legacy-crm)').fill('add-draft-system');
  await page.getByPlaceholder('Title (e.g. Retire the legacy CRM)').fill(changeTitle);
  await page.getByRole('button', { name: 'Create change' }).click();
  await expect(page.getByRole('heading', { name: changeTitle })).toBeVisible();

  // Creating a change lands on the change's own page, not Home — "Home"
  // (ModelNav) while the change is still selected as the active ref is
  // where the create-a-system front door actually lives.
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Draft-Only System', description: 'Only exists on this change.' });

  // Comment on it, mentioning Bob — "@" alone lists every fellow member;
  // with only one other member, his own row is the only suggestion.
  const commentsSection = page.locator('section').filter({ has: page.getByRole('button', { name: /^Comments/ }) });
  await commentsSection.scrollIntoViewIfNeeded();
  const commentBox = commentsSection.getByPlaceholder('Write a comment…');
  await commentBox.fill('@');
  // `.evaluate(el => el.click())`, not a real pointer click — below
  // 768px, ModelNav's own fixed bottom bar (its own ref chip specifically)
  // sits over this dropdown's own screen position, so even Playwright's
  // `force: true` (which still performs a real, hit-tested browser click
  // at that point) lands on the covering chip instead. Invoking the
  // button's own `click()` method directly is the one way to fire its
  // real handler regardless of what's visually on top of it.
  await commentsSection.getByRole('listbox').getByText(bobDisplayName).evaluate((el) => { el.closest('button')?.click(); });
  await commentBox.pressSequentially(' — worth a look before we merge this.');
  await expect(commentsSection.getByText('Will notify:', { exact: false })).toBeVisible();
  await commentsSection.getByRole('button', { name: 'Post' }).click();
  await expect(commentsSection.getByText('worth a look before we merge this.')).toBeVisible();
  await expect(commentsSection.getByText(`on change: ${changeTitle}`)).toBeVisible();

  // Bob's own tray, in his own session, sees the mention.
  await bobPage.getByRole('button', { name: /Notifications/ }).click({ timeout: 15_000 });
  await expect(bobPage.getByText('mentioned you', { exact: false })).toBeVisible();

  // Submit, approve, merge.
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('pending', { exact: true })).toBeVisible();
  const approveButton = page.getByRole('button', { name: 'Approve' });
  await expect(approveButton).toBeEnabled();
  await approveButton.click();
  await expect(page.getByText('approved', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Merge' }).click();
  await expect(page.getByText('merged', { exact: true }).first()).toBeVisible();

  // Resolve the comment now that it's on main.
  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('Draft-Only System');
  // Scoped to `HomeSearch.tsx`'s own results `<ul>` — a bare name match
  // also catches Home's "Recent activity" list, which can carry an
  // unrelated "Merge: Add a draft-only system" entry (a case-insensitive
  // substring match), and the result's own full accessible name includes
  // trailing lifecycle/relationship-count text, not just the bare name.
  await page.locator('[class*="results"]').getByRole('link', { name: /Draft-Only System/ }).click();
  const mainCommentsSection = page.locator('section').filter({ has: page.getByRole('button', { name: /^Comments/ }) });
  await mainCommentsSection.scrollIntoViewIfNeeded();
  await expect(mainCommentsSection.getByText('worth a look before we merge this.')).toBeVisible();
  await mainCommentsSection.getByRole('button', { name: 'Resolve' }).click();
  await expect(mainCommentsSection.getByText('1 resolved thread', { exact: false })).toBeVisible();

  await bobContext.close();
});
