/**
 * Integration tests for S1 item 16 (docs/prompts/atlas-prompt-pack.md:110)
 * against a real local Supabase — same "needs a running `supabase start`"
 * limitation as `src/db/repository.integration.test.ts`'s own module
 * comment.
 *
 *  - `atlas.dismiss_identity_pair_on_branch` (`20260913020000_branch_identity_dismissals.sql`):
 *    the branch-scoped counterpart to `atlas.dismiss_identity_pair`, for
 *    the pre-submission window `BranchRebasePanel.tsx` covers — same
 *    round-trip/idempotency shape `reviewQueueHardening.integration.test.ts`
 *    already proves for the merge-request-scoped RPC.
 *  - Viewer visibility before/after `shared_for_review`
 *    (`docs/AUDIT-2026-09-12.md`'s own "not found" gap; SPEC §10.2/P-23):
 *    a viewer-role member cannot see a draft change branch at all, and can
 *    once it flips to `shared_for_review = true`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChangeBranch, dismissIdentityPairOnBranch, getBranch, getMainBranch, updateBranchMetadata } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { loadEnv } from './env';
import { createModel } from './models';
import { createOrganisation } from './organisations';

const env = loadEnv();
const service = createServiceRoleClient(env);

async function createSignedInUser(label: string): Promise<{ id: string; client: Client }> {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw new Error(`createSignedInUser(${label}): ${createError.message}`);
  const signIn = createSupabaseClient(env);
  const { error: signInError } = await signIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`createSignedInUser(${label}) sign-in: ${signInError.message}`);
  return { id: created.user.id, client: signIn };
}

describe('BranchRebasePanel hardening against a real local Supabase (S1 item 16)', () => {
  let alice: { id: string; client: Client }; // owner
  let carol: { id: string; client: Client }; // viewer
  let orgId: string;
  let modelId: string;

  beforeAll(async () => {
    alice = await createSignedInUser('rebasehardening-alice');
    carol = await createSignedInUser('rebasehardening-carol');

    orgId = randomUUID();
    await createOrganisation(alice.client, { id: orgId, name: 'Rebase Hardening Test Org', slug: `rebasehardening-${orgId.slice(0, 8)}`, createdBy: alice.id });

    modelId = randomUUID();
    await createModel(alice.client, { id: modelId, orgId, name: 'Rebase Hardening Test Model', slug: `rebasehardening-model-${modelId.slice(0, 8)}`, createdBy: alice.id });

    const { error: inviteCarolError } = await alice.client.from('members').insert({ org_id: orgId, user_id: carol.id, role: 'viewer', invited_by: alice.id });
    if (inviteCarolError) throw new Error(`invite carol: ${inviteCarolError.message}`);
  });

  afterAll(async () => {
    await service.auth.admin.deleteUser(alice.id);
    await service.auth.admin.deleteUser(carol.id);
  });

  it('dismiss_identity_pair_on_branch persists across a fresh fetch, and dismissing the same pair twice is a no-op', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const branch = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `identity-dismiss-${randomUUID().slice(0, 8)}`, createdBy: alice.id, mainHeadCommitId: main.head_commit_id });
    expect(branch.dismissed_identity_pairs).toEqual([]);

    const pairKey = ['element-a', 'element-b'].sort().join(' ');
    const afterDismiss = await dismissIdentityPairOnBranch(alice.client, branch.id, pairKey);
    expect(afterDismiss.dismissed_identity_pairs).toEqual([pairKey]);

    // A fresh fetch (a reload, or a second contributor opening the same
    // draft) sees the dismissal — not the local-only `useState` this item
    // replaces in BranchRebasePanel.tsx.
    const refetched = await getBranch(alice.client, branch.id);
    expect(refetched?.dismissed_identity_pairs).toEqual([pairKey]);

    // Idempotent: dismissing the same pair again doesn't duplicate it.
    await dismissIdentityPairOnBranch(alice.client, branch.id, pairKey);
    const refetchedAgain = await getBranch(alice.client, branch.id);
    expect(refetchedAgain?.dismissed_identity_pairs).toEqual([pairKey]);
  });

  it('a viewer cannot see a draft change branch, and can once it is shared_for_review', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const branch = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `viewer-visibility-${randomUUID().slice(0, 8)}`, createdBy: alice.id, mainHeadCommitId: main.head_commit_id });
    expect(branch.shared_for_review).toBe(false);

    // SPEC §10.2/P-23: a viewer sees main, tagged commits, and
    // shared_for_review branches — nothing on an ordinary draft. RLS makes
    // the row simply not selectable (getBranch's own `.maybeSingle()`
    // returns null), not an error.
    const beforeShare = await getBranch(carol.client, branch.id);
    expect(beforeShare).toBeNull();

    await updateBranchMetadata(alice.client, branch.id, { sharedForReview: true });

    const afterShare = await getBranch(carol.client, branch.id);
    expect(afterShare?.id).toBe(branch.id);
    expect(afterShare?.shared_for_review).toBe(true);
  });
});
