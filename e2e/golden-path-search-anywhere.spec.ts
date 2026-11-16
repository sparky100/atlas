/**
 * F9 step 5 (UI-principles §2.0): search anywhere — click-only from Home
 * (S2's own rule), at 1280 and 390 like every `golden-path-*` spec. A
 * system, a change and a decision are created through the UI, then each
 * is found from a page other than Home: by keyboard (Ctrl+K, arrows,
 * Enter) on a desktop, and from the nav's Search button on a phone, where
 * there's no keyboard shortcut to press.
 */
import { expect, test, type Page } from '@playwright/test';
import { addSystemFromHome, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

/** Open the search dialog the way a user at this width would: the shortcut on a desktop, the nav's Search button (behind More) on a phone. */
async function openSearch(page: Page): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Model navigation' });
  if ((page.viewportSize()?.width ?? 1280) > 768) {
    await page.keyboard.press('Control+K');
  } else {
    await nav.getByRole('button', { name: /^More/ }).click();
    await nav.getByRole('region', { name: 'More sections' }).getByRole('button', { name: 'Search' }).click();
  }
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
}

test('search anywhere: find a system, a change and a decision from any page, by keyboard or tap', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath-search');
  const desktop = (page.viewportSize()?.width ?? 1280) > 768;

  await addSystemFromHome(page, { name: 'Meter Data Hub', description: 'Holds smart meter readings.' });

  // A change, left straight away so the session stays on main.
  await goToModelHome(page);
  await clickNavItem(page, 'Changes');
  await page.getByPlaceholder("What's this change? (e.g. Retire the legacy CRM)").fill('Retire the meter hub');
  await page.getByRole('button', { name: 'Create change' }).click();
  await expect(page.getByRole('heading', { name: 'Retire the meter hub' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to the live model' }).click();

  // A decision.
  await clickNavItem(page, 'Decisions');
  await page.getByPlaceholder('Title (e.g. What replaces SAP PM?)').fill('What replaces the meter hub?');
  await page.getByPlaceholder('Context — why this decision needs making').fill('The meter hub is out of support next year.');
  await page.getByRole('combobox').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: 'What replaces the meter hub?' })).toBeVisible();

  // From the decision page (not Home): one query finds all three kinds, grouped.
  await openSearch(page);
  const dialog = page.getByRole('dialog', { name: 'Search' });
  const input = dialog.getByRole('combobox', { name: 'Search elements, changes, decisions and projects' });
  await expect(input).toBeFocused();
  await input.fill('meter');
  const results = dialog.getByRole('listbox', { name: 'Results' });
  await expect(results.getByRole('group', { name: 'Elements' }).getByRole('option', { name: /Meter Data Hub/ })).toBeVisible();
  await expect(results.getByRole('group', { name: 'Changes' }).getByRole('option', { name: /Retire the meter hub/ })).toBeVisible();
  await expect(results.getByRole('group', { name: 'Decisions' }).getByRole('option', { name: /What replaces the meter hub\?/ })).toBeVisible();

  // Esc closes it without going anywhere.
  if (desktop) {
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'What replaces the meter hub?' })).toBeVisible();
    await openSearch(page);
    await input.fill('meter');
  }

  // Open the system: on a desktop the first result is already highlighted,
  // so Enter opens it; on a phone, tap it.
  if (desktop) {
    await expect(results.getByRole('option', { name: /Meter Data Hub/ })).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
  } else {
    await results.getByRole('option', { name: /Meter Data Hub/ }).click();
  }
  await expect(page.getByRole('heading', { name: 'Meter Data Hub', level: 1 })).toBeVisible();
  await expect(dialog).toHaveCount(0);

  // Open the change: on a desktop, arrow down to it (system, then change).
  await openSearch(page);
  await input.fill('meter');
  if (desktop) {
    await expect(results.getByRole('option', { name: /Retire the meter hub/ })).toBeVisible();
    await input.press('ArrowDown');
    await expect(results.getByRole('option', { name: /Retire the meter hub/ })).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
  } else {
    await results.getByRole('option', { name: /Retire the meter hub/ }).click();
  }
  await expect(page.getByRole('heading', { name: 'Retire the meter hub' })).toBeVisible();

  // Open the decision.
  await openSearch(page);
  await input.fill('replaces');
  await results.getByRole('option', { name: /What replaces the meter hub\?/ }).click();
  await expect(page.getByRole('heading', { name: 'What replaces the meter hub?' })).toBeVisible();

  // Nothing matching says so plainly.
  await openSearch(page);
  await input.fill('zzz-no-such-thing');
  await expect(dialog.getByText('Nothing matches “zzz-no-such-thing”.')).toBeVisible();
});
