/**
 * Decision "What to do next" (Simon, 2026-11-20): the decision page says what
 * to do next and Home tells an owner that a decision is open. Click-only from
 * Home at 1280 and 390. The contributor wording and the handoff are covered
 * by unit tests (decisionNextStep.test.ts); this spec covers the owner's path.
 */
import { expect, test } from '@playwright/test';
import { clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('a decision tells the owner what to do next, and Home says it is open', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'decisionnext');

  await clickNavItem(page, 'Decisions');
  const decisionTitle = `Which replaces the quote tool? ${Date.now().toString()}`;
  await page.getByPlaceholder('Title (e.g. What replaces SAP PM?)').fill(decisionTitle);
  await page.getByPlaceholder('Context — why this decision needs making').fill('The quote tool is slow.');
  await page.getByRole('combobox').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();

  const card = page.getByTestId('decision-next-step');
  await expect(card).toContainText('What to do next');
  await expect(card).toContainText('Add the options');

  for (const title of ['Option 1', 'Option 2']) {
    await page.getByRole('button', { name: '+ Add an option' }).click();
    await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill(title);
    await page.getByRole('button', { name: 'Add option' }).click();
    await expect(page.getByText(title).first()).toBeVisible();
  }
  await expect(card).toContainText('Choose an option');
  await expect(card).toContainText('0 of 2 options rated');
  await expect(card.getByRole('button', { name: 'Review what changes' })).toBeVisible();
  // Read the option, then its effect, then the optional AI questions.
  const inReadingOrder = await page.evaluate(() => {
    const option = document.getElementById('decision-compare');
    const changes = document.getElementById('decision-effects');
    const review = document.getElementById('second-opinion');
    return option !== null && changes !== null && review !== null &&
      Boolean(option.compareDocumentPosition(changes) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      Boolean(changes.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(inReadingOrder).toBe(true);

  await goToModelHome(page);
  await expect(page.getByTestId('decisions-waiting-for-you')).toContainText('1 decision is open and needs a choice');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
