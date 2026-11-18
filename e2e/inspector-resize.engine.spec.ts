/**
 * The shared Inspector's drag handle: keyboard and mouse resize within
 * 260-640px, double-click/Enter reset to 300px, the width remembered per
 * device (localStorage) across a reload, and no handle on a phone width
 * where the Inspector stacks full width. Deep-links to the capability map,
 * so it is `.engine` coverage, not a golden path.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('inspector resize: keyboard, drag, reset and remembered width; hidden on a phone', async ({ page }) => {
  const env = loadEnv();

  const email = `inspector-resize-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-map-inspector fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-map-inspector fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `inspector-resize-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Inspector Resize Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `inspector-resize-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Inspector Resize Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const rootId = randomUUID();
  const systemId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: rootId, elementType: 'capability', name: 'Housing', parentId: null, attributes: { code: '1' }, sourceId: seedSourceId, confidence: 1 },
    {
      kind: 'element.create',
      id: randomUUID(),
      elementId: systemId,
      elementType: 'system',
      name: 'Housing Portal',
      parentId: null,
      attributes: { lifecycleStatus: 'active', criticality: 'critical', isExternal: false },
      sourceId: seedSourceId,
      confidence: 1,
    },
    {
      kind: 'relationship.create',
      id: randomUUID(),
      relationshipId: randomUUID(),
      relationshipType: 'supports',
      fromElementId: systemId,
      toElementId: rootId,
      attributes: { role: 'primary' },
      sourceId: seedSourceId,
      confidence: 1,
    },
  ];

  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed one L1 capability with a critical supporting system',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding the capability-map-inspector fixture: ${seedResult.message}`);

  const url = `/o/${orgSlug}/m/${modelSlug}/capability-map`;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url);
  await expect(page.getByText('Housing', { exact: true })).toBeVisible();

  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  const handle = page.getByRole('separator', { name: 'Resize inspector' });
  const boxOf = async (l: typeof inspector) => {
    const b = await l.boundingBox();
    if (!b) throw new Error('element has no bounding box');
    return b;
  };
  const width = async () => Math.round((await boxOf(inspector)).width);

  await expect.poll(width).toBe(300);

  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(width).toBe(316);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(width).toBe(380);
  await page.keyboard.press('Home');
  await expect.poll(width).toBe(260);
  await page.keyboard.press('End');
  await expect.poll(width).toBe(640);
  await page.keyboard.press('Enter');
  await expect.poll(width).toBe(300);

  // Drag the handle 100px left: the panel grows by 100px.
  const box = await boxOf(handle);
  const x = box.x + box.width / 2;
  const y = box.y + 40;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(width).toBe(400);

  // Remembered across a reload (per device).
  await page.reload();
  await expect(page.getByText('Housing', { exact: true })).toBeVisible();
  await expect.poll(width).toBe(400);

  // Double-click resets.
  await handle.dblclick();
  await expect.poll(width).toBe(300);

  // A smaller window keeps the panel within half the page.
  await handle.focus();
  await page.keyboard.press('End');
  await page.setViewportSize({ width: 900, height: 900 });
  await expect.poll(width).toBeLessThanOrEqual(450);

  // Phone width: Inspector stacks full width and the handle is gone.
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(handle).toBeHidden();
  await expect.poll(width).toBeGreaterThan(300);
});
