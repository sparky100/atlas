/**
 * UI-principles §3 (2026-10-04): Overview's middle section is "What we're
 * doing" — projects in hand and the open decisions that belong to no
 * project — and its only create controls start a project or a decision.
 * A change outside any project never appears there. Click-only from Home
 * at 1280 and 390 (S2's rule).
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addCapability, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

async function showOverview(page: Page): Promise<void> {
  await goToModelHome(page);
  const overview = page.getByRole('button', { name: 'Overview', exact: true });
  await overview.click();
  await expect(overview).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: "What we're doing" })).toBeVisible();
}

test("Overview's \"What we're doing\" shows a project and a decision outside any project, started from its own buttons — never a change", async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'overviewwork');
  // Overview's weakness grid needs a capability on the map before the rest
  // of the page renders (an empty map shows the starter-map picker).
  await addCapability(page, 'Housing Repairs');

  await showOverview(page);
  await expect(page.getByText('No projects or open decisions right now.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Propose a change' })).toHaveCount(0);

  // A project, from Overview's own "Start a project".
  const projectTitle = `Repairs replacement ${randomUUID().slice(0, 8)}`;
  await page.getByRole('link', { name: 'Start a project', exact: true }).click();
  await page.getByLabel('Project title').fill(projectTitle);
  await page.getByLabel('Owner').selectOption({ index: 1 });
  await page.getByLabel('Target date').fill('2027-03-31');
  await page.getByRole('button', { name: 'Start project' }).click();
  await expect(page.getByRole('heading', { name: projectTitle, level: 1 })).toBeVisible();

  // A portfolio-level decision, from Overview's own "Start a decision".
  await showOverview(page);
  const decisionTitle = `Standardise on one cloud? ${randomUUID().slice(0, 8)}`;
  await page.getByRole('link', { name: 'Start a decision', exact: true }).click();
  await page.getByPlaceholder('Title (e.g. What replaces SAP PM?)').fill(decisionTitle);
  await page.getByPlaceholder('Context — why this decision needs making').fill('A portfolio-level choice, no project.');
  await page.getByRole('combobox').first().selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();

  // A change in no project: housekeeping, never on Overview.
  const changeName = `fix-typo-${randomUUID().slice(0, 8)}`;
  await clickNavItem(page, 'Changes');
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Create change' }) });
  await form.getByPlaceholder('Name (e.g. retire-legacy-crm)').fill(changeName);
  await form.getByRole('combobox').first().selectOption('correct');
  await form.getByRole('button', { name: 'Create change' }).click();
  await expect(page.getByRole('heading', { name: /Correction/ })).toBeVisible();

  await showOverview(page);
  const projectRow = page.getByRole('list', { name: 'Projects in hand' }).getByRole('listitem').filter({ hasText: projectTitle });
  await expect(projectRow.getByRole('link', { name: projectTitle })).toBeVisible();
  await expect(projectRow.getByText(/target .*2027/)).toBeVisible();
  await expect(projectRow.getByText('0 open changes · 0 merged · 0 open decisions · 0 decided')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Decisions outside a project' }).getByRole('link', { name: decisionTitle })).toBeVisible();
  // (The page's own "Editing in change" banner still names it — that's the
  // session's selected change, not Overview content.)
  const whatWeAreDoing = page.getByRole('region', { name: "What we're doing" });
  await expect(whatWeAreDoing.getByText(projectTitle)).toBeVisible();
  await expect(whatWeAreDoing.getByText(changeName)).toHaveCount(0);

  // The project row opens the project's own page.
  await projectRow.getByRole('link', { name: projectTitle }).click();
  await expect(page.getByRole('heading', { name: projectTitle, level: 1 })).toBeVisible();
});

test("a weak tile says what's in hand: nothing at first, then the project started from it — and stops offering to start another", async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'overviewinhand');
  await addCapability(page, 'Housing Repairs');

  // A capability nothing supports is weak; nothing is addressing it yet.
  await showOverview(page);
  const tileCard = page.getByRole('link', { name: /Housing Repairs/ }).first().locator('xpath=..');
  await expect(tileCard.getByText('Nothing in hand')).toBeVisible();

  // Start a project from the tile itself — its scope is already the capability.
  await tileCard.getByRole('link', { name: 'Start a project →' }).click();
  await expect(page.getByLabel('Project title')).toHaveValue('Who supports Housing Repairs');
  await page.getByLabel('Owner').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start project' }).click();
  await expect(page.getByRole('heading', { name: 'Who supports Housing Repairs', level: 1 })).toBeVisible();

  // Back on Overview: the tile names the project and offers nothing to start.
  await showOverview(page);
  const card = page.getByRole('link', { name: /Housing Repairs/ }).first().locator('xpath=..');
  await expect(card.getByText('In hand:')).toBeVisible();
  await expect(card.getByText('Nothing in hand')).toHaveCount(0);
  await expect(card.getByRole('link', { name: 'Start a project →' })).toHaveCount(0);
  await expect(card.getByRole('link', { name: 'Start a decision →' })).toHaveCount(0);

  // The project link opens the project.
  await card.getByRole('link', { name: 'Project: Who supports Housing Repairs' }).click();
  await expect(page.getByRole('heading', { name: 'Who supports Housing Repairs', level: 1 })).toBeVisible();
});

test("What's recent lists a project closed since the last version, and it leaves What we're doing", async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'overviewrecent');
  await addCapability(page, 'Housing Repairs');

  await showOverview(page);
  await expect(page.getByText('No decisions made or projects closed yet.')).toBeVisible();

  // A project, started and closed with nothing open in it.
  const projectTitle = `Repairs pilot ${randomUUID().slice(0, 8)}`;
  await page.getByRole('link', { name: 'Start a project', exact: true }).click();
  await page.getByLabel('Project title').fill(projectTitle);
  await page.getByLabel('Owner').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start project' }).click();
  await expect(page.getByRole('heading', { name: projectTitle, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Close project' }).click();
  await expect(page.getByText('Closed', { exact: true }).first()).toBeVisible();

  await showOverview(page);
  const recent = page.getByRole('list', { name: 'Decided and closed' });
  const row = recent.getByRole('listitem').filter({ hasText: projectTitle });
  await expect(row.getByRole('link', { name: projectTitle })).toBeVisible();
  await expect(row.getByText(/^Project closed /)).toBeVisible();
  await expect(page.getByRole('region', { name: "What we're doing" }).getByText(projectTitle)).toHaveCount(0);

  await row.getByRole('link', { name: projectTitle }).click();
  await expect(page.getByRole('heading', { name: projectTitle, level: 1 })).toBeVisible();
});
