/**
 * Item 2 of the 25 Nov review: a person researches a candidate option before
 * anyone works on it. Click-only from Home at 1280 and 390: start a decision
 * on Quote Tool, add a Buy option by hand (a candidate with no change),
 * Research the web on it, approve the exact query, save one page with a
 * checked statement, and see that page on the option after a reload, while
 * the option still has no change (Work on this option is still offered).
 *
 * Test setup, not production paths: the organisation row is patched in the
 * browser to show web research, agents and the key switched on (the key flag
 * can only be set server-side), and `research-agent` is intercepted with
 * `page.route` because a live web search is not deterministic. The stub
 * returns the function's own response shape, and the request it receives is
 * checked to name the option, not a change. Saving the page goes to the real
 * database through RLS. What the function itself decides (role, switches,
 * key, option on this decision, egress record) is covered by
 * `src/tools/researchHandler.test.ts` and the cross-organisation integration
 * tests. This does NOT show the search results are good.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCapability, addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

async function switchResearchOn(page: Page) {
  await page.route('**/rest/v1/organisations*', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as unknown;
    const patch = (row: Record<string, unknown>) => ({ ...row, ai_assistant_enabled: true, ai_agents_enabled: true, ai_agent_key_set: true, ai_web_search_enabled: true });
    await route.fulfill({ response, json: Array.isArray(body) ? body.map((r) => patch(r as Record<string, unknown>)) : patch(body as Record<string, unknown>) });
  });
}

const PAGE_URL = 'https://quoteco.example/connections';

async function stubResearcher(page: Page) {
  const sent: Record<string, unknown>[] = [];
  await page.route('**/functions/v1/research-agent', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    sent.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        query: body.query,
        searchedAt: '2026-11-25T10:00:00Z',
        requests: 1,
        candidates: [{ url: PAGE_URL, title: 'QuoteCo for electricity networks', publisher: 'quoteco.example', excerpt: 'QuoteCo issues a connection quote in one day.', retrievedAt: '2026-11-25T10:00:00Z' }],
      }),
    });
  });
  return sent;
}

test('research a candidate option, save a checked page, and it stays on the option with no change made', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'researchcandidate');
  await switchResearchOn(page);
  const sent = await stubResearcher(page);
  await page.reload();
  await addCapability(page, 'Connect a new customer');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Quote Tool', description: 'Issues connection quotes.' });
  await goToModelHome(page);
  await expect(page.getByTestId('health-findings-panel').getByText('Loading…')).toHaveCount(0);
  await page.getByTestId('health-findings-panel').getByRole('link', { name: 'Keep, link or retire? →' }).click();
  await page.getByRole('combobox').first().selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: 'Keep, link or retire Quote Tool?' })).toBeVisible();

  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByRole('radio', { name: 'Buy a product', exact: true }).check();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill('Move quoting to a SaaS quoting tool');
  await page.getByRole('button', { name: 'Add option' }).click();
  const grid = page.getByTestId('decision-criteria-grid');
  await expect(grid.getByText('Move quoting to a SaaS quoting tool').first()).toBeVisible();

  // A candidate with no change can be researched straight away.
  await expect(grid.getByRole('button', { name: 'Work on this option' })).toHaveCount(1);
  await grid.getByRole('button', { name: 'Research the web' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('What should the Researcher search for?').fill('connection quote software for UK electricity networks');
  await dialog.getByRole('checkbox', { name: 'I approve this exact text for a public web search.' }).check();
  await dialog.getByRole('button', { name: 'Search the web' }).click();
  await expect(dialog.getByText('QuoteCo for electricity networks')).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ query: 'connection quote software for UK electricity networks' });
  expect(typeof sent[0]?.optionId).toBe('string');
  expect(sent[0]).not.toHaveProperty('branchId');

  await dialog.getByTestId('research-save-as-evidence').click();
  await dialog.getByPlaceholder('For example: Oracle lists utility customer service as a product.').fill('QuoteCo quotes a connection in one day.');
  await dialog.getByRole('checkbox', { name: 'I opened this page and checked that it supports this statement.' }).check();
  await dialog.getByRole('button', { name: 'Save page and check' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.reload();
  // Desktop columns show "Sources (1)"; mobile cards keep it under "Details and evidence".
  await expect(grid.getByText('Move quoting to a SaaS quoting tool').first()).toBeVisible();
  if ((page.viewportSize()?.width ?? 1280) < 700) await grid.getByText('Details and evidence').click();
  await grid.getByRole('button', { name: 'Sources (1)' }).first().click();
  await expect(grid.getByText('QuoteCo for electricity networks').first()).toBeVisible();
  await expect(grid.getByText('QuoteCo quotes a connection in one day.').first()).toBeVisible();
  // Still a candidate: researching it made no change.
  await expect(grid.getByRole('button', { name: 'Work on this option' })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});
