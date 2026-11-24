/**
 * Designer free trial (Simon, 2026-11-20): an organisation with agents switched
 * on but no AI key of its own can try the Designer a few times on Atlas's key.
 * From Home, a person with no key sees how many drafts are left, uses one, and
 * once the allowance is gone is told plainly what to do and who can do it. Also
 * the failed state. Click-only from Home at 1280 and 390 like every
 * `golden-path-*` spec.
 *
 * Test setup, not production paths: the organisation row is patched in the
 * browser (assistant and agents on, NO key), the call log read is stubbed to
 * look like earlier trial runs, and `design-agent` is intercepted, as in
 * `golden-path-designer.spec.ts`. This proves behaviour and wording. It does NOT
 * prove the allowance is enforced (that is the `llm-proxy` function and
 * `src/contracts/trialAllowance.test.ts`), that the Designer's suggestions are
 * good, or that a business user finds the path unaided.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCapability, addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

const STAMP = { modelId: '00000000-0000-4000-8000-000000000001', modelName: 'Estate', ref: 'main', commitId: '00000000-0000-4000-8000-000000000002' };
const DESIGN = {
  options: [
    { title: 'Configure the quoting tool', summary: 'Use the quoting tool already in place.', toWeigh: 'Fit with the quote steps.' },
    { title: 'Replace with a product', summary: 'Buy a quoting product.', toWeigh: 'Time to switch.' },
  ],
  gaps: [] as string[],
  stayNote: 'Quotes stay slow.',
  problems: [] as string[],
};

async function agentsOnNoKey(page: Page) {
  await page.route('**/rest/v1/organisations*', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as unknown;
    const patch = (row: Record<string, unknown>) => ({ ...row, ai_assistant_enabled: true, ai_agents_enabled: true, ai_agent_key_set: false });
    await route.fulfill({ response, json: Array.isArray(body) ? body.map((r) => patch(r as Record<string, unknown>)) : patch(body as Record<string, unknown>) });
  });
}

/** The call log as the page reads it: `runs` earlier trial runs (one successful call each). */
async function trialRunsUsed(page: Page, runs: number) {
  await page.route('**/rest/v1/llm_proxy_requests*', async (route) => {
    const rows = Array.from({ length: runs }, (_v, i) => ({ key_source: 'trial', status: 'ok', run_id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, input_tokens: 1000, output_tokens: 100 }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
}

async function stubDesigner(page: Page, status = 200) {
  await page.route('**/functions/v1/design-agent', async (route) => {
    const body = status === 200
      ? { status: 'done', stamp: STAMP, design: DESIGN, result: { status: 'answered', answer: '{}', citations: [], citationNames: {}, grounded: false, unverifiedRemoved: 0, toolUses: [], rounds: 2, inputTokens: 10, outputTokens: 5 } }
      : { status: 'not_enabled', message: "The free trial of the Designer is used up. An owner needs to add the organisation's AI key in organisation settings." };
    if (status !== 200) {
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      return;
    }
    const lines = [
      { type: 'event', event: { type: 'tool_call', name: 'search_elements' } },
      { type: 'event', event: { type: 'tool_done', name: 'search_elements', ok: true } },
      { type: 'result', ...body },
    ];
    await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: lines.map((line) => `${JSON.stringify(line)}\n`).join('') });
  });
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
}

async function toDecisionFormFromFinding(page: Page, label: string) {
  await signUpCreateOrgAndModel(page, label);
  await addCapability(page, 'Connect a new customer');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Quote Tool', description: 'Issues connection quotes.' });
  await goToModelHome(page);
}

test('with no key: the trial is offered, counts down as it is used, and a run fills in editable options', async ({ page }) => {
  test.slow();
  await toDecisionFormFromFinding(page, 'trialuse');
  await agentsOnNoKey(page);
  await trialRunsUsed(page, 2);
  await stubDesigner(page);
  await page.reload();

  const health = page.getByTestId('health-findings-panel');
  await expect(health.getByText('Loading…')).toHaveCount(0);
  await expect(page.getByTestId('designer-hint')).toContainText('Draft options with the Designer');
  await health.getByRole('link', { name: 'Keep, link or retire? →' }).click();

  await expect(page.getByTestId('designer-trial-line')).toContainText('Free trial: 3 drafts left');
  await page.getByLabel('What the options need to solve').fill('Quotes for new connections take two days.');
  await page.getByRole('button', { name: 'Suggest options' }).click();
  await expect(page.getByTestId('suggestion-card')).toHaveCount(2);
  await expect(page.getByTestId('designer-trial-line')).toContainText('Free trial: 2 drafts left');
  await expect(page.getByTestId('designer-cost')).toContainText("Atlas's free trial");
  await noOverflow(page);
});

test('with no key and the trial used up: the Designer is not offered, the page says why and who can fix it, and nothing is lost', async ({ page }) => {
  test.slow();
  await toDecisionFormFromFinding(page, 'trialspent');
  await agentsOnNoKey(page);
  await trialRunsUsed(page, 5);
  await page.reload();

  const health = page.getByTestId('health-findings-panel');
  await expect(health.getByText('Loading…')).toHaveCount(0);
  await expect(page.getByTestId('designer-hint')).toContainText('free trial of the Designer is used up');
  await health.getByRole('link', { name: 'Keep, link or retire? →' }).click();

  await expect(page.getByRole('button', { name: 'Suggest options' })).toHaveCount(0);
  await expect(page.getByTestId('designer-unavailable')).toContainText('free trial of the Designer is used up');
  // The signed-in person is the owner, so they get the way to fix it; a member would be told which owners to ask (unit-tested).
  await expect(page.getByTestId('designer-unavailable').getByRole('link', { name: 'Open organisation settings' })).toBeVisible();
  // The form still works by hand: the title and the brief box are there and editable.
  await expect(page.getByPlaceholder('Title (e.g. What replaces SAP PM?)')).toHaveValue('Keep, link or retire Quote Tool?');
  await expect(page.getByLabel('What the options need to solve')).toBeVisible();
  await noOverflow(page);
});

test('if the function says the trial ran out while the page was open, the person is told and their brief is kept', async ({ page }) => {
  test.slow();
  await toDecisionFormFromFinding(page, 'trialrace');
  await agentsOnNoKey(page);
  await trialRunsUsed(page, 1);
  await stubDesigner(page, 403);
  await page.reload();

  const health = page.getByTestId('health-findings-panel');
  await expect(health.getByText('Loading…')).toHaveCount(0);
  await health.getByRole('link', { name: 'Keep, link or retire? →' }).click();
  const brief = page.getByLabel('What the options need to solve');
  await brief.fill('Repairs are logged twice.');
  await page.getByRole('button', { name: 'Suggest options' }).click();
  await expect(page.getByRole('alert')).toContainText('free trial of the Designer is used up');
  await expect(brief).toHaveValue('Repairs are logged twice.');
  await noOverflow(page);
});
