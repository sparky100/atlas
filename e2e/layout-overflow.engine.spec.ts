/**
 * Layout audit (Simon, 2026-11-20): no page may scroll sideways, at phone
 * widths (390, 320) or at any desktop width, and a page that is resized
 * down and back up must stay inside the screen the whole way.
 *
 * Deep-links to each page after one sign-up, so this is an engine spec, not
 * user coverage (CLAUDE.md "Coverage"). It checks the document only: a wide
 * table or map that scrolls inside its own box is fine, the page itself
 * sliding sideways is not. Failures are collected (expect.soft) so one run
 * lists every page that overflows, not just the first.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { signUpCreateOrgAndModel } from './fixtures/goldenPath';

const WIDTHS = [320, 390, 768, 900, 1280, 1920];
const RESIZE_STEPS = [1920, 1280, 1024, 900, 768, 600, 390, 320, 600, 1280];

async function overflowBy(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  // Open every settings section so hidden content is measured too.
  const expandAll = page.getByRole('button', { name: 'Expand all' });
  if (await expandAll.count()) await expandAll.click();
}

test('no page scrolls sideways at any width, and resizing keeps it inside the screen', async ({ page }) => {
  test.setTimeout(240_000);
  const { orgSlug, modelSlug } = await signUpCreateOrgAndModel(page, 'layout-overflow');
  const org = `/o/${orgSlug}`;
  const model = `${org}/m/${modelSlug}`;

  // Realistic rows on the members and invites sections: a long address.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${org}/settings`);
  await page.getByRole('button', { name: /^Invite by email/ }).click();
  await page.getByLabel('Email').fill('a.very.long.address.for.a.layout.check+contributor@example-organisation.example');
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText(/a\.very\.long\.address/)).toBeVisible();

  const paths = [
    '/',
    org,
    `${org}/settings`,
    model,
    `${model}/settings`,
    `${model}/work`,
    `${model}/changes`,
    `${model}/projects`,
    `${model}/decisions`,
    `${model}/goals`,
    `${model}/principles`,
    `${model}/elements`,
    `${model}/capability-map`,
    `${model}/landscape`,
    `${model}/roadmap`,
    `${model}/value-streams`,
    `${model}/portfolio`,
    `${model}/integrations`,
    `${model}/gaps`,
    `${model}/versions`,
    `${model}/review`,
    `${model}/reports`,
    `${model}/capture`,
    `${model}/ask`,
    '/profile',
  ];

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of paths) {
      await page.goto(path);
      await settle(page);
      const by = await overflowBy(page);
      expect.soft(by, `${path} at ${String(width)}px scrolls sideways by ${String(by)}px`).toBeLessThanOrEqual(1);
    }
  }

  // Resize the same page down and back up without reloading.
  for (const path of [model, `${org}/settings`, `${model}/work`, `${model}/decisions`]) {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(path);
    await settle(page);
    for (const width of RESIZE_STEPS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);
      const by = await overflowBy(page);
      expect.soft(by, `${path} resized to ${String(width)}px scrolls sideways by ${String(by)}px`).toBeLessThanOrEqual(1);
    }
  }
});
