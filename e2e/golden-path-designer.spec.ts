/**
 * Designer-to-options journey (Phase D step 2, "Connect a new customer"): from
 * Home, a person writes what the options need to solve, asks the Designer for
 * suggestions, edits and leaves out some, starts the decision, and lands on a
 * decision page that already holds those options with their provenance and no
 * retyping. Also the unavailable, failed, incomplete and interrupted states.
 * Click-only from Home at 1280 and 390 like every `golden-path-*` spec.
 *
 * Test setup, not production paths: the organisation row is patched in the
 * browser to show the switches on and the key saved (the key flag can only be
 * set server-side by the `org-ai-key` function, which a local run has no
 * provider for), and `design-agent` is intercepted with `page.route` because a
 * real model is not deterministic and is excluded from CI. The stub sends the
 * exact shape the function sends, so the real client parsing, rendering and
 * saving run. This proves behaviour. It does NOT show the Designer's real
 * suggestions are good (that needs a live run), nor that a business user finds
 * the path unaided. What the function itself decides (role, switches, key, cost
 * withheld, citation and output checking) is covered by
 * `src/tools/designHandler.test.ts` and `src/contracts/designerOptions.test.ts`.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCapability, addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

function healthPanel(page: Page) {
  return page.getByTestId('health-findings-panel');
}

const STAMP = { modelId: '00000000-0000-4000-8000-000000000001', modelName: 'Estate', ref: 'main', commitId: '00000000-0000-4000-8000-000000000002' };

const DESIGN = {
  options: [
    { title: 'Configure the quoting tool', summary: 'Use the quoting tool already in place, set up for new connections.', toWeigh: 'Fit with the quote steps.' },
    { title: 'Replace with a product', summary: 'Buy a quoting product and retire the current one.', toWeigh: 'Time to switch.' },
    { title: 'Build it ourselves', summary: 'Write the quote rules in house.', toWeigh: 'Who maintains it.' },
  ],
  gaps: ['No owner is recorded for the quoting tool.'],
  stayNote: 'Quotes stay slow while we wait.',
  problems: [] as string[],
};

async function switchAgentsOn(page: Page) {
  await page.route('**/rest/v1/organisations*', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as unknown;
    const patch = (row: Record<string, unknown>) => ({ ...row, ai_assistant_enabled: true, ai_agents_enabled: true, ai_agent_key_set: true });
    await route.fulfill({ response, json: Array.isArray(body) ? body.map((r) => patch(r as Record<string, unknown>)) : patch(body as Record<string, unknown>) });
  });
}

/** Stubs `design-agent`. `reply` decides each call, so a spec can fail once then succeed. */
async function stubDesigner(page: Page, reply: (call: number) => { status: number; body: unknown }) {
  const sent: { elementId?: string; finding?: string }[] = [];
  await page.route('**/functions/v1/design-agent', async (route) => {
    sent.push(route.request().postDataJSON() as { elementId?: string; finding?: string });
    const r = reply(sent.length);
    await route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
  });
  return sent;
}

const done = (design: typeof DESIGN) => ({
  status: 200,
  body: {
    status: 'done',
    stamp: STAMP,
    design,
    result: { status: 'answered', answer: '{}', citations: [], citationNames: {}, grounded: false, unverifiedRemoved: 0, toolUses: [], rounds: 2, inputTokens: 10, outputTokens: 5 },
  },
});

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
}

test('from a finding: suggestions become editable options on the decision, and the Designer is explained while agents are off', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'designer');
  await addCapability(page, 'Connect a new customer');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Quote Tool', description: 'Issues connection quotes.' });
  const systemId = /\/e\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  expect(systemId).not.toBe('');

  await goToModelHome(page);
  await expect(healthPanel(page).getByText('Loading…')).toHaveCount(0);
  await expect(page.getByTestId('designer-hint')).toContainText('Turn on Ask Atlas');
  await healthPanel(page).getByRole('link', { name: 'Keep, link or retire? →' }).click();
  await expect(page.getByPlaceholder('Title (e.g. What replaces SAP PM?)')).toHaveValue('Keep, link or retire Quote Tool?');

  // Agents are off by default: not offered, and the page says why, with a way to fix it.
  await expect(page.getByRole('button', { name: 'Suggest options' })).toHaveCount(0);
  await expect(page.getByTestId('designer-unavailable')).toContainText('Turn on Ask Atlas');
  await expect(page.getByTestId('designer-unavailable').getByRole('link', { name: 'Open organisation settings' })).toBeVisible();

  await switchAgentsOn(page);
  const sent = await stubDesigner(page, () => done(DESIGN));
  await page.reload();

  // The box the Designer reads is on the page, in plain words, and what is typed there is what it is sent.
  const brief = page.getByLabel('What the options need to solve');
  await expect(brief).toHaveValue(/no capability link recorded/);
  await brief.fill('Quotes for new connections take two days. We want them the same day.');
  await page.getByRole('button', { name: 'Suggest options' }).click();

  await expect(page.getByTestId('suggestion-card')).toHaveCount(3);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.elementId).toBe(systemId);
  expect(sent[0]?.finding).toBe('Quotes for new connections take two days. We want them the same day.');
  await expect(page.getByText('Suggested by the Designer').first()).toBeVisible();
  await expect(page.getByText('Staying as we are is always included')).toBeVisible();
  await expect(page.getByText('No owner is recorded for the quoting tool.')).toBeVisible();
  await expect(page.getByTestId('designer-cost')).toContainText('This run used 10 tokens in and 5 out');
  await noOverflow(page);

  // Edit the first suggestion in place, and leave the last one out.
  const cards = page.getByTestId('suggestion-card');
  await cards.nth(0).getByLabel('Option title').fill('Configure the quoting tool for new homes');
  await expect(cards.nth(0).getByText('edited by you')).toBeVisible();
  await cards.nth(2).getByRole('checkbox').uncheck();
  await expect(page.getByTestId('designer-selection')).toContainText('2 suggestions will be added as options');

  await page.getByRole('combobox').first().selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start decision with 2 suggested options' }).click();

  // The decision opens already holding the options: nothing retyped, nothing copied.
  await expect(page.getByRole('heading', { name: 'Keep, link or retire Quote Tool?' })).toBeVisible();
  await expect(page.getByTestId('decision-ai-mark')).toContainText('AI helped with this: Drafted by the Designer on');
  const options = page.getByRole('link', { name: 'Configure the quoting tool for new homes' });
  await expect(options.first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Replace with a product' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Build it ourselves' })).toHaveCount(0);
  await expect(page.getByText('Suggested by the Designer, edited by').first()).toBeVisible();
  await noOverflow(page);
});

