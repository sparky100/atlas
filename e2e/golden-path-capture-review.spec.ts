/**
 * F2 (full K1) PR16, SPEC-capture.md §13's own test plan (row renamed here
 * from that row's own literal `capture-review.spec.ts` — CLAUDE.md's
 * coverage rule and `playwright.config.ts`'s `chromium-390` project both
 * key off the literal `golden-path-*.spec.ts` prefix, so the unprefixed
 * name would silently never run at 390px and would not count as coverage
 * at all; SPEC-capture.md's own row is corrected to match): upload a
 * spreadsheet, accept one candidate and reject another by keyboard, apply
 * onto a freshly-created change, and confirm the accepted one really
 * landed there. A second test covers fixture 09 (`NO_TEXT_LAYER`) failing
 * with a plain explanation.
 *
 * Needs a real Supabase, a real `capture-run` deployment, and (for
 * fixture 01's own capability-assignment rows) working LLM connectivity —
 * this repo's own standing sandbox limitation (no Docker Hub route here)
 * applies same as every other Playwright spec in this repository; written
 * and reasoned through, not executed. `pnpm db:start && pnpm exec
 * playwright test` runs it for real once EDGE-FUNCTIONS.md's own
 * capture-run live-verification step has been done once.
 *
 * Uses the real, committed fixture files from `src/capture/fixtures/`
 * (the same ones `src/capture/fixtures.test.ts` and `scripts/scoreCapture.ts`
 * already validate offline) rather than an inline buffer — SPEC-capture.md's
 * own line names "fixture 01"/"fixture 09" specifically, and this is the
 * one thing on disk those names actually refer to.
 *
 * The one part of SPEC-capture.md's own test plan this spec can't reach:
 * "assert the element exists on the branch's to-be view with a ⚙ badge."
 * Once promoted, the accepted system exists only on the freshly-created,
 * not-yet-merged change branch — and nothing in this app today links to a
 * not-yet-merged element's own page from anywhere reachable by clicking
 * (Home's own search reads only main's materialised head, `elementSearch.ts`'s
 * own module comment; ChangeView.tsx's "Edits on this change" list names
 * each subject but never links it). Reaching it would need a URL built by
 * hand, which S2's own click-only discipline rules out — so this spec
 * confirms the accepted system by name on the change's own "Edits on this
 * change" list instead, and stops short of the badge assertion rather than
 * faking a click path that doesn't exist yet.
 *
 * **Amended, Sprint F2b:** a third test covers what this sprint added —
 * uploading a JSON file (rather than a spreadsheet) and bulk-accepting
 * every candidate with `x`/`a` rather than one keystroke per row — the
 * mitigation for folding F2-lite's own one-shot commit into K1's
 * always-review-first design (SPEC-capture.md's own Sprint F2b amendment
 * to §10). Its own input is a small ad-hoc JSON payload written to a temp
 * file at test time (`testInfo.outputPath`), not one of the checked-in
 * `src/capture/fixtures/` — those exist for `fixtures.test.ts`'s own
 * offline replay gate, and none of them happens to produce an
 * all-`new`/all-`confirm` result with no `capability` field (so no LLM
 * call, matching this file's other two tests) other than fixture 11,
 * which is `.xlsx`; a few inline lines are simpler here than reusing a
 * fixture shaped for a different point.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { goToModelHome, signUpCreateOrgAndModel, clickNavItem } from './fixtures/goldenPath';

const FIXTURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'capture', 'fixtures');

test('upload a spreadsheet, accept and reject candidates by keyboard, and see the accepted one on the promoted change', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'capturegolden');

  await goToModelHome(page);
  await clickNavItem(page, 'Capture');
  await expect(page.getByRole('heading', { name: 'Capture' })).toBeVisible();
  await page.getByRole('button', { name: 'New capture run' }).click();

  await expect(page.getByRole('dialog', { name: 'Start a capture run' })).toBeVisible();
  await page.getByLabel('Choose a CSV, XLSX, JSON, or PDF file').setInputFiles(path.join(FIXTURES_DIR, '01-clean-register', 'input.csv'));
  const startButton = page.getByRole('button', { name: 'Start capture run' });
  await expect(startButton).toBeEnabled();
  await startButton.click();

  // The dialog closes the moment the job row exists — uploading the file
  // and inserting the row are both real network calls, so this can take a
  // moment longer than the default assertion timeout.
  await expect(page.getByRole('dialog', { name: 'Start a capture run' })).toHaveCount(0, { timeout: 30_000 });
  // One `capture-run` invocation runs the whole pipeline (K-12's own
  // job-level-retry-only narrowing) — this list polls for the result
  // rather than the browser waiting on the invocation's own promise, so
  // the wait here is for however long parse→extract→match→write actually
  // takes for real, not a fixed short timeout.
  await expect(page.getByText('Parsed', { exact: true })).toBeVisible({ timeout: 120_000 });

  await page.getByRole('link', { name: 'Review →' }).click();
  await expect(page.getByRole('heading', { name: 'New', exact: false })).toBeVisible();

  // CRM and Billing are fixture 01's own first two rows — selecting each
  // by name (rather than relying on either also being the default-selected
  // candidate) keeps this test's own outcome independent of candidate
  // ordering within the "New" group.
  await page.getByText('CRM', { exact: true }).click();
  await page.keyboard.press('a');
  await expect(page.getByText('accepted', { exact: true }).first()).toBeVisible();

  await page.getByPlaceholder('or name a new change…').fill('Promote captured systems');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('#capture-review-target-branch')).toHaveValue(/.+/);

  await page.keyboard.press('Control+Enter');
  await expect(page.getByText(/^Applied \d+ candidate/)).toBeVisible({ timeout: 15_000 });

  // Billing is rejected instead — `atlas.stage_capture_decisions` persists
  // one action at a time (SPEC §8.2), never behind a batch "save" the
  // reviewer could forget, so the choice has to survive a reload on its
  // own with no further action from here.
  await page.getByText('Billing', { exact: true }).click();
  await page.keyboard.press('r');
  await expect(page.getByText('rejected', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('rejected', { exact: true }).first()).toBeVisible();

  // The accepted system is a real edit on the change just created.
  await goToModelHome(page);
  await page.getByRole('link', { name: 'Changes' }).click();
  await page.getByRole('link', { name: 'Open →' }).click();
  await expect(page.getByRole('heading', { name: 'Edits on this change' })).toBeVisible();
  await expect(page.getByText('CRM', { exact: true })).toBeVisible();
});

test('a scanned PDF with no text layer fails with a plain explanation', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'capturescanned');

  await goToModelHome(page);
  await clickNavItem(page, 'Capture');
  await page.getByRole('button', { name: 'New capture run' }).click();
  await expect(page.getByRole('dialog', { name: 'Start a capture run' })).toBeVisible();
  await page.getByLabel('Choose a CSV, XLSX, JSON, or PDF file').setInputFiles(path.join(FIXTURES_DIR, '09-scanned', 'input.pdf'));
  const startButton = page.getByRole('button', { name: 'Start capture run' });
  await expect(startButton).toBeEnabled();
  await startButton.click();
  await expect(page.getByRole('dialog', { name: 'Start a capture run' })).toHaveCount(0, { timeout: 30_000 });

  // `runCapture.ts`'s own `NO_TEXT_LAYER` message ("This PDF is scanned...")
  // — this fails before any LLM call at all, so it needs no live model
  // connectivity, unlike the first test above.
  await expect(page.getByText(/scanned/i)).toBeVisible({ timeout: 60_000 });
});

test('upload a JSON file, bulk-accept every new candidate by keyboard, and apply', async ({ page }, testInfo) => {
  // Sprint F2b: JSON as a capture input format, and bulk-accept (`x` then
  // `a` on a multi-selection) for the common "clean register" case — before
  // this sprint, a clean spreadsheet or JSON file with no ambiguity still
  // needed one keystroke per row, a real regression against F2-lite's own
  // one-shot commit for exactly this case. Two systems, no LLM call needed
  // (no `capability`/prose entries), no existing model to match against —
  // every candidate lands in "New".
  const inputPath = testInfo.outputPath('two-systems.json');
  await fs.writeFile(
    inputPath,
    JSON.stringify({
      systems: [
        { name: 'Billing Platform', description: 'Handles customer invoicing.', confidence: 1 },
        { name: 'Fleet Tracker', description: 'Tracks vehicle locations.', confidence: 1 },
      ],
    }),
  );

  await signUpCreateOrgAndModel(page, 'capturejson');

  await goToModelHome(page);
  await clickNavItem(page, 'Capture');
  await page.getByRole('button', { name: 'New capture run' }).click();
  await expect(page.getByRole('dialog', { name: 'Start a capture run' })).toBeVisible();
  await page.getByLabel('Choose a CSV, XLSX, JSON, or PDF file').setInputFiles(inputPath);
  const startButton = page.getByRole('button', { name: 'Start capture run' });
  await expect(startButton).toBeEnabled();
  await startButton.click();
  await expect(page.getByRole('dialog', { name: 'Start a capture run' })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText('Parsed', { exact: true })).toBeVisible({ timeout: 120_000 });

  await page.getByRole('link', { name: 'Review →' }).click();
  await expect(page.getByRole('heading', { name: 'New', exact: false })).toBeVisible();

  await page.getByText('Billing Platform', { exact: true }).click();
  await page.keyboard.press('x');
  await page.getByText('Fleet Tracker', { exact: true }).click();
  await page.keyboard.press('x');
  await page.keyboard.press('a');
  await expect(page.getByText('accepted', { exact: true }).first()).toBeVisible();

  await page.getByPlaceholder('or name a new change…').fill('Add Billing Platform and Fleet Tracker');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('#capture-review-target-branch')).toHaveValue(/.+/);

  await page.keyboard.press('Control+Enter');
  await expect(page.getByText(/^Applied \d+ candidate/)).toBeVisible({ timeout: 15_000 });

  await goToModelHome(page);
  await page.getByRole('link', { name: 'Changes' }).click();
  await page.getByRole('link', { name: 'Open →' }).click();
  await expect(page.getByRole('heading', { name: 'Edits on this change' })).toBeVisible();
  await expect(page.getByText('Billing Platform', { exact: true })).toBeVisible();
  await expect(page.getByText('Fleet Tracker', { exact: true })).toBeVisible();
});
