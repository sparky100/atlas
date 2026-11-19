import type { Page } from '@playwright/test';

/**
 * Settings pages open with only their first section expanded. A spec that
 * needs a control inside a later section calls this once the page heading is
 * visible — it clicks "Expand all", the same control a person would use.
 */
export async function expandAllSettingsSections(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Expand all' }).click();
}
