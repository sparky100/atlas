/**
 * Sprint 7j item 1: model settings' Archive/Restore/Delete. "Playwright:
 * archive and restore; delete an archived model" (the prompt's own item 5
 * — the role-gated half of restore, owner vs. architect, is asserted here
 * too rather than only in the roleGates unit tests, since the real UI gate
 * is what a user actually hits).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createSupabaseClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('archive a model, see it move to the collapsed Archived section, restore it as the owner', async ({ page, browser }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'modelsettings', 'Placeholder System');
  const { signedIn: owner, orgId, orgSlug, modelSlug, userId: ownerId } = fixture;

  // An architect, added directly (same members_insert pattern every other
  // spec in this suite uses — no invite UI yet) — to prove restore is
  // owner-only, narrower than archive.
  const architectContext = await browser.newContext();
  const architectPage = await architectContext.newPage();
  const architectEmail = `modelsettings-architect-${randomUUID()}@example.test`;
  const architectPassword = `${randomUUID()}Aa1!`;
  await architectPage.goto('/sign-in');
  await architectPage.getByText("Don't have an account? Create one").click();
  await architectPage.getByLabel('Email').fill(architectEmail);
  await architectPage.getByLabel('Password').fill(architectPassword);
  await architectPage.getByRole('button', { name: 'Create account' }).click();
  await expect(architectPage.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const architectAuth = createSupabaseClient(env);
  const { error: signInError } = await architectAuth.auth.signInWithPassword({ email: architectEmail, password: architectPassword });
  if (signInError) throw new Error(`model-settings fixture architect sign-in: ${signInError.message}`);
  const { data: architectData, error: getUserError } = await architectAuth.auth.getUser();
  if (getUserError) throw new Error(`model-settings fixture: could not read the architect user: ${getUserError.message}`);
  const { error: memberError } = await owner.from('members').insert({ org_id: orgId, user_id: architectData.user.id, role: 'architect', invited_by: ownerId });
  if (memberError) throw new Error(`model-settings fixture: could not add architect: ${memberError.message}`);

  // 1. Owner opens model settings via the overflow menu.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await page.getByRole('button', { name: 'Model actions' }).click();
  await page.getByRole('link', { name: 'Model settings' }).click();
  await expect(page.getByRole('heading', { name: 'Model settings' })).toBeVisible();

  // 2. Rename — saving reloads the page (ModelSettingsPage.tsx's own
  // onChanged), so the real proof is the input's own value on the fresh
  // load, not a text node (an <input>'s value is never one).
  const newName = `Renamed Model ${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Name').fill(newName);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Model settings' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Name')).toHaveValue(newName);

  // 3. Archive — another round trip + reload.
  await page.getByRole('button', { name: 'Archive model' }).click();
  await expect(page.getByText('Archived', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Restore model' })).toBeVisible();

  // 4. Hidden from OrgHome's ordinary list, present in the collapsed
  // "Archived" section — the row's own name is enough proof; "Archived"
  // as bare text is ambiguous here (the section's own disclosure title
  // reads "Archived" too, matching CollapsibleSection.tsx's own title
  // prop — this row's `Text` is the real check, not a second exact-text
  // match against a section heading that happens to say the same word).
  await page.goto(`/o/${orgSlug}`);
  await expect(page.getByText(newName)).toHaveCount(0);
  await page.getByRole('button', { name: /Archived/ }).click();
  await expect(page.getByText(newName)).toBeVisible();

  // 5. A direct link still resolves, read-only — item 1's own "read-only
  // when opened" requirement, distinct from "hidden from lists".
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/settings`);
  await expect(page.getByLabel('Name')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);

  // 6. Restore is owner-only: the architect sees no Restore control at all.
  await architectPage.goto(`/o/${orgSlug}/m/${modelSlug}/settings`);
  await expect(architectPage.getByRole('button', { name: 'Restore model' })).toHaveCount(0);
  await expect(architectPage.getByText('Only an owner can restore an archived model.')).toBeVisible();

  // 7. The owner restores it — back in the ordinary list.
  await page.getByRole('button', { name: 'Restore model' }).click();
  await expect(page.getByRole('heading', { name: 'Model settings' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Archived', { exact: true })).toHaveCount(0);
  await page.goto(`/o/${orgSlug}`);
  await expect(page.getByText(newName)).toBeVisible();
});

test('delete refuses a model that is not archived; archiving first and typing the name deletes it for good', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'modelsettingsdelete', 'Placeholder System');
  const { orgSlug, modelSlug } = fixture;

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/settings`);
  // Not archived yet — Delete isn't offered at all (the prompt's own "only
  // when archived"), not shown-then-refused.
  await expect(page.getByRole('button', { name: 'Delete model' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Archive model' }).click();
  await expect(page.getByText('Archived', { exact: true })).toBeVisible({ timeout: 15_000 });

  const modelName = await page.getByLabel('Name').inputValue();
  const confirmInput = page.getByLabel(`Type ${modelName} to confirm`);
  const deleteButton = page.getByRole('button', { name: 'Delete model' });
  await expect(deleteButton).toBeDisabled();
  await confirmInput.fill('the wrong name');
  await expect(deleteButton).toBeDisabled();
  await confirmInput.fill(modelName);
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();

  // Deleted for good — not even in the Archived section.
  await expect(page).toHaveURL(new RegExp(`/o/${orgSlug}$`));
  await expect(page.getByText(modelName)).toHaveCount(0);
});
