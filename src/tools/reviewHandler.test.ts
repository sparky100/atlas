import { describe, expect, it } from 'vitest';
import { handleReview, type ReviewHandlerDeps } from './reviewHandler';

const DECISION = '00000000-0000-4000-8000-000000000010';
const MODEL = '00000000-0000-4000-8000-000000000020';
const ORG = '00000000-0000-4000-8000-000000000030';

function deps(overrides: Partial<ReviewHandlerDeps> = {}) {
  const calls: Parameters<ReviewHandlerDeps['runReview']>[0][] = [];
  const base: ReviewHandlerDeps = {
    loadDecision: () => Promise.resolve({ id: DECISION, modelId: MODEL, orgId: ORG, status: 'proposed' }),
    callerRole: () => Promise.resolve('contributor'),
    agentSettings: () => Promise.resolve({ assistantEnabled: true, agentsEnabled: true, keySet: true }),
    buildDigest: () => Promise.resolve({ text: 'DIGEST', inputHash: 'a'.repeat(64) }),
    runReview: (args) => {
      calls.push(args);
      return Promise.resolve({ text: JSON.stringify({ notes: [{ note: 'Thin evidence.', basedOn: { kind: 'none' }, question: 'What would change your mind?' }] }), status: 'answered' });
    },
    now: () => new Date('2026-11-21T12:00:00Z'),
  };
  return { deps: { ...base, ...overrides }, calls };
}

describe('handleReview', () => {
  it('rejects a malformed body', async () => {
    const { deps: d } = deps();
    expect(await handleReview(d, { decisionId: 'nope', lens: 'challenge' })).toMatchObject({ status: 'invalid' });
    expect(await handleReview(d, { decisionId: DECISION, lens: 'other' })).toMatchObject({ status: 'invalid' });
  });

  it('returns not_found for a decision the caller cannot read', async () => {
    const { deps: d } = deps({ loadDecision: () => Promise.resolve(null) });
    expect(await handleReview(d, { decisionId: DECISION, lens: 'challenge' })).toEqual({ status: 'not_found' });
  });

  it('refuses a viewer', async () => {
    const { deps: d } = deps({ callerRole: () => Promise.resolve('viewer') });
    expect(await handleReview(d, { decisionId: DECISION, lens: 'challenge' })).toMatchObject({ status: 'forbidden' });
  });

  it('refuses when the switches are off, the key is missing, or the decision is no longer proposed', async () => {
    expect(await handleReview(deps({ agentSettings: () => Promise.resolve({ assistantEnabled: false, agentsEnabled: true, keySet: true }) }).deps, { decisionId: DECISION, lens: 'challenge' })).toMatchObject({ status: 'not_enabled' });
    expect(await handleReview(deps({ agentSettings: () => Promise.resolve({ assistantEnabled: true, agentsEnabled: true, keySet: false }) }).deps, { decisionId: DECISION, lens: 'challenge' })).toMatchObject({ status: 'not_enabled' });
    const accepted = deps({ loadDecision: () => Promise.resolve({ id: DECISION, modelId: MODEL, orgId: ORG, status: 'accepted' }) });
    expect(await handleReview(accepted.deps, { decisionId: DECISION, lens: 'challenge' })).toMatchObject({ status: 'not_enabled' });
  });

  it('runs the Challenger on the standard tier and the Steward on the light tier', async () => {
    const challenge = deps();
    const challengeOut = await handleReview(challenge.deps, { decisionId: DECISION, lens: 'challenge' });
    expect(challengeOut).toMatchObject({ status: 'done', lens: 'challenge', inputHash: 'a'.repeat(64), modelStatus: 'answered' });
    expect(challenge.calls[0]?.modelTier).toBeUndefined();
    expect(challenge.calls[0]?.user).toContain('DIGEST');
    expect(challenge.calls[0]?.system).toContain('Challenger');

    const cyber = deps();
    await handleReview(cyber.deps, { decisionId: DECISION, lens: 'cyber' });
    expect(cyber.calls[0]?.modelTier).toBe('light');
    expect(cyber.calls[0]?.system).toContain('Steward');
  });

  it('says a cut-off run may be incomplete, even when some notes arrived', async () => {
    const { deps: d } = deps({ runReview: () => Promise.resolve({ text: JSON.stringify({ notes: [] }), status: 'incomplete' }) });
    const out = await handleReview(d, { decisionId: DECISION, lens: 'data' });
    expect(out).toMatchObject({ status: 'done', modelStatus: 'incomplete' });
    expect((out as { problems: string[] }).problems.join(' ')).toContain('incomplete');
  });
});
