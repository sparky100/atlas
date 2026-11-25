/**
 * Cross-organisation boundary tests (CLAUDE.md rule 9) for the D1 and D4
 * tables and functions added after 20 Nov 2026 that had no such test:
 *
 *  - `decision_options` and `atlas.work_on_decision_option`
 *    (20261123090000_decision_options.sql, 20261123120000_work_on_decision_option.sql)
 *  - `decision_gaps` (20261123150000_decision_gaps.sql)
 *  - `web_research_requests` (20261122080000_web_research_guarded.sql)
 *
 * Each block is run as a signed-in owner of a DIFFERENT organisation, and as a
 * viewer of the same organisation where the role gate matters, against a real
 * local Supabase. None of these tables may be read or written across the
 * organisation boundary.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChangeBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { deleteDecisionGap, listDecisionGaps, recordDecisionGap } from './decisionGaps';
import { createDecisionOption, listDecisionOptions, workOnDecisionOption } from './decisionOptions';
import { createDecision, createDecisionLink } from './decisions';
import { loadEnv } from './env';
import { createModel } from './models';
import { createOrganisation } from './organisations';

const env = loadEnv();
const service = createServiceRoleClient(env);

interface TestUser {
  id: string;
  client: Client;
}

async function signedIn(label: string): Promise<TestUser> {
  const email = `cross-org-${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(`signedIn(${label}): ${created.error.message}`);
  const client = createSupabaseClient(env);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`signedIn(${label}) sign-in: ${signIn.error.message}`);
  return { id: created.data.user.id, client };
}

describe('cross-organisation boundaries for options, gaps and research requests', () => {
  let owner: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;
  let orgId: string;
  let otherOrgId: string;
  let modelId: string;

  beforeAll(async () => {
    owner = await signedIn('owner');
    viewer = await signedIn('viewer');
    outsider = await signedIn('outsider');
    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Boundary Org', slug: `boundary-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert({ org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: owner.id });
    if (memberError) throw new Error(`adding viewer: ${memberError.message}`);
    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Boundary Model', slug: `boundary-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
    otherOrgId = randomUUID();
    await createOrganisation(outsider.client, { id: otherOrgId, name: 'Outsider Org', slug: `outsider-${otherOrgId.slice(0, 8)}`, createdBy: outsider.id });
  });

  afterAll(async () => {
    await service.auth.admin.deleteUser(owner.id);
    await service.auth.admin.deleteUser(viewer.id);
    await service.auth.admin.deleteUser(outsider.id);
  });

  /** A proposed decision with one branch-backed option and one branchless candidate. */
  async function seed(): Promise<{ decisionId: string; branchId: string; candidateId: string }> {
    const main = await getMainBranch(owner.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const decision = await createDecision(owner.client, { id: randomUUID(), orgId, modelId, title: 'Quote a connection in two days?', statement: 'Boundary test.', ownerId: owner.id, createdBy: owner.id });
    const branchId = randomUUID();
    await createChangeBranch(owner.client, { id: branchId, orgId, modelId, title: 'Configure the CRM', createdBy: owner.id, mainHeadCommitId: main.head_commit_id, intent: 'explore' });
    await createDecisionLink(owner.client, { decisionId: decision.id, linkedType: 'branch', linkedId: branchId, createdBy: owner.id });
    const candidate = await createDecisionOption(owner.client, { decisionId: decision.id, title: 'Buy a quoting product', createdBy: owner.id });
    return { decisionId: decision.id, branchId, candidateId: candidate.id };
  }

  describe('decision_options and work_on_decision_option', () => {
    it('an outsider cannot read the options', async () => {
      const { decisionId } = await seed();
      expect(await listDecisionOptions(owner.client, decisionId)).toHaveLength(2);
      expect(await listDecisionOptions(outsider.client, decisionId)).toEqual([]);
    });

    it('an outsider cannot add, rename or work on an option', async () => {
      const { decisionId, candidateId } = await seed();
      await expect(createDecisionOption(outsider.client, { decisionId, title: 'Injected option', createdBy: outsider.id })).rejects.toThrow();

      const { data: renamed, error: renameError } = await outsider.client.from('decision_options').update({ title: 'Renamed by outsider' }).eq('id', candidateId).select('id');
      // RLS hides the row, so the update matches nothing rather than erroring.
      expect(renameError === null ? renamed : []).toEqual([]);

      await expect(workOnDecisionOption(outsider.client, candidateId)).rejects.toThrow();

      const after = await listDecisionOptions(owner.client, decisionId);
      const candidate = after.find((o) => o.id === candidateId);
      expect(candidate?.title).toBe('Buy a quoting product');
      expect(candidate?.branch_id).toBeNull();
    });

    it('a viewer can read but cannot add or work on an option', async () => {
      const { decisionId, candidateId } = await seed();
      expect(await listDecisionOptions(viewer.client, decisionId)).toHaveLength(2);
      await expect(createDecisionOption(viewer.client, { decisionId, title: 'Viewer option', createdBy: viewer.id })).rejects.toThrow();
      await expect(workOnDecisionOption(viewer.client, candidateId)).rejects.toThrow();
    });
  });

  describe('decision_gaps', () => {
    it('an outsider can neither read, record nor remove a gap', async () => {
      const { decisionId, branchId } = await seed();
      const gap = await recordDecisionGap(owner.client, { decisionId, branchId, origin: 'research', body: 'No UK reference site found for this product.', userId: owner.id });
      expect(await listDecisionGaps(outsider.client, decisionId)).toEqual([]);

      await expect(recordDecisionGap(outsider.client, { decisionId, branchId: null, origin: 'manual', body: 'Injected gap.', userId: outsider.id })).rejects.toThrow();

      // RLS hides the row from the outsider, so the delete matches nothing.
      await deleteDecisionGap(outsider.client, gap.id).catch(() => undefined);
      expect((await listDecisionGaps(owner.client, decisionId)).map((g) => g.id)).toEqual([gap.id]);
    });

    it('a viewer can read a gap but cannot record or remove one', async () => {
      const { decisionId } = await seed();
      const gap = await recordDecisionGap(owner.client, { decisionId, branchId: null, origin: 'catalogue', body: 'No catalogue product covers quoting.', userId: owner.id });
      expect((await listDecisionGaps(viewer.client, decisionId)).map((g) => g.id)).toEqual([gap.id]);
      await expect(recordDecisionGap(viewer.client, { decisionId, branchId: null, origin: 'manual', body: 'Viewer gap.', userId: viewer.id })).rejects.toThrow();
      await deleteDecisionGap(viewer.client, gap.id).catch(() => undefined);
      expect((await listDecisionGaps(owner.client, decisionId)).map((g) => g.id)).toEqual([gap.id]);
    });
    it('someone removed from the organisation can no longer remove the gap they recorded', async () => {
      const { decisionId } = await seed();
      const leaver = await signedIn('leaver');
      const { error: addError } = await owner.client.from('members').insert({ org_id: orgId, user_id: leaver.id, role: 'contributor', invited_by: owner.id });
      if (addError) throw new Error(`adding leaver: ${addError.message}`);
      const gap = await recordDecisionGap(leaver.client, { decisionId, branchId: null, origin: 'manual', body: 'No pricing found.', userId: leaver.id });
      const { error: removeError } = await service.from('members').delete().eq('org_id', orgId).eq('user_id', leaver.id);
      if (removeError) throw new Error(`removing leaver: ${removeError.message}`);
      await deleteDecisionGap(leaver.client, gap.id).catch(() => undefined);
      expect((await listDecisionGaps(owner.client, decisionId)).map((g) => g.id)).toContain(gap.id);
      await service.auth.admin.deleteUser(leaver.id);
    });
  });

  describe('web_research_requests', () => {
    it('an outsider can neither read nor write the egress record', async () => {
      const { decisionId, branchId } = await seed();
      const { error: seedError } = await owner.client.from('web_research_requests').insert({
        org_id: orgId, decision_id: decisionId, branch_id: branchId, requested_by: owner.id,
        query: 'connection quote software UK DNO', status: 'ok', result_count: 0, urls: [],
      });
      expect(seedError).toBeNull();

      const { data: seen, error: readError } = await outsider.client.from('web_research_requests').select('id').eq('decision_id', decisionId);
      expect(readError).toBeNull();
      expect(seen).toEqual([]);

      // Neither with the decision's organisation nor with the outsider's own.
      for (const claimedOrg of [orgId, otherOrgId]) {
        const { error } = await outsider.client.from('web_research_requests').insert({
          org_id: claimedOrg, decision_id: decisionId, branch_id: branchId, requested_by: outsider.id,
          query: 'injected query', status: 'ok', result_count: 0, urls: [],
        });
        expect(error).not.toBeNull();
      }

      const { data: rows } = await owner.client.from('web_research_requests').select('id').eq('decision_id', decisionId);
      expect(rows).toHaveLength(1);
    });

    it('a viewer can read the record but cannot write one', async () => {
      const { decisionId, branchId } = await seed();
      const { error } = await viewer.client.from('web_research_requests').insert({
        org_id: orgId, decision_id: decisionId, branch_id: branchId, requested_by: viewer.id,
        query: 'viewer query', status: 'ok', result_count: 0, urls: [],
      });
      expect(error).not.toBeNull();
    });
  });
});
