/**
 * Simon, 2026-11-20: a project is work in flight, so a contributor can only
 * PROPOSE one, an owner or architect decides, and nobody accepts their own
 * proposal while another owner or architect exists. Click-only from Home at
 * 1280 and 390; the second member joins through the real invite UI. The
 * database rule itself (insert policy, accepting, the sole-owner case) is
 * proved with real roles in `src/db/projects.integration.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { acceptInviteViaSignUp, addCapability, clickNavItem, inviteMemberFromHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
}

test('a contributor proposes a project, sees who decides, and the owner accepts it with names recorded', async ({ page, browser }) => {
  test.slow();
  const { orgName, ownerDisplayName } = await signUpCreateOrgAndModel(page, 'projectrule');
  await addCapability(page, 'Connection Quotations');

  // The owner may start a project outright or propose it.
  await clickNavItem(page, 'Projects');
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
  await expect(page.getByLabel('Start as a proposal')).toBeVisible();

  const contributorEmail = `projectrule-contributor-${randomUUID().slice(0, 8)}@example.test`;
  await inviteMemberFromHome(page, orgName, contributorEmail, 'contributor');

  const contributorContext = await browser.newContext();
  const sam = await contributorContext.newPage();
  await acceptInviteViaSignUp(sam, contributorEmail, 'Sam Contributor');
  await sam.getByRole('link', { name: orgName }).click();
  await sam.getByRole('link', { name: /projectrule Model/ }).click();

  // The contributor can only propose: no choice, and the form says who decides.
  await clickNavItem(sam, 'Projects');
  await expect(sam.getByRole('heading', { name: 'Propose a project' })).toBeVisible();
  await expect(sam.getByLabel('Start as a proposal')).toHaveCount(0);
  await expect(sam.getByTestId('project-proposal-note')).toContainText('an owner or architect decides');
  const title = `Same-day quotes ${randomUUID().slice(0, 6)}`;
  await sam.getByLabel('Project title').fill(title);
  await sam.getByLabel('Architect').selectOption({ index: 1 });
  await sam.getByPlaceholder(/Search a capability this project serves/).fill('Connection');
  await sam.getByRole('button', { name: 'Connection Quotations' }).click();
  await noOverflow(sam);
  await sam.getByRole('button', { name: 'Propose project' }).click();

  // The page is truthful: a proposal, by whom, and who has to accept it. The contributor cannot accept.
  await expect(sam.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await expect(sam.getByText('This is a proposal.')).toBeVisible();
  await expect(sam.getByTestId('project-proposal-history')).toContainText('Proposed by Sam Contributor');
  await expect(sam.getByRole('button', { name: 'Accept proposal' })).toHaveCount(0);
  await expect(sam.getByText(/Waiting for an owner or architect to accept this proposal/)).toBeVisible();
  await noOverflow(sam);

  // The owner, a different person, accepts it; the record names both people.
  await page.getByRole('link', { name: 'Atlas', exact: true }).click();
  await page.getByRole('link', { name: orgName }).click();
  await page.getByRole('link', { name: /projectrule Model/ }).click();
  await clickNavItem(page, 'Projects');
  await page.getByRole('link', { name: title }).click();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Accept proposal' }).click();
  const history = page.getByTestId('project-proposal-history');
  await expect(history).toContainText('Proposed by Sam Contributor');
  await expect(history).toContainText(`Accepted by ${ownerDisplayName}`);
  await expect(page.getByText('This is a proposal.')).toHaveCount(0);
  await noOverflow(page);
});
