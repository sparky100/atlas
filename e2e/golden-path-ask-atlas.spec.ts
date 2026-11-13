/**
 * Ask Atlas golden path (F15, ADR-028) — click-only from Home, at both 1280
 * and 390 like every `golden-path-*` spec: open Ask Atlas from the nav, see
 * it is off, switch it on as the owner in organisation settings, come back,
 * ask a question, and get an answer whose element is a real link.
 *
 * The `ask-model` function is intercepted with `page.route` (test setup, not
 * a production path): there is no provider key in a local run and a real
 * answer is not deterministic. The stub sends the exact newline-delimited
 * shape the function sends, so the real client-side parsing, rendering and
 * link building run. The cited id is the real id of the system this spec
 * just created, read from its URL. What the function itself decides (the
 * off switch, access, limits, citation checking) is covered by
 * `src/tools/*.test.ts` and the organisation-settings integration test.
 */
import { expect, test } from '@playwright/test';
import { addSystemFromHome, clickNavItem, expectNavCurrent, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('switch Ask Atlas on, ask a question, and follow a cited element', async ({ page }) => {
  const { orgName, modelName } = await signUpCreateOrgAndModel(page, 'goldenpath-ask');
  await addSystemFromHome(page, { name: 'Council Tax System', description: 'Handles council tax accounts.' });
  const systemId = /\/e\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  expect(systemId).toBeTruthy();

  // Off by default: the page says so and sends nothing.
  let asked = 0;
  await page.route('**/functions/v1/ask-model', async (route) => {
    asked += 1;
    const lines = [
      { type: 'event', event: { type: 'tool_call', name: 'search_elements' } },
      { type: 'event', event: { type: 'tool_done', name: 'search_elements', ok: true } },
      {
        type: 'result',
        status: 'done',
        stamp: { modelId: '00000000-0000-4000-8000-000000000001', modelName, ref: 'main', commitId: '00000000-0000-4000-8000-000000000002' },
        result: {
          status: 'answered',
          answer: `One system is recorded: [[element:${systemId ?? ''}]] handles council tax accounts.`,
          citations: [systemId],
          citationNames: { [systemId ?? '']: 'Council Tax System' },
          grounded: true,
          unverifiedRemoved: 0,
          toolUses: [{ name: 'search_elements', input: { query: 'critical' }, ok: true, total: 1, truncated: false }],
          rounds: 2,
          inputTokens: 10,
          outputTokens: 5,
        },
      },
    ];
    await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' });
  });

  await goToModelHome(page);
  await clickNavItem(page, 'Ask Atlas');
  await expectNavCurrent(page, 'Ask Atlas');
  await expect(page.getByRole('heading', { name: 'Ask Atlas', level: 1 })).toBeVisible();
  await expect(page.getByText('Ask Atlas is off for this organisation')).toBeVisible();
  expect(asked).toBe(0);

  // The owner switches it on in organisation settings.
  await page.getByRole('link', { name: 'organisation settings' }).click();
  await expect(page.getByRole('heading', { name: 'Organisation settings' })).toBeVisible();
  const allow = page.getByLabel('Allow Ask Atlas for this organisation');
  // Saving reloads the page (organisation settings' own onChanged), so click and then wait for the saved state rather than `check()`, which would race the reload.
  await allow.click();
  await expect(allow).toBeChecked();

  // Back into the model and ask.
  await page.getByRole('link', { name: 'Atlas', exact: true }).click();
  await page.getByRole('link', { name: orgName }).click();
  await page.getByRole('link', { name: modelName }).click();
  await clickNavItem(page, 'Ask Atlas');
  await expect(page.getByText('Ask Atlas is off for this organisation')).toHaveCount(0);

  await page.getByRole('button', { name: 'Which systems are critical?' }).click();
  await expect(page.getByText('handles council tax accounts.')).toBeVisible();
  expect(asked).toBe(1);

  // The cited element is a real link to its page; a grounded answer carries no warning chips.
  const link = page.getByRole('link', { name: 'Council Tax System' }).filter({ visible: true }).first();
  await expect(link).toHaveAttribute('href', new RegExp(`/e/${systemId ?? ''}$`));
  await expect(page.getByText(/Ungrounded/)).toHaveCount(0);

  // What was looked up can be opened and checked.
  await page.getByText('What was looked up (1)').click();
  await expect(page.getByText('Searched for elements: 1 found')).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);

  await link.click();
  await expect(page.getByRole('heading', { name: 'Council Tax System' })).toBeVisible();

  // Nothing is kept: coming back to the page starts with a clean conversation.
  await goToModelHome(page);
  await clickNavItem(page, 'Ask Atlas');
  await expect(page.getByRole('button', { name: 'Which systems are critical?' })).toBeVisible();
});
