/**
 * F10 (ADR-024) golden path, click-only from Home at 1280 and 390 (S2's
 * own rule): start a project from Overview's "nothing recorded" tile → start a decision in
 * it → two options → rate → choose → the chosen change is in the project
 * → design it, submit, approve, merge → close the project.
 */
import { compactDecision, optionSurface, ratingControl } from './fixtures/decisionLayout';
import { expect, test, type Page } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, expectNavCurrent, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

const PROJECT_TITLE = 'Meet Housing Repairs';

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
  await expect(page.getByRole('heading', { name: 'Scope', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Housing Repairs' }).first()).toBeVisible();

  // The project remembers which finding it started from, and says so.
  await expect(page.getByTestId('project-source-finding')).toContainText('Started from a health finding: a capability nothing supports.');

  // 2. The page says what to do next, and the decision form is right there in that card.
  const nextStep = page.getByTestId('start-project-decision');
  await expect(page.getByRole('heading', { name: 'Decisions', exact: true })).toBeVisible();
  await expect(nextStep.getByLabel('New decision title')).toHaveValue('How should we meet Housing Repairs?');
  await nextStep.getByLabel('New decision title').fill('Which system supports repairs?');
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: 'Which system supports repairs?' })).toBeVisible();
  await expect(page.getByRole('link', { name: PROJECT_TITLE }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: PROJECT_TITLE, exact: true })).toHaveCount(1);
  await expect(page.getByTestId('decision-source-finding')).toContainText('Started from a health finding: a capability nothing supports.');
  // It starts from where the person came from: the project's purpose is the context, the project's capability is what it concerns, and the edit form is already open.
  await expect(page.getByPlaceholder('What needs deciding, and why now')).not.toHaveValue('');
  await expect(page.getByRole('link', { name: 'Housing Repairs' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Starting points read from the model (no AI): the person adds one, edits it, or ignores them.
  const suggestions = page.getByTestId('option-suggestions');
  await expect(suggestions.getByText('no AI', { exact: false })).toBeVisible();
  await suggestions.getByRole('button', { name: 'Build it ourselves' }).click();
  await expect(page.getByLabel("What's this option?")).toHaveValue('Build it ourselves');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

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
  if (compactDecision(page)) {
    await expect(page.getByTestId('decision-option-card')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  }
  await (await ratingControl(page, 'Build Repairs Hub', 'Cost')).click();
  const editor = page.getByTestId('decision-rating-editor');
  await editor.getByRole('button', { name: 'Low' }).click();
  await editor.getByRole('button', { name: 'Save rating' }).click();
  await expect(editor).toHaveCount(0);
  const hubHeader = optionSurface(page, 'Build Repairs Hub');
  await hubHeader.getByRole('button', { name: 'Choose' }).click();
  await page.getByPlaceholder('The reasons this option was chosen over the others').fill('A dedicated hub is cheaper to run.');
  await page.getByRole('button', { name: 'Confirm choice' }).click();
  await expect(page.getByText('accepted', { exact: true }).first()).toBeVisible();

  // 4. Design the chosen option: work on it as a change and add the system.
  await hubHeader.getByRole('button', { name: 'Work on this option' }).click();
  await expect(page).toHaveURL(/\/changes\//);
  await expect(page.getByRole('button', { name: 'Editing in this change' })).toBeVisible();
  await expect(page.getByRole('link', { name: PROJECT_TITLE }).first()).toBeVisible();
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Repairs Hub', description: 'Schedules and tracks housing repairs.', capabilityName: 'Housing Repairs' });

  // See the draft's impact before it is delivered, using the same
  // capability comparison the project will show after choosing.
  await openProject(page);
  await page.getByRole('link', { name: 'Build Repairs Hub' }).first().click();
  const preview = page.getByTestId('change-impact-preview');
  await expect(preview).toBeVisible();
  await preview.locator('summary').click();
  await expect(preview.getByTestId('project-before-after')).toContainText('Housing Repairs');
  await preview.getByRole('button', { name: 'Diagram' }).click();
  await expect(preview.getByTestId('project-diagram')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);

  // 5. The project shows the decision accepted, the chosen design open,
  // the other option closed, and what the design touches beyond scope.
  await openProject(page);
  await expect(page.getByText('Option chosen', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Build Repairs Hub' }).first()).toBeVisible();
  await expect(page.getByText('Other options remain on the decision page; they are not the chosen design.')).toBeVisible();
  await page.locator('summary', { hasText: 'Review scope against draft changes' }).click();
  await expect(page.getByText('Touched by this project\'s changes, not in scope')).toBeVisible();
  await page.locator('summary', { hasText: 'Compare live model with chosen option' }).click();
  const comparison = page.getByTestId('project-before-after');
  await expect(comparison).not.toContainText('Loading comparison.');
  const alsoSupports = comparison.getByTestId('also-supports');
  if (await alsoSupports.count() > 0) {
    await alsoSupports.first().locator('summary').click();
  }
  await expect(page.getByTestId('project-before-after').getByRole('link', { name: 'Repairs Hub', exact: true }).first()).toBeVisible();
  await page.getByTestId('project-before-after').getByRole('button', { name: 'Diagram' }).click();
  await expect(page.getByTestId('project-before-after').getByTestId('project-diagram').first()).toBeVisible();
  // Closing is refused while the design is open — and the page says what's open.
  await expect(page.getByRole('button', { name: 'Close project' })).toHaveCount(0);
  await page.locator('summary', { hasText: 'Why can’t this project close?' }).click();
  await expect(page.getByText('To close or cancel this project, first finish or cancel what is still open in it:')).toBeVisible();

  // 6. Submit, approve and merge the design (the owner is the required reviewer).
  await page.getByRole('link', { name: 'Build Repairs Hub' }).first().click();
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
  await expect(page.getByText('Merged into live model')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Build Repairs Hub' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Close project' }).click();
  await expect(page.getByText('Closed', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '✎ Edit project' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Project details' })).toBeVisible();

  // No horizontal overflow on the project page (meaningful at 390).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
