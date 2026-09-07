/**
 * Sprint U1 step 4b's required perf test (UI-principles.md §8.6, ADR-015):
 * a generated 2,000-system/4,000-edge landscape, scripted pan+zoom for
 * ~3s, ≥55fps p50 / ≥45fps p5 measured via `requestAnimationFrame` timing
 * on CI's software renderer — and, per ADR-015's own amendment, the
 * `commit_deltas` payload size for a single-element edit against that same
 * model, so the client-computed-head tradeoff it accepted has a measured
 * number, not a guess.
 *
 * Same "cannot run in this authoring sandbox" limitation as every other
 * Playwright/integration test in this repo (playwright.config.ts's own
 * comment, src/db/repository.integration.test.ts's module comment): the
 * FPS test needs a real built app, real auth, and a real local Supabase.
 * The payload-size test needs none of that — it runs the real engine
 * (`fold`/`serializeHeadProjection`) against the fixture in plain Node, so
 * it's the one part of this file verified in the authoring sandbox itself.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import { createServiceRoleClient, createSupabaseClient } from '../src/db/client';
import { getMainBranch } from '../src/db/branches';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { emptyHead, fold } from '../src/engine/deltas';
import { serializeHeadProjection } from '../src/engine/projection';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { EDGE_COUNT, generateLandscapeFixture, singleAttributeEditDelta, SYSTEM_COUNT } from './fixtures/landscapeFixture';

test.describe('landscape performance (Sprint U1 step 4b, ADR-015)', () => {
  test('commit_deltas payload size for a single-element edit stays within budget', () => {
    const sourceId = randomUUID();
    const authorId = randomUUID();
    const ctx = { authorId, createdAt: new Date().toISOString() };

    const head = fold(emptyHead(), generateLandscapeFixture(sourceId), ctx);
    const headAfterEdit = fold(head, [singleAttributeEditDelta(sourceId)], ctx);
    const projection = serializeHeadProjection(headAfterEdit);
    const payload = { elementsHead: projection.elementsHead, relationshipsHead: projection.relationshipsHead, facts: projection.facts };
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');

    // Measured baseline against this exact fixture (2,010 elements, 6,000
    // relationships, ~16,000 facts): ~8.45 MB. Budgeted with headroom so
    // this doesn't flake on an incidental serialisation-format change —
    // it exists to catch a real regression (e.g. a duplicated array, or a
    // fact row that no longer clears an optional field to null), not a
    // few-percent wobble. If this ever needs raising, replace the number,
    // don't delete the test — that's the whole point of ADR-015 having one.
    const BUDGET_BYTES = 12 * 1024 * 1024;
    expect(bytes, `commit_deltas payload for a single-element edit was ${(bytes / 1024 / 1024).toFixed(2)}MB`).toBeLessThan(BUDGET_BYTES);
  });

  test('scripted pan+zoom holds ≥55fps p50 / ≥45fps p5 on a 2,000-system/4,000-edge landscape', async ({ page }) => {
    test.setTimeout(120_000);

    const env = loadEnv();
    const service = createServiceRoleClient(env);

    const email = `perf-${randomUUID()}@example.test`;
    const password = `${randomUUID()}Aa1!`;
    const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError) throw new Error(`perf fixture user: ${createError.message}`);
    const userId = created.user.id;

    const signedIn = createSupabaseClient(env);
    const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`perf fixture sign-in: ${signInError.message}`);

    try {
      const orgId = randomUUID();
      const orgSlug = `perf-${orgId.slice(0, 8)}`;
      await createOrganisation(signedIn, { id: orgId, name: 'Perf Org', slug: orgSlug, createdBy: userId });

      const modelId = randomUUID();
      const modelSlug = `perf-landscape-${modelId.slice(0, 8)}`;
      await createModel(signedIn, { id: modelId, orgId, name: 'Perf Landscape', slug: modelSlug, createdBy: userId });

      // Bootstraps main's genesis commit as service_role. Not a stand-in
      // for atlas.seed_from_map any more — that function exists now
      // (supabase/migrations/20260906120000_seed_from_map.sql) — but it
      // seeds a model from a capability_maps template, which can only ever
      // produce `capability` elements; this fixture needs an arbitrary
      // System-only generated landscape (SYSTEM_COUNT/EDGE_COUNT below),
      // which no product code path can create a genesis commit for yet
      // (docs/AUDIT-2026-09-U2.md's cross-cutting finding: there is still
      // no way to get a model's first commit outside a capability-map
      // import). Same bootstrap as src/db/repository.integration.test.ts's
      // own beforeAll, for the same reason.
      const main = await getMainBranch(service, modelId);
      if (!main) throw new Error('main branch was not auto-created');
      const genesisCommitId = randomUUID();
      const { error: genesisError } = await service
        .from('commits')
        .insert({ id: genesisCommitId, org_id: orgId, model_id: modelId, branch_id: main.id, parent_commit_id: null, kind: 'template_seed', message: 'seed', author_id: userId, depth: 0 });
      if (genesisError) throw new Error(`genesis commit: ${genesisError.message}`);
      const { error: headError } = await service.from('branches').update({ head_commit_id: genesisCommitId }).eq('id', main.id);
      if (headError) throw new Error(`advancing main head: ${headError.message}`);

      const sourceId = randomUUID();
      const { error: sourceError } = await signedIn.from('sources').insert({ id: sourceId, org_id: orgId, model_id: modelId, kind: 'manual', name: 'Manual entry', user_id: userId, created_by: userId });
      if (sourceError) throw new Error(`fixture source: ${sourceError.message}`);

      const envelope: CommitEnvelope = {
        id: randomUUID(),
        branchId: main.id,
        parentCommitId: genesisCommitId,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        message: `generated ${String(SYSTEM_COUNT)}-system/${String(EDGE_COUNT)}-edge landscape fixture`,
        deltas: generateLandscapeFixture(sourceId),
      };
      const commitResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
      if (!commitResult.ok) throw new Error(`seeding the landscape fixture: ${commitResult.message}`);

      await page.goto('/sign-in');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

      await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
      const canvas = page.locator('canvas');
      // Not just "the canvas exists" — the aria-label only reflects the
      // real node count once the worker's layout has actually landed
      // (useLandscape's `status: 'ready'`), so this is the real readiness
      // signal, not a fixed sleep standing in for one. 90s, not the
      // default: seeding this fixture is a single ~8MB commit_deltas
      // payload (the sibling test's own measured baseline) inserting
      // ~2,010 elements/6,000 relationships in one transaction — real
      // headroom within this test's own 120s budget, not a flake cover-up.
      await expect(canvas).toHaveAttribute('aria-label', new RegExp(`${String(SYSTEM_COUNT)} systems`), { timeout: 90_000 });

      const box = await canvas.boundingBox();
      if (!box) throw new Error('landscape canvas has no bounding box');
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;

      const frameTimesPromise = page.evaluate(
        () =>
          new Promise<number[]>((resolve) => {
            const times: number[] = [];
            const start = performance.now();
            function tick(now: number): void {
              times.push(now);
              if (now - start < 3000) requestAnimationFrame(tick);
              else resolve(times);
            }
            requestAnimationFrame(tick);
          }),
      );

      // The actual stress: a continuous pan-and-zoom gesture for the same
      // ~3s window the rAF sampler above is running in. An idle canvas
      // would pass any fps budget trivially and prove nothing about §8.6.
      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      for (let i = 0; i < 15; i++) {
        const dx = i % 2 === 0 ? 40 : -40;
        const dy = i % 2 === 0 ? 20 : -20;
        await page.mouse.move(centerX + dx, centerY + dy, { steps: 5 });
        await page.mouse.wheel(0, i % 2 === 0 ? -80 : 80);
      }
      await page.mouse.up();

      const frameTimes = await frameTimesPromise;
      const frameDurations: number[] = [];
      for (let i = 1; i < frameTimes.length; i++) {
        const previous = frameTimes[i - 1];
        const current = frameTimes[i];
        if (previous !== undefined && current !== undefined) frameDurations.push(current - previous);
      }
      const fps = frameDurations.filter((d) => d > 0).map((d) => 1000 / d);
      fps.sort((a, b) => a - b);
      const p5 = fps[Math.floor(fps.length * 0.05)];
      const p50 = fps[Math.floor(fps.length * 0.5)];

      expect(p50, `p50 fps was ${JSON.stringify(p50)}`).toBeGreaterThanOrEqual(55);
      expect(p5, `p5 fps was ${JSON.stringify(p5)}`).toBeGreaterThanOrEqual(45);

      await service.from('organisations').delete().eq('id', orgId);
    } finally {
      await service.auth.admin.deleteUser(userId);
    }
  });
});
