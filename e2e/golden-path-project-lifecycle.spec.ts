/**
 * F10 (ADR-024) golden path, click-only from Home at 1280 and 390 (S2's
 * own rule): start a project from Overview's "nothing recorded" tile → start a decision in
 * it → two options → rate → choose → the chosen change is in the project
 * → design it, submit, approve, merge → close the project.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, expectNavCurrent, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

const PROJECT_TITLE = 'Who supports Housing Repairs';

async function openProject(page: Page): Promise<void> {
  await clickNavItem(page, 'Projects');
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: `Open ${PROJECT_TITLE}` }).click();
  await expect(page.getByRole('heading', { name: PROJECT_TITLE, level: 1 })).toBeVisible();
}

test('project lifecycle: start from a finding, decide inside it, deliver the chosen change, close it', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'projectlifecycle');

  // A capability nothing supports — flagged "nothing recorded" on Overview, that
  // finding's one home (UI-principles §3).
  await addCapability(page, 'Housing Repairs');
  await goToModelHome(page);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();

  // 1. Start a project from the finding: the form opens already filled in.
  await page.getByRole('link', { name: 'Start a project →' }).click();
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
  await expect(page.getByLabel('Project title')).toHaveValue(PROJECT_TITLE);
  await expect(page.getByRole('button', { name: 'Remove Housing Repairs' })).toBeVisible();
  await page.getByLabel('Architect').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start project' }).click();
  await expect(page.getByRole('heading', { name: PROJECT_TITLE, level: 1 })).toBeVisible();
  await expectNavCurrent(page, 'Projects');
  const scopePanel = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Declared scope' }) }).last();
  await expect(scopePanel.getByRole('link', { name: 'Housing Repairs' })).toBeVisible();

  // 2. A decision inside the project.
  await page.getByLabel('New decision title').fill('Which system supports repairs?');
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: 'Which system supports repairs?' })).toBeVisible();
  await expect(page.getByRole('link', { name: PROJECT_TITLE })).toBeVisible();

  // 3. Two options, one rating, choose the first.
  for (const [, title] of [
    ['repairs-hub', 'Build Repairs Hub'],
    ['extend-crm', 'Extend the CRM'],
  ] as const) {
    await page.getByRole('button', { name: '+ Add an option' }).click();
    await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill(title);
    await page.getByRole('button', { name: 'Add option' }).click();
    await expect(page.getByText(title).first()).toBeVisible();
  }
  const criteriaTable = page.getByTestId('decision-criteria-grid').locator('table');
  const headers = await criteriaTable.locator('th').allTextContents();
  const hubColumn = headers.findIndex((h) => h.includes('Build Repairs Hub'));
  expect(hubColumn).toBeGreaterThan(0);
  await criteriaTable.locator('tr', { hasText: 'Cost' }).locator('button').nth(hubColumn - 1).click();
  const editor = page.getByTestId('decision-rating-editor');
  await editor.getByRole('button', { name: 'Low' }).click();
  await editor.getByRole('button', { name: 'Save rating' }).click();
  await expect(editor).toHaveCount(0);

  const hubHeader = criteriaTable.locator('th').nth(hubColumn);
  await hubHeader.getByRole('button', { name: 'Choose' }).click();
  await page.getByPlaceholder('The reasons this option was chosen over the others').fill('A dedicated hub is cheaper to run.');
  await page.getByRole('button', { name: 'Confirm choice' }).click();
  await expect(page.getByText('accepted', { exact: true }).first()).toBeVisible();

  // 4. Design the chosen option: work on it as a change and add the system.
  await hubHeader.getByRole('button', { name: 'Work on this as a change' }).click();
  await expect(page.getByRole('button', { name: 'Editing in this change' })).toBeVisible();
  await expect(page.getByRole('link', { name: PROJECT_TITLE })).toBeVisible();
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Repairs Hub', description: 'Schedules and tracks housing repairs.', capabilityName: 'Housing Repairs' });

  // 5. The project shows the decision accepted, the chosen design open,
  // the other option closed, and what the design touches beyond scope.
  await openProject(page);
  await expect(page.getByRole('region', { name: 'Chosen design' }).getByRole('link', { name: 'Build Repairs Hub' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Closed without merging' }).getByRole('link', { name: 'Extend the CRM' })).toBeVisible();
  await expect(page.getByText('Touched by this project\'s changes, not in scope')).toBeVisible();
  // The system now also appears in the before/after panel, so match the first link on the page.
  await expect(page.getByRole('link', { name: 'Repairs Hub', exact: true }).first()).toBeVisible();
  // Closing is refused while the design is open — and the page says what's open.
  await expect(page.getByRole('button', { name: 'Close project' })).toHaveCount(0);
  await expect(page.getByText('To close or cancel this project, first finish or cancel what is still open in it:')).toBeVisible();

  // 6. Submit, approve and merge the design (the owner is the required reviewer).
  await page.getByRole('region', { name: 'Chosen design' }).getByRole('link', { name: 'Build Repairs Hub' }).click();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByRole('button', { name: 'Submit for review' })).toHaveCount(2);
  const unchecked = page.getByRole('checkbox', { checked: false });
  if ((await unchecked.count()) > 0) await unchecked.first().check();
  await page.getByRole('button', { name: 'Submit for review' }).last().click();
  // Submitting lands on the review request's own page.
  await expect(page.getByRole('heading', { name: 'Review request', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('approved', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Merge' }).click();
  await expect(page.getByText('merged', { exact: true }).first()).toBeVisible();

  // 7. Nothing is open any more: close the project.
  await goToModelHome(page);
  await openProject(page);
  await expect(page.getByRole('region', { name: 'Merged' }).getByRole('link', { name: 'Build Repairs Hub' })).toBeVisible();
  await page.getByRole('button', { name: 'Close project' }).click();
  await expect(page.getByText('Closed', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '✎ Edit project' })).toHaveCount(0);

  // No horizontal overflow on the project page (meaningful at 390).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
