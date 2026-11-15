/**
 * F13 step 2 golden path — click-only from Home, at 1280 and 390: start a
 * project from a finding, decide inside it (two options, a rating, a
 * choice with reasons), design the chosen change, attach evidence, then
 * download the project pack as Markdown and PDF and check the Markdown
 * holds every section — purpose, scope, the decision as an ADR, the
 * change's target state, the evidence link.
 */
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

const PROJECT_TITLE = 'Who supports Housing Repairs';

async function openProject(page: Page): Promise<void> {
  await clickNavItem(page, 'Projects');
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: `Open ${PROJECT_TITLE}` }).click();
  await expect(page.getByRole('heading', { name: PROJECT_TITLE, level: 1 })).toBeVisible();
}

async function download(page: Page, button: string): Promise<{ name: string; bytes: Buffer }> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  const file = await downloadPromise;
  return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) };
}

test('project pack: decide and design inside a project, attach evidence, download the pack as Markdown and PDF', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'projectpack');

  await addCapability(page, 'Housing Repairs');
  await goToModelHome(page);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();

  // A project from the finding, its scope already filled in.
  await page.getByRole('link', { name: 'Start a project →' }).click();
  await expect(page.getByLabel('Project title')).toHaveValue(PROJECT_TITLE);
  await page.getByLabel('Architect').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start project' }).click();
  await expect(page.getByRole('heading', { name: PROJECT_TITLE, level: 1 })).toBeVisible();

  // A decision with two options, a rating, and a choice with reasons.
  await page.getByLabel('New decision title').fill('Which system supports repairs?');
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: 'Which system supports repairs?' })).toBeVisible();
  for (const [name, title] of [
    ['repairs-hub', 'Build Repairs Hub'],
    ['extend-crm', 'Extend the CRM'],
  ] as const) {
    await page.getByRole('button', { name: '+ Add an option' }).click();
    await page.getByPlaceholder('Name (e.g. replace-with-workday)').fill(name);
    await page.getByPlaceholder('Title (e.g. Replace with Workday)').fill(title);
    await page.getByRole('button', { name: 'Add option' }).click();
    await expect(page.getByText(title).first()).toBeVisible();
  }
  const criteriaTable = page.getByTestId('decision-criteria-grid').locator('table');
  const headers = await criteriaTable.locator('th').allTextContents();
  const hubColumn = headers.findIndex((h) => h.includes('Build Repairs Hub'));
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

  // Design the chosen option: add the system in its change.
  await hubHeader.getByRole('button', { name: 'Work on this as a change' }).click();
  await expect(page.getByRole('button', { name: 'Editing in this change' })).toBeVisible();
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Repairs Hub', description: 'Schedules and tracks housing repairs.', capabilityName: 'Housing Repairs' });

  // Evidence on the project.
  await goToModelHome(page);
  await openProject(page);
  await page.getByLabel('Evidence location').fill('https://example.org/repairs-business-case');
  await page.getByLabel('Evidence description').fill('Repairs business case');
  await page.getByRole('button', { name: 'Attach evidence' }).click();
  await expect(page.getByText('Repairs business case')).toBeVisible();

  // The pack, as Markdown: every section, with real content.
  const md = await download(page, 'Download project pack as Markdown');
  expect(md.name).toMatch(/-who-supports-housing-repairs-pack-\d{4}-\d{2}-\d{2}\.md$/);
  const text = md.bytes.toString('utf8');
  expect(text).toContain(`# Project pack: ${PROJECT_TITLE}`);
  expect(text).toContain('## Purpose');
  expect(text).toContain('## Scope\n\n- Housing Repairs (capability)');
  expect(text).toContain('## Decision log\n\n### ADR: Which system supports repairs?');
  expect(text).toContain('A dedicated hub is cheaper to run.');
  expect(text).toContain('## Target state by change');
  expect(text).toContain('Build Repairs Hub');
  expect(text).toContain('- **Repairs Hub** — Created — "Repairs Hub"');
  expect(text).toContain('<https://example.org/repairs-business-case> — Repairs business case');

  // And as PDF.
  const pdf = await download(page, 'Download project pack as PDF');
  expect(pdf.name).toMatch(/-who-supports-housing-repairs-pack-\d{4}-\d{2}-\d{2}\.pdf$/);
  expect(pdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
