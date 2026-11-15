/**
 * UI-principles §3 (2026-10-04, step 3): My work lists what's waiting on
 * the viewer as an owner — their open decisions and the projects they're
 * accountable for — beside the review queue and their own changes.
 * Click-only from Home at 1280 and 390 (S2's rule).
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addCapability, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

async function showView(page: Page, name: 'Overview' | 'My work'): Promise<void> {
  await goToModelHome(page);
  const button = page.getByRole('button', { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

test('My work lists the decisions and projects you own, each opening its own page', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'myworkowned');
  await addCapability(page, 'Housing Repairs');

  // Nothing owned yet.
  await showView(page, 'My work');
  await expect(page.getByRole('heading', { name: 'My decisions' })).toBeVisible();
  await expect(page.getByText('No open decisions of yours.')).toBeVisible();
  await expect(page.getByText('No projects of yours in hand.')).toBeVisible();

  // A project you own, started from Overview.
  const projectTitle = `Repairs replacement ${randomUUID().slice(0, 8)}`;
  await showView(page, 'Overview');
  await page.getByRole('link', { name: 'Start a project', exact: true }).click();
  await page.getByLabel('Project title').fill(projectTitle);
  await page.getByLabel('Architect').selectOption({ index: 1 });
  await page.getByLabel('Target date').fill('2027-03-31');
  await page.getByRole('button', { name: 'Start project' }).click();
  await expect(page.getByRole('heading', { name: projectTitle, level: 1 })).toBeVisible();

  // A decision you own, started from Overview.
  const decisionTitle = `Which repairs system? ${randomUUID().slice(0, 8)}`;
  await showView(page, 'Overview');
  await page.getByRole('link', { name: 'Start a decision', exact: true }).click();
  await page.getByPlaceholder('Title (e.g. What replaces SAP PM?)').fill(decisionTitle);
  await page.getByPlaceholder('Context — why this decision needs making').fill('Mine to decide.');
  await page.getByRole('combobox').first().selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();

  // Both are on My work, under your name.
  await showView(page, 'My work');
  const myDecisions = page.getByRole('list', { name: 'My decisions' });
  const myProjects = page.getByRole('list', { name: 'My projects' });
  await expect(myDecisions.getByRole('link', { name: decisionTitle })).toBeVisible();
  const projectRow = myProjects.getByRole('listitem').filter({ hasText: projectTitle });
  await expect(projectRow.getByText(/target .*2027/)).toBeVisible();
  await expect(projectRow.getByText(/0 open changes · 0 merged · 0 open decisions · 0 decided/)).toBeVisible();

  // Each opens its own page.
  await myDecisions.getByRole('link', { name: decisionTitle }).click();
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();
  await showView(page, 'My work');
  await page.getByRole('list', { name: 'My projects' }).getByRole('link', { name: projectTitle }).click();
  await expect(page.getByRole('heading', { name: projectTitle, level: 1 })).toBeVisible();
});
