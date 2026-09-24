/**
 * Golden path for the in-app Help chat (`src/ui/help/`): open it from the
 * app header, see the starter prompts, send a question, see a streamed
 * answer. Click-only from Home, per docs/prompts/atlas-prompt-pack.md §2.
 * Runs at both 1280 and 390 automatically — `playwright.config.ts`'s own
 * `chromium-390` project matches every `golden-path-*.spec.ts` file, so
 * this file doesn't set its own viewport.
 *
 * `llm-proxy` itself is intercepted via `page.route` rather than called
 * for real: this repo has no live Anthropic key in CI/local runs (capture's
 * own Playwright coverage — there is none — makes the same call for the
 * same reason), and a real model response isn't deterministic enough for
 * an assertion anyway. The mock returns the exact `text/event-stream` shape
 * `callAnthropicStreamingPassthrough` forwards (`supabase/functions/
 * llm-proxy/index.ts`), so this spec exercises the real client-side SSE
 * parsing path (`src/ui/help/streamHelpAnswer.ts`), not a stubbed-out one.
 */
import { expect, test } from '@playwright/test';
import { goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

function sseBody(tokens: string[]): string {
  return tokens.map((t) => `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } })}\n\n`).join('') + 'data: [DONE]\n\n';
}

test('open Help, ask a question, see a streamed answer', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath-help');
  await goToModelHome(page);

  await page.route('**/functions/v1/llm-proxy', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseBody(['Atlas ', 'models ', 'four ', 'kinds ', 'of ', 'thing.']),
    });
  });

  await page.getByRole('button', { name: 'Help' }).click();
  await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible();
  await expect(page.getByText('SUGGESTED QUESTIONS')).toBeVisible();

  await page.getByRole('button', { name: "What's the difference between a Capability, System, and Container?" }).click();

  await expect(page.getByText('Atlas models four kinds of thing.')).toBeVisible();

  await page.getByRole('button', { name: 'Close Help' }).click();
  await expect(page.getByRole('dialog', { name: 'Help' })).not.toBeVisible();
});
