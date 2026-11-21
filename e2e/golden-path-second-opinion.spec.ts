/**
 * D2 second opinion: click from Home into a real saved decision at both 1280
 * and 390. Only the organisation's server-only key flag and the model request
 * are stubbed; creation, options, navigation, rendering and local edits are real.
 * This does not assess the quality or price of a live provider response.
 */
import { expect, test, type Page } from '@playwright/test';
import { signUpCreateOrgAndModel, clickNavItem } from './fixtures/goldenPath';

async function createDecisionWithOption(page: Page) {
  await signUpCreateOrgAndModel(page, 'second-opinion');
  await clickNavItem(page, 'Decisions');
  const title = `How should we meet the quoting need? ${Date.now().toString()}`;
  await page.getByPlaceholder('Title (e.g. What replaces SAP PM?)').fill(title);
  await page.getByPlaceholder('Context — why this decision needs making').fill('Issue a connection quote in two days rather than ten.');
  await page.getByRole('combobox').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const panel = page.getByTestId('second-opinion');
  await expect(panel.getByText('Add an option to weigh')).toBeVisible();
  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill('Configure the CRM');
  await page.getByRole('button', { name: 'Add option' }).click();
  await expect(panel.getByText('Ask Atlas is off.')).toBeVisible();
  return panel;
}

async function enableReviewers(page: Page) {
  await page.route('**/rest/v1/organisations*', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as unknown;
    const patch = (row: Record<string, unknown>) => ({ ...row, ai_assistant_enabled: true, ai_agents_enabled: true, ai_agent_key_set: true });
    await route.fulfill({ response, json: Array.isArray(body) ? body.map((row) => patch(row as Record<string, unknown>)) : patch(body as Record<string, unknown>) });
  });
  await page.reload();
}

test('from Home: AI questions can be weighed, edited, kept for a return visit or dismissed', async ({ page }) => {
  test.slow();
  let panel = await createDecisionWithOption(page);
  await expect(panel.getByRole('button', { name: 'Ask the Challenger' })).toHaveCount(0);
  await enableReviewers(page);
  panel = page.getByTestId('second-opinion');
  await expect(panel.getByRole('button', { name: 'Ask the Challenger' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Ask the Steward: cyber' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Ask the Steward: data' })).toBeVisible();
  await panel.getByText('What is sent to the AI?').click();
  await expect(panel.getByText('Cost rating and Run cost are withheld.')).toBeVisible();

  const sent: unknown[] = [];
  await page.route('**/functions/v1/review-agent', async (route) => {
    sent.push(route.request().postDataJSON() as unknown);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'done', inputHash: 'digest-hash', runId: 'run-id', inputTokens: 40, outputTokens: 18, notes: [{ note: 'The CRM covers the capability, but its quote capacity is unconfirmed.', question: 'Can the CRM issue a quote in two days?', basedOn: { kind: 'option', label: 'Configure the CRM' } }] }) });
  });
  await panel.getByRole('button', { name: 'Ask the Challenger' }).click();
  await expect(panel.getByText('The CRM covers the capability, but its quote capacity is unconfirmed.')).toBeVisible();
  expect(sent).toHaveLength(1);
  const request = sent[0] as { decisionId: string; lens: string };
  expect(request.lens).toBe('challenge');
  expect(request.decisionId).toMatch(/^[0-9a-f-]{36}$/);
  const note = panel.locator('li').filter({ hasText: 'quote capacity is unconfirmed' });
  await expect(note.getByText('Based on: Configure the CRM')).toBeVisible();
  await note.getByLabel('Question for you to act on').fill('Who will test the two-day quote?');
  await expect(panel.getByText('Saved on this device only')).toBeVisible();
  await test.info().attach('second-opinion', { body: await panel.screenshot(), contentType: 'image/png' });
  await page.reload();
  panel = page.getByTestId('second-opinion');
  await expect(panel.getByLabel('Question for you to act on')).toHaveValue('Who will test the two-day quote?');
  await panel.getByRole('button', { name: 'Dismiss' }).click();
  await expect(panel.getByText('quote capacity is unconfirmed')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('second-opinion').getByText('quote capacity is unconfirmed')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});

test('failed and stopped runs keep no partial questions and do not create a clearance', async ({ page }) => {
  test.slow();
  await createDecisionWithOption(page);
  await enableReviewers(page);
  const panel = page.getByTestId('second-opinion');
  await page.route('**/functions/v1/review-agent', async (route) => {
    await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ status: 'incomplete', message: 'The reviewer was cut short. Nothing was kept.' }) });
  });
  await panel.getByRole('button', { name: 'Ask the Steward: data' }).click();
  await expect(panel.getByRole('alert')).toContainText('Nothing was kept');
  await page.unroute('**/functions/v1/review-agent');
  await page.route('**/functions/v1/review-agent', async (route) => {
    await new Promise<void>((resolve) => { setTimeout(resolve, 3000); });
    try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'done', inputHash: 'hash', runId: 'late', inputTokens: 1, outputTokens: 1, notes: [] }) }); } catch { /* The browser stopped waiting. */ }
  });
  await panel.getByRole('button', { name: 'Ask the Steward: cyber' }).click();
  await expect(panel.getByRole('status')).toContainText('reading the saved decision');
  await panel.getByRole('button', { name: 'Stop waiting' }).click();
  await expect(panel.getByText('The request may already be with the AI provider')).toBeVisible();
  await expect(panel.getByTestId('review-cyber')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});
