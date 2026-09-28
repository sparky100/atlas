/**
 * F1 ("custom attributes") PR4's own golden path (docs/prompts/atlas-prompt-pack.md):
 * "define a select attribute, set it on a system, filter the browse table
 * by it." Click-only from Home, same S2 discipline every other
 * `golden-path-*.spec.ts` follows (`fixtures/goldenPath.ts`'s own module
 * comment) — no seeding beyond org/user, no `page.goto` after sign-in, no
 * URL construction. Two systems are created so the filter step actually
 * proves something (one matches, one doesn't), rather than merely showing
 * a filtered table with nothing to have been filtered out.
 */
import { expect, test } from '@playwright/test';
import { addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('define a select attribute, set it on a system, and filter the browse table by it', async ({ page }) => {
  const { orgName, modelName } = await signUpCreateOrgAndModel(page, 'customattrs');

  // Two systems: one will get Region=EMEA, the other is left unset —
  // the filter step below proves it actually narrows the table, not just
  // that it renders. A third, deliberately long-named system is added
  // purely for the row-to-row Name-column regression check below — it
  // needs a row whose name is much longer than whichever row happens to
  // render first, which the two short names above never produce.
  await addSystemFromHome(page, { name: 'Northgate', description: "The borough's new revenues platform." });
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Council Tax System', description: 'Handles council tax accounts.' });
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Integrated Regional Revenue and Benefits Collection Platform', description: 'A long-named system, for column-width regression coverage.' });
  await goToModelHome(page);

  // Regression coverage: the Name column's width used to be measured from
  // only the first rendered body row (`ElementBrowseTable.tsx`'s
  // `useLayoutEffect`) — safe for the bounded-vocabulary columns
  // (Type/Owner/Lifecycle/Criticality), but Name is open-ended text, so a
  // long name on any row *after* the first used to render its text
  // visibly overlapping into the Type column next to it (`white-space:
  // nowrap`, nothing to wrap or clip it). Checked here, unfiltered, while
  // all three systems (including the long-named one, which never sorts
  // first alphabetically) are on screen together.
  await page.getByRole('link', { name: 'Browse all elements' }).click();
  await expect(page.getByRole('link', { name: 'Integrated Regional Revenue and Benefits Collection Platform' })).toBeVisible();
  // Below the mobile breakpoint (`ElementBrowseTable.tsx`'s own
  // `MOBILE_BREAKPOINT_PX`), `ElementBrowseCards` renders instead of the
  // table — no fixed-width columns to overflow at all (the long name just
  // wraps), so the table-specific overlap check below doesn't apply; the
  // equivalent mobile guarantee (no page-level horizontal scroll even with
  // this exact long name) is checked directly instead. Deeper mobile-card
  // behaviour (sort control, tap-to-navigate) has its own dedicated spec,
  // `element-browse-mobile-cards.engine.spec.ts`.
  if ((await page.locator('table').count()) === 0) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  } else {
    // `expect.poll`: a `ResizeObserver` drives `colWidths`, so the first
    // paint after navigation can still be mid-settle.
    await expect.poll(async () => {
      return page.evaluate(() => {
        const bodyTable = document.querySelectorAll('table')[1];
        if (!bodyTable) return -Infinity;
        let maxOverlapPx = -Infinity;
        for (const tr of bodyTable.querySelectorAll('tbody tr')) {
          const nameCell = tr.children[0] as HTMLElement | undefined;
          const typeCell = tr.children[1] as HTMLElement | undefined;
          if (!nameCell || !typeCell) continue;
          const nameContentRight = nameCell.getBoundingClientRect().left + nameCell.scrollWidth;
          const typeLeft = typeCell.getBoundingClientRect().left;
          maxOverlapPx = Math.max(maxOverlapPx, nameContentRight - typeLeft);
        }
        return maxOverlapPx;
      });
    }, 'Name column overflows into Type on some row').toBeLessThan(1);
  }
  await goToModelHome(page);

  // Define the attribute — owner-only, under organisation settings
  // (same "Atlas" → org → "Org settings" click path
  // `inviteMemberFromHome` already exercises at both widths).
  await page.getByRole('link', { name: 'Atlas' }).click();
  await page.getByRole('link', { name: orgName }).click();
  await page.getByRole('link', { name: 'Org settings' }).click();
  await expect(page.getByRole('heading', { name: 'Organisation settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Custom attributes' })).toBeVisible();

  await page.getByLabel('Key').fill('region');
  await page.getByLabel('Label').fill('Region');
  await page.getByLabel('Kind').selectOption('select');
  await page.getByLabel('Options (comma-separated)').fill('EMEA, AMER, APAC');
  // "Applies to" already defaults to "system" — this golden path never
  // needs to touch it.
  await page.getByRole('button', { name: 'Define attribute' }).click();
  await expect(page.getByText('Region', { exact: true })).toBeVisible();

  // Back into the model, onto Northgate's own page, to set the value.
  await page.getByRole('link', { name: 'Atlas' }).click();
  await page.getByRole('link', { name: orgName }).click();
  await page.getByRole('link', { name: modelName }).click();
  await page.getByRole('link', { name: 'Northgate', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Northgate' })).toBeVisible();

  await page.getByRole('button', { name: /Edit/ }).click();
  await page.getByLabel('Region').selectOption('EMEA');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('EMEA', { exact: true })).toBeVisible();

  // Filter the browse table by the same attribute — only Northgate should
  // remain; Council Tax System (never given a Region) drops out.
  await goToModelHome(page);
  await page.getByRole('link', { name: 'Browse all elements' }).click();
  await page.getByLabel('Custom attribute').selectOption('region');
  await page.getByLabel('Region').selectOption('EMEA');

  await expect(page.getByRole('link', { name: 'Northgate' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Council Tax System' })).not.toBeVisible();

  // Regression coverage: the browse table's own separate header row/table
  // (kept apart from the scrollable body for `position: sticky` to work —
  // ElementBrowseTable.module.css's own comment) must size each column to
  // match the body's real column, at whatever width this run's own project
  // (1280 or 390) gives it. Each header cell's left edge should line up
  // with its own `<td>`'s left edge in the first body row — a `ResizeObserver`
  // drives the header's own widths, so `expect.poll` (not a single read)
  // waits out the one settling pass after the filter above just added a
  // whole new column ("Region") to both rows.
  // Below the mobile breakpoint there's no header/body table pair to check
  // alignment of at all (`ElementBrowseCards` renders instead — see the
  // identical guard above) — the Northgate/Council Tax visibility
  // assertions just above already prove filtering itself still works on a
  // card list.
  if ((await page.locator('table').count()) > 0) {
    const headerCells = page.locator('table').first().locator('thead th');
    const bodyCells = page.locator('table').nth(1).locator('tbody tr').first().locator('td');
    const headerCount = await headerCells.count();
    for (let i = 0; i < headerCount; i++) {
      await expect.poll(async () => {
        const headerBox = await headerCells.nth(i).boundingBox();
        const bodyBox = await bodyCells.nth(i).boundingBox();
        return headerBox && bodyBox ? Math.abs(headerBox.x - bodyBox.x) : Number.NaN;
      }, `header/body column ${String(i)} misaligned`).toBeLessThan(1);
    }
  }
});
