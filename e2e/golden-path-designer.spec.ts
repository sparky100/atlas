/**
 * Phase D step 2b, "Connect a new customer": from a finding (a system with no
 * capability link recorded) the owner opens the pre-filled decision, sees the
 * Designer is NOT offered while agents are off, then — once the organisation
 * has Ask Atlas on, agents on and a key saved — drafts options, edits the
 * draft, and adds it to the decision's context. Click-only from Home at 1280
 * and 390 like every `golden-path-*` spec.
 *
 * Test setup, not production paths: the organisation row is patched in the
 * browser to show the switches on and the key saved (the key flag can only be
 * set server-side by the `org-ai-key` function, which a local run has no
 * provider for), and `design-agent` is intercepted with `page.route` because a
 * real model is not deterministic and is excluded from CI. The stub sends the
 * exact shape the function sends, so the real client parsing and rendering run.
 * What the function itself decides (role, switches, key, cost withheld, citation
 * checking) is covered by `src/tools/designHandler.test.ts`.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCapability, addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

function healthPanel(page: Page) {
  return page.getByTestId('health-findings-panel');
}

test('the Designer drafts options from a finding, editable, and only when agents are switched on', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'designer');
  await addCapability(page, 'Connect a new customer');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Quote Tool', description: 'Issues connection quotes.' });
  const systemId = /\/e\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  expect(systemId).not.toBe('');

  await goToModelHome(page);
  await expect(healthPanel(page).getByText('Loading…')).toHaveCount(0);
  await healthPanel(page).getByRole('link', { name: 'Keep, link or retire? →' }).click();
  await expect(page.getByPlaceholder('Title (e.g. What replaces SAP PM?)')).toHaveValue('Keep, link or retire Quote Tool?');

  // Agents are off by default: the Designer is not offered.
  await expect(page.getByRole('button', { name: 'Draft options with the Designer' })).toHaveCount(0);
  // ...and the page says why, with a way to fix it, instead of going quiet.
  await expect(page.getByTestId('designer-unavailable')).toContainText('Turn on Ask Atlas');
  await expect(page.getByTestId('designer-unavailable').getByRole('link', { name: 'Open organisation settings' })).toBeVisible();

  // Test setup: the organisation now has Ask Atlas on, agents on and a key saved.
  await page.route('**/rest/v1/organisations*', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as unknown;
    const patch = (row: Record<string, unknown>) => ({ ...row, ai_assistant_enabled: true, ai_agents_enabled: true, ai_agent_key_set: true });
    const patched = Array.isArray(body) ? body.map((r) => patch(r as Record<string, unknown>)) : patch(body as Record<string, unknown>);
    await route.fulfill({ response, json: patched });
  });
  let runs = 0;
  let sent: { elementId?: string; finding?: string } = {};
  await page.route('**/functions/v1/design-agent', async (route) => {
    runs += 1;
    sent = route.request().postDataJSON() as { elementId?: string; finding?: string };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'done',
        stamp: { modelId: '00000000-0000-4000-8000-000000000001', modelName: 'Estate', ref: 'main', commitId: '00000000-0000-4000-8000-000000000002' },
        result: {
          status: 'answered',
          answer: `1. Stay as we are: Quote Tool keeps issuing quotes.\n2. Link it to a capability: [[element:${systemId}]] may support quoting.\n3. Investigate retiring it.`,
          citations: [systemId],
          citationNames: { [systemId]: 'Quote Tool' },
          grounded: true,
          unverifiedRemoved: 0,
          toolUses: [],
          rounds: 2,
          inputTokens: 10,
          outputTokens: 5,
        },
      }),
    });
  });
  await page.reload();

  const draftButton = page.getByRole('button', { name: 'Draft options with the Designer' });
  await expect(draftButton).toBeVisible();
  await draftButton.click();

  const draft = page.getByLabel("Designer's draft (edit before you use it)");
  await expect(draft).toHaveValue(/Stay as we are/);
  await expect(page.getByText('Based on: Quote Tool.')).toBeVisible();
  await expect(page.getByTestId('designer-cost')).toContainText('This run used 10 tokens in and 5 out, with 0 lookups');
  expect(runs).toBe(1);
  expect(sent.elementId).toBe(systemId);
  expect(sent.finding).toContain('no capability link recorded');

  // The draft is editable, and adding it puts the edited text into the context.
  await draft.fill('1. Stay as we are.\n2. Link it to Connect a new customer.');
  await page.getByRole('button', { name: 'Add to the context above' }).click();
  const context = page.getByPlaceholder('Context — why this decision needs making');
  await expect(context).toHaveValue(/Designer's draft options:\n1\. Stay as we are\.\n2\. Link it to Connect a new customer\./);
  await expect(context).toHaveValue(/No business use has been ruled in or out/);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);

  // Starting the decision records that the Designer helped, and the decision says so for good.
  await page.getByRole('combobox').first().selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: 'Keep, link or retire Quote Tool?' })).toBeVisible();
  await expect(page.getByTestId('decision-ai-mark')).toContainText('AI helped with this: Drafted by the Designer on');
  await expect(page.getByTestId('decision-ai-mark')).toContainText('then edited by a person');
});

test('the Designer is offered, or explained, when a decision is started from inside a project', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'designerproject');
  await addCapability(page, 'Housing Repairs');
  await goToModelHome(page);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('link', { name: 'Start a project →' }).click();
  await page.getByLabel('Architect').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start project' }).click();
  const nextStep = page.getByTestId('project-next-step');
  await expect(nextStep.getByLabel('New decision title')).toBeVisible();

  // Agents are off: the form says why instead of going quiet.
  await expect(nextStep.getByRole('button', { name: 'Draft options with the Designer' })).toHaveCount(0);
  await expect(nextStep.getByTestId('designer-unavailable')).toContainText('Turn on Ask Atlas');

  await page.route('**/rest/v1/organisations*', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as unknown;
    const patch = (row: Record<string, unknown>) => ({ ...row, ai_assistant_enabled: true, ai_agents_enabled: true, ai_agent_key_set: true });
    await route.fulfill({ response, json: Array.isArray(body) ? body.map((r) => patch(r as Record<string, unknown>)) : patch(body as Record<string, unknown>) });
  });
  await page.route('**/functions/v1/design-agent', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'done',
        stamp: { modelId: '00000000-0000-4000-8000-000000000001', modelName: 'Estate', ref: 'main', commitId: '00000000-0000-4000-8000-000000000002' },
        result: { status: 'answered', answer: '1. Stay as we are.\n2. Build it ourselves.', citations: [], citationNames: {}, grounded: false, unverifiedRemoved: 0, toolUses: [], rounds: 1, inputTokens: 10, outputTokens: 5 },
      }),
    });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Draft options with the Designer' }).click();
  await expect(page.getByLabel("Designer's draft (edit before you use it)")).toHaveValue(/Stay as we are/);
  await page.getByRole('button', { name: 'Add to the context above' }).click();
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByTestId('decision-ai-mark')).toContainText('AI helped with this: Drafted by the Designer on');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
