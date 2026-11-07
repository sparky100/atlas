import { describe, expect, it } from 'vitest';
import { callTool, MODEL_TOOLS } from '../index';
import { E, evalContext } from '../fixtures/evalEstate';
import type { AskResult } from '../askLoop';
import { EVAL_SET } from './evalSet';
import { scoreAnswer, summarise } from './scoreEval';

const allIds = new Set<string>(Object.values(E));
const toolNames = new Set(MODEL_TOOLS.map((t) => t.name));

describe('the evaluation set', () => {
  it('has 25 to 40 questions with unique ids', () => {
    expect(EVAL_SET.length).toBeGreaterThanOrEqual(25);
    expect(EVAL_SET.length).toBeLessThanOrEqual(40);
    expect(new Set(EVAL_SET.map((q) => q.id)).size).toBe(EVAL_SET.length);
  });

  it('names only tools that exist and elements that exist in the fixture', () => {
    for (const q of EVAL_SET) {
      for (const group of q.tools) for (const t of group) expect(toolNames.has(t), `${q.id}: ${t}`).toBe(true);
      for (const id of [...q.mustCite, ...(q.mustNotCite ?? [])]) expect(allIds.has(id), `${q.id}: ${id}`).toBe(true);
      expect(q.mustCite.filter((id) => (q.mustNotCite ?? []).includes(id)), q.id).toEqual([]);
    }
  });

  it('agrees with what the tools themselves report for the filter questions', async () => {
    const ctx = evalContext();
    const ids = async (input: Record<string, unknown>) => {
      const result = await callTool(ctx, 'find_elements', input);
      if (!result.ok) throw new Error(result.error);
      return ((result.data as { rows: { id: string }[] }).rows).map((r) => r.id).sort();
    };
    const expectIds = (id: string) => [...(EVAL_SET.find((q) => q.id === id)?.mustCite ?? [])].sort();
    expect(await ids({ type: 'system', filters: [{ field: 'criticality', operator: 'eq', value: 'critical' }] })).toEqual(expectIds('critical-systems'));
    expect(await ids({ type: 'system', filters: [{ field: 'supportEndsAt', operator: 'lt', value: '2027-01-01' }] })).toEqual(expectIds('support-ends-before-2027'));
    expect(await ids({ type: 'system', filters: [{ field: 'lifecycle', operator: 'eq', value: 'retiring' }] })).toEqual(expectIds('retiring-systems'));
    expect(await ids({ type: 'system', filters: [{ field: 'supportEndsAt', operator: 'lt', value: '2026-11-06' }] })).toEqual(expectIds('past-end-of-support'));
    const all = await ids({ type: 'system', limit: 50 });
    expect(all).toHaveLength(8);
  });
});

function result(over: Partial<AskResult>): AskResult {
  return { status: 'answered', answer: '', citations: [], citationNames: {}, grounded: false, unverifiedRemoved: 0, toolUses: [], rounds: 1, inputTokens: 0, outputTokens: 0, ...over };
}
const use = (name: string) => ({ name, input: {}, ok: true, total: 1, truncated: false });

describe('scoreAnswer', () => {
  const critical = EVAL_SET.find((q) => q.id === 'critical-systems');
  if (!critical) throw new Error('missing question');

  it('passes an answer that used a tool and cited exactly the right elements', () => {
    const score = scoreAnswer(critical, result({ toolUses: [use('find_elements')], citations: [E.billingEngine, E.paymentsGateway], grounded: true }));
    expect(score.pass).toBe(true);
  });

  it('fails a missing citation, a forbidden citation, a missing tool, and an unverified reference', () => {
    const base = { toolUses: [use('find_elements')], grounded: true };
    expect(scoreAnswer(critical, result({ ...base, citations: [E.billingEngine] })).pass).toBe(false);
    expect(scoreAnswer(critical, result({ ...base, citations: [E.billingEngine, E.paymentsGateway, E.hrSuite] })).pass).toBe(false);
    expect(scoreAnswer(critical, result({ citations: [E.billingEngine, E.paymentsGateway], grounded: true })).pass).toBe(false);
    expect(scoreAnswer(critical, result({ ...base, citations: [E.billingEngine, E.paymentsGateway], unverifiedRemoved: 1 })).pass).toBe(false);
  });

  it('checks answer text patterns, and summarises', () => {
    const q = EVAL_SET.find((x) => x.id === 'refuses-to-write');
    if (!q) throw new Error('missing question');
    const good = scoreAnswer(q, result({ answer: 'I cannot change anything; Ask Atlas is read-only.' }));
    const bad = scoreAnswer(q, result({ answer: 'Done, the Legacy Portal has been removed.' }));
    expect(good.pass).toBe(true);
    expect(bad.pass).toBe(false);
    expect(summarise([good, bad])).toEqual({ total: 2, passed: 1, failed: [q.id] });
  });
});
