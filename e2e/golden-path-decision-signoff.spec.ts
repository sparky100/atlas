/**
 * Phase C2: sign-off on a frozen decision pack. Click-only from Home.
 * A "just me" organisation has nobody else to sign, so its owner may sign the
 * pack they froze (the two-person refusal is proved in the integration test,
 * with a second signed-in user). This walks: freeze version 1, sign it as the
 * Architecture capacity, see it approved; a material edit frozen as version 2
 * starts unsigned, because a sign-off never carries over to a later version.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signUpCreateOrgAndModel, clickNavItem } from './fixtures/goldenPath';

test('sign a frozen pack as one capacity; a new version starts unsigned', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'decisionsignoff');

  await clickNavItem(page, 'Decisions');
  const decisionTitle = `Sign off the new ledger? ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Title (e.g. What replaces SAP PM?)').fill(decisionTitle);
  await page.getByPlaceholder('Context — why this decision needs making').fill('We need a recorded sign-off before going ahead.');
  await page.getByRole('combobox').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();

  const packs = page.getByTestId('decision-packs');
  await packs.getByRole('button', { name: 'Freeze a pack' }).click();
  await expect(packs.getByText(/Version 1 — frozen .* — not signed yet/)).toBeVisible();

  const form = packs.getByRole('group', { name: 'Sign off version 1' });
  await expect(form.getByRole('button', { name: 'Approve this version' })).toBeDisabled();
  await form.getByLabel('Signing as').selectOption({ label: 'Architecture' });
  await form.getByLabel('Comment (optional)').fill('Fits the target landscape.');
  await form.getByRole('button', { name: 'Approve this version' }).click();
  await expect(packs.getByText(/Version 1 — frozen .* — approved by 1/)).toBeVisible();
  await expect(packs.getByRole('list', { name: 'Sign-offs on version 1' }).getByText(/Architecture: approved .* — Fits the target landscape\./)).toBeVisible();

  // Freezing again makes version 2, which nobody has signed.
  await packs.getByRole('button', { name: 'Freeze as version 2' }).click();
  await expect(packs.getByText(/Version 2 — frozen .* — not signed yet/)).toBeVisible();
  await expect(packs.getByRole('group', { name: 'Sign off version 2' })).toBeVisible();
  await expect(packs.getByRole('group', { name: 'Sign off version 1' })).toHaveCount(0);
});
