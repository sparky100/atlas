/**
 * Phase C2: sign-off on a frozen decision pack. Click-only from Home.
 * One signed-in person in an ordinary organisation froze the pack, so the
 * database refuses their own sign-off (the two-person approval, a viewer and
 * another organisation are proved in the integration test, which has several
 * signed-in users). This walks what that person sees: freeze version 1, try
 * to sign it and be told why not, then freeze version 2, which is the latest
 * and so the only version still open to sign.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signUpCreateOrgAndModel, clickNavItem } from './fixtures/goldenPath';

test('the person who froze a pack cannot sign it; only the latest version is open to sign', async ({ page }) => {
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
  await expect(page.getByText(/the person who froze a pack cannot sign it/)).toBeVisible();
  await expect(packs.getByText(/Version 1 — frozen .* — not signed yet/)).toBeVisible();

  // Freezing again makes version 2, which nobody has signed.
  await packs.getByRole('button', { name: 'Freeze as version 2' }).click();
  await expect(packs.getByText(/Version 2 — frozen .* — not signed yet/)).toBeVisible();
  await expect(packs.getByRole('group', { name: 'Sign off version 2' })).toBeVisible();
  await expect(packs.getByRole('group', { name: 'Sign off version 1' })).toHaveCount(0);
});
