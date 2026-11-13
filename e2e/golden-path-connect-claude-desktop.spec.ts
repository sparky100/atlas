/**
 * Connect Claude Desktop golden path (F16, ADR-029) — click-only from Home,
 * at both 1280 and 390: a signed-in person with an organisation sees the
 * small Claude Desktop download line on Home, and its download link serves the
 * extension that `pnpm build` (its `prebuild` step, `pnpm mcp:bundle`) just
 * published. The extension is a real zip, and the version file beside it
 * names the same version the card shows.
 */
import { expect, test } from '@playwright/test';
import { signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('Home offers the Claude Desktop download and the file is served', async ({ page, request }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath-mcp');

  // Back to Home through the brand link, as a person would.
  await page.getByRole('link', { name: 'Atlas', exact: true }).click();
  const card = page.getByTestId('connect-claude-desktop');
  // A quiet line, not a panel: the steps stay folded until asked for.
  await expect(card.getByRole('heading')).toHaveCount(0);
  await expect(card.getByText('Open the downloaded file')).toBeHidden();
  await card.getByText('How to set it up').click();
  await expect(card.getByText('Open the downloaded file')).toBeVisible();

  const download = card.getByRole('link', { name: 'Download the Atlas extension' });
  await expect(download).toHaveAttribute('href', '/downloads/atlas.mcpb');

  // The card's version is the published version.
  const published = (await (await request.get('/downloads/mcp-version.json')).json()) as { version: string };
  await expect(card.getByText(`version ${published.version}`)).toBeVisible();

  // The link serves a real zip (the extension), not the app's own page.
  const file = await request.get('/downloads/atlas.mcpb');
  expect(file.ok()).toBe(true);
  const bytes = await file.body();
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
  expect(bytes.length).toBeGreaterThan(10_000);

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});
