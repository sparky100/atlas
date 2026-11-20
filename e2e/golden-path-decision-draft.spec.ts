/**
 * Journey step 3: an unfinished decision survives a refresh, and a frozen pack
 * reads as a document. Click-only from Home at 1280 and 390 like every
 * `golden-path-*` spec. The draft is held in this browser for 24 hours (the
 * 24-hour expiry is covered in `decisionFormDraft.test.ts`); nothing reaches
 * the server until the decision is started. This proves behaviour, not that a
 * business reader finds the pack clearer: that is for the baseline user test.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { clickNavItem, signUpCreateOrgAndModel } from './fixtures/goldenPath';

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
}

const TITLE_PLACEHOLDER = 'Title (e.g. What replaces SAP PM?)';
const CONTEXT_PLACEHOLDER = 'Context — why this decision needs making';

test('a decision you started typing is offered back after a refresh, and is gone once the decision is started', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'decisiondraft');
  await clickNavItem(page, 'Decisions');

  const title = `Same-day connection quotes ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder(TITLE_PLACEHOLDER).fill(title);
  await page.getByPlaceholder(CONTEXT_PLACEHOLDER).fill('Quotes for new connections take two days. We want them the same day.');

  // Interrupted: a refresh empties the form but the words are offered back, and say where they are kept.
  await page.reload();
  await expect(page.getByPlaceholder(TITLE_PLACEHOLDER)).toHaveValue('');
  const restore = page.getByTestId('decision-draft-restore');
  await expect(restore).toContainText(title);
  await expect(restore).toContainText('not saved to Atlas');
  await noOverflow(page);
  await restore.getByRole('button', { name: 'Restore it' }).click();
  await expect(page.getByPlaceholder(TITLE_PLACEHOLDER)).toHaveValue(title);
  await expect(page.getByPlaceholder(CONTEXT_PLACEHOLDER)).toHaveValue(/take two days/);
  await expect(restore).toHaveCount(0);

  // Starting the decision uses it up: another visit does not offer it again.
  await page.getByRole('combobox').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await clickNavItem(page, 'Decisions');
  await expect(page.getByPlaceholder(TITLE_PLACEHOLDER)).toBeVisible();
  await expect(page.getByTestId('decision-draft-restore')).toHaveCount(0);
});

test('a draft can be discarded, and a frozen pack reads as a document with the outcome first', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'decisionpackdoc');
  await clickNavItem(page, 'Decisions');

  await page.getByPlaceholder(TITLE_PLACEHOLDER).fill('Half-written idea');
  await page.reload();
  await page.getByTestId('decision-draft-restore').getByRole('button', { name: 'Discard it' }).click();
  await expect(page.getByTestId('decision-draft-restore')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('decision-draft-restore')).toHaveCount(0);

  const title = `Move quoting to the new tool ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder(TITLE_PLACEHOLDER).fill(title);
  await page.getByPlaceholder(CONTEXT_PLACEHOLDER).fill('Quotes are slow and done by hand.');
  await page.getByRole('combobox').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  const packs = page.getByTestId('decision-packs');
  await packs.getByRole('button', { name: 'Freeze a pack' }).click();
  await packs.getByText(/Version 1 — frozen/).click();
  const doc = packs.getByTestId('pack-document');
  await expect(doc.getByRole('heading', { name: title })).toBeVisible();
  await expect(doc.locator('dt', { hasText: 'Outcome' })).toBeVisible();
  await expect(doc.locator('dd', { hasText: 'Not yet decided' })).toBeVisible();
  await expect(doc.getByRole('heading', { name: 'Context' })).toBeVisible();
  await expect(doc.locator('p', { hasText: 'Quotes are slow and done by hand.' })).toBeVisible();
  // The exact frozen record is still there, one click away.
  await doc.getByText('Show the exact frozen text').click();
  await expect(doc.locator('pre')).toContainText('# ADR:');
  await noOverflow(page);
});
