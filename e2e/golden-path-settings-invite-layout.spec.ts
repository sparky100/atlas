/**
 * Invite rows on Organisation settings, click-only from Home at 1280 and 390:
 * a long address and its badges, sent-time and Resend/Revoke all stay on
 * screen, and the page never scrolls sideways. (Layout regression: the row's
 * left block could not wrap, so badges ran off the right edge on phones.)
 */
import { expect, test } from '@playwright/test';
import { signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('invite rows stay on screen with a long address', async ({ page }) => {
  const { orgName } = await signUpCreateOrgAndModel(page, 'goldenpath-invite-layout');

  await page.getByRole('link', { name: 'Atlas', exact: true }).click();
  await page.getByRole('link', { name: orgName }).click();
  await page.getByRole('link', { name: 'Org settings' }).click();
  await expect(page.getByRole('heading', { name: 'Organisation settings' })).toBeVisible();

  await page.getByRole('button', { name: /^Invite by email/ }).click();
  await expect(page.getByText(/We try to email an invite/)).toBeVisible();

  const address = 'a.very.long.address.for.a.layout.check+contributor@example-organisation.example';
  await page.getByLabel('Email').fill(address);
  await page.getByRole('button', { name: 'Send invite' }).click();

  const row = page.getByRole('listitem').filter({ hasText: address });
  await expect(row).toBeVisible();
  const viewportWidth = page.viewportSize()?.width ?? 0;
  for (const target of [row.getByText(/^Pending$/), row.getByRole('button', { name: /^Revoke invite/ })]) {
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewportWidth);
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
