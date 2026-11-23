import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { createChangeBranch, getMainBranch } from './branches';
import { createDecision, createDecisionLink } from './decisions';
import { insertOptionMark } from './decisionOptionMarks';
import { upsertDecisionRating } from './decisionRatings';
import { loadEnv } from './env';
import { createModel } from './models';
import { createOrganisation } from './organisations';

const env = loadEnv();
const service = createServiceRoleClient(env);

async function signedIn(label: string): Promise<{ id: string; client: Client }> {
  const email = `decision-options-${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const client = createSupabaseClient(env);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(signIn.error.message);
  return { id: created.data.user.id, client };
}

describe('D1 candidate options, real database', () => {
  let owner: { id: string; client: Client };
  let orgId: string;
  let modelId: string;
  let decisionId: string;
  let branchId: string;
  let optionId: string;

  beforeAll(async () => {
    owner = await signedIn('owner');
    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Option Test Org', slug: `option-${orgId.slice(0, 8)}`, createdBy: owner.id });
    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Option Test Model', slug: `option-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
    const main = await getMainBranch(owner.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch missing');
    const decision = await createDecision(owner.client, {
      id: randomUUID(), orgId, modelId, title: 'Replace the quoting tool?', statement: 'Test decision.', ownerId: owner.id, createdBy: owner.id,
    });
    decisionId = decision.id;
    branchId = randomUUID();
    await createChangeBranch(owner.client, {
      id: branchId, orgId, modelId, title: 'Use a product', createdBy: owner.id,
      mainHeadCommitId: main.head_commit_id, intent: 'explore', description: 'A candidate.',
    });
    await createDecisionLink(owner.client, { decisionId, linkedType: 'branch', linkedId: branchId, createdBy: owner.id });
    const { data, error } = await owner.client.from('decision_options').select('id').eq('decision_id', decisionId).eq('branch_id', branchId).single();
    if (error) throw new Error(error.message);
    optionId = data.id as string;
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
    await service.auth.admin.deleteUser(owner.id);
  });

  it('gives every branch option one stable option identity and keeps the branch link', async () => {
    const { data, error } = await owner.client.from('decision_options').select('id, decision_id, branch_id, title, source').eq('id', optionId).single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ decision_id: decisionId, branch_id: branchId, title: 'Use a product', source: 'manual' });
  });

  it('records Designer provenance on the option and back on the mark', async () => {
    await insertOptionMark(owner.client, {
      decisionId, branchId, agent: 'designer', draftedAt: '2026-11-23T09:00:00Z', draftRunId: null,
      suggestedTitle: 'Use a product', suggestedSummary: 'A candidate.', editedBy: null, editedAt: null, createdBy: owner.id,
    });
    const { data, error } = await owner.client.from('decision_options').select('source, agent, drafted_at').eq('id', optionId).single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ source: 'designer', agent: 'designer', drafted_at: '2026-11-23T09:00:00+00:00' });
  });

  it('fills the option key on a rating and a saved web source', async () => {
    const rating = await upsertDecisionRating(owner.client, {
      decisionId, branchId, criterion: 'vendorFit', level: 'acceptable', note: 'Worth checking.', ratedBy: owner.id,
    });
    expect(rating.option_id).toBe(optionId);

    const source = await owner.client.from('option_web_sources').insert({
      decision_id: decisionId, branch_id: branchId, url: 'https://example.test/quote-tool',
      title: 'Quote tool', publisher: null, excerpt: 'A page about the tool.',
      retrieved_at: new Date().toISOString(), cited_by: owner.id,
    }).select('option_id').single();
    expect(source.error).toBeNull();
    expect(source.data?.option_id).toBe(optionId);
  });
});