test('from a project: the brief is visible and editable, a failed run keeps it, a rerun keeps earlier suggestions, and an unfinished draft survives a refresh', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'designerproject');
  await addCapability(page, 'Housing Repairs');
  await goToModelHome(page);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('link', { name: 'Start a project →' }).click();
  await page.getByLabel('Architect').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start project' }).click();
  const nextStep = page.getByTestId('start-project-decision');
  await expect(nextStep.getByLabel('New decision title')).toBeVisible();

  // Agents are off: the form says why instead of going quiet, and the brief box is still there.
  await expect(nextStep.getByRole('button', { name: 'Suggest options' })).toHaveCount(0);
  await expect(nextStep.getByTestId('designer-unavailable')).toContainText('Turn on Ask Atlas');
  await expect(nextStep.getByLabel('What the options need to solve')).toBeVisible();

  await switchAgentsOn(page);
  let incomplete = false;
  const sent = await stubDesigner(page, (call) => {
    if (call === 1) return { status: 502, body: { status: 'error', message: 'The AI service could not answer. Check the organisation key in settings, then try again.' } };
    return done(incomplete ? { ...DESIGN, options: DESIGN.options.slice(0, 1), problems: ['The Designer gave fewer options than expected.'] } : DESIGN);
  });
  await page.reload();

  const brief = nextStep.getByLabel('What the options need to solve');
  await brief.fill('Repairs are logged twice, once by phone and once online.');
  // First run fails: a plain reason, the brief and the page are untouched.
  await nextStep.getByRole('button', { name: 'Suggest options' }).click();
  await expect(nextStep.getByRole('alert')).toContainText('The AI service could not answer');
  await expect(brief).toHaveValue('Repairs are logged twice, once by phone and once online.');
  await expect(nextStep.getByRole('button', { name: 'Start decision' })).toBeEnabled();

  // Second run works; the person edits a card, then asks again and the edit is not lost.
  await nextStep.getByRole('button', { name: 'Suggest options' }).click();
  await expect(nextStep.getByTestId('suggestion-card')).toHaveCount(3);
  expect(sent[1]?.finding).toBe('Repairs are logged twice, once by phone and once online.');
  await nextStep.getByTestId('suggestion-card').nth(1).getByLabel('Option title').fill('Replace with a repairs product');
  incomplete = true;
  await nextStep.getByRole('button', { name: 'Suggest again' }).click();
  await expect(nextStep.getByTestId('designer-incomplete')).toContainText('may be incomplete');
  await nextStep.getByTestId('earlier-suggestions').locator('summary').click();
  await expect(nextStep.getByTestId('earlier-suggestions').getByLabel('Option title').nth(1)).toHaveValue('Replace with a repairs product');
  await noOverflow(page);

  // Interrupted: a refresh does not lose the unsaved suggestions.
  await page.reload();
  const restore = page.getByTestId('start-project-decision').getByTestId('designer-restore');
  await expect(restore).toContainText('unsaved suggestions from earlier');
  await restore.getByRole('button', { name: 'Restore them' }).click();
  await expect(page.getByTestId('start-project-decision').getByTestId('suggestion-card')).toHaveCount(4);

  // Start the decision with what is kept: it opens already holding the options.
  await page.getByTestId('start-project-decision').getByRole('button', { name: /^Start decision with \d+ suggested options?$/ }).click();
  await expect(page.getByTestId('decision-ai-mark')).toContainText('AI helped with this: Drafted by the Designer on');
  await expect(page.getByRole('link', { name: 'Replace with a repairs product' }).first()).toBeVisible();
  await expect(page.getByTestId('pending-options')).toHaveCount(0);
  await noOverflow(page);
});
