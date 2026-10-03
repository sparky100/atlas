/**
 * UI-principles §3 (2026-10-03): Home's two views split by job — Overview
 * is the state of the business, My work the state of the model — and each
 * finding has one home, the other view linking across to it rather than
 * repeating it. A capability with nothing supporting it shows on Overview
 * only (its "nothing recorded" tile); My work no longer lists it as a
 * health finding, and says where to look instead.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { addCapability, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('a capability with no supporters shows on Overview only, and each Home view links across to the other', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'homecrosslinks');

  const capabilityName = `Payments ${randomUUID().slice(0, 8)}`;
  await addCapability(page, capabilityName);
  await goToModelHome(page);

  // An owner starts on My work. The unsupported capability isn't one of its
  // findings any more — My work points to Overview for that instead.
  const myWork = page.getByRole('button', { name: 'My work' });
  const overview = page.getByRole('button', { name: 'Overview' });
  await expect(myWork).toHaveAttribute('aria-pressed', 'true');
  const healthFindings = page.getByTestId('health-findings-panel');
  // Findings have loaded once the capability's own "no owner" finding (a
  // model-quality gap, still My work's) is showing.
  await expect(healthFindings.getByText(/1 capability with no owner/)).toBeVisible();
  await expect(healthFindings.getByText(/with no known supporters/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Where capabilities are weak is on Overview →' }).click();
  await expect(overview).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Where are we weak' })).toBeVisible();
  await expect(page.getByText(capabilityName, { exact: true })).toBeVisible();

  // And back: Overview points to My work for the model-quality findings.
  await page.getByRole('button', { name: 'Missing owners, links, labels and stale values are on My work →' }).click();
  await expect(myWork).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Health findings', exact: true })).toBeVisible();
});
