import type { Locator, Page } from '@playwright/test';
import { DECISION_CRITERIA } from '../../src/contracts/decisionCriteria';

/** Decision comparisons use tables on a wide screen and full-width cards on a phone. */
export function compactDecision(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) <= 800;
}

export function optionSurface(page: Page, title: string): Locator {
  if (compactDecision(page)) return page.getByTestId('decision-option-card').filter({ has: page.getByRole('link', { name: title, exact: true }) });
  return page.getByTestId('decision-criteria-grid').locator('th').filter({ has: page.getByRole('link', { name: title, exact: true }) });
}

export async function ratingControl(page: Page, title: string, criterion: string): Promise<Locator> {
  if (compactDecision(page)) {
    const key = DECISION_CRITERIA.find((c) => c.label === criterion)?.key;
    if (!key) throw new Error(`Unknown criterion ${criterion}`);
    return optionSurface(page, title).getByTestId(`decision-rating-${key}`).getByRole('button');
  }
  const table = page.getByTestId('decision-criteria-grid').locator('table');
  const headers = await table.locator('th').allTextContents();
  const column = headers.findIndex((text) => text.includes(title));
  if (column < 1) throw new Error(`Unknown option ${title}`);
  return table.locator('tr', { hasText: criterion }).locator('button').nth(column - 1);
}

export function changesSurface(page: Page): Locator {
  return compactDecision(page) ? page.getByTestId('what-changes-cards') : page.locator('table').filter({ has: page.locator('th', { hasText: 'Row' }) });
}
