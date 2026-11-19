import { describe, expect, it } from 'vitest';
import { handleAsk, parseAskBody } from './askHandler';
import type { AskHandlerDeps } from './askHandler';
import type { AskModelClient } from './askLoop';
import { estateContext, uid } from './fixtures/estateSnapshot';

const MODEL = { id: uid(5000), orgId: uid(6000), name: 'Estate' };
const ANSWER: AskModelClient = { complete: () => Promise.resolve({ text: 'Nothing found.', stopReason: 'end_turn', inputTokens: 1, outputTokens: 1 }) };

function deps(over: Partial<AskHandlerDeps> = {}): AskHandlerDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    loadModel: () => Promise.resolve(MODEL),
    isEnabled: () => Promise.resolve(true),
    shareRunCost: () => Promise.resolve(false),
    mainCommit: () => Promise.resolve(uid(7000)),
    createContext: () => {
      calls.push('context');
      return estateContext();
    },
    createClient: () => {
      calls.push('client');
      return ANSWER;
    },
    ...over,
  };
}
const body = { modelId: MODEL.id, question: 'What do we have?' };

describe('handleAsk', () => {
  it('answers when the model is readable and the organisation has switched Ask Atlas on', async () => {
    const outcome = await handleAsk(deps(), body);
    expect(outcome.status).toBe('done');
  });

  it('refuses before anything is read or sent when Ask Atlas is off', async () => {
    const d = deps({ isEnabled: () => Promise.resolve(false) });
    expect((await handleAsk(d, body)).status).toBe('disabled');
    expect(d.calls).toEqual([]);
  });

  it('treats a model the caller cannot read as not found, without revealing whether it exists', async () => {
    const d = deps({ loadModel: () => Promise.resolve(null), isEnabled: () => Promise.reject(new Error('must not be asked')) });
    expect((await handleAsk(d, body)).status).toBe('not_found');
    expect(d.calls).toEqual([]);
  });

  it('says so when the model has no committed content yet', async () => {
    expect((await handleAsk(deps({ mainCommit: () => Promise.resolve(null) }), body)).status).toBe('empty_model');
  });

  it('checks the owning organisation of the model, not an organisation the caller names', async () => {
    let asked: string | undefined;
    await handleAsk(deps({ isEnabled: (orgId) => { asked = orgId; return Promise.resolve(true); } }), { ...body, orgId: uid(1) });
    expect(asked).toBe(MODEL.orgId);
  });
});

describe('parseAskBody', () => {
  it('rejects malformed input with a plain message', () => {
    for (const bad of [null, {}, { modelId: 'x', question: 'q' }, { modelId: MODEL.id, question: '  ' }, { modelId: MODEL.id, question: 'q', history: 'no' }, { modelId: MODEL.id, question: 'q', history: [{ role: 'system', text: 'x' }] }]) {
      expect(typeof parseAskBody(bad)).toBe('string');
    }
  });
  it('accepts a question with history', () => {
    expect(parseAskBody({ modelId: MODEL.id, question: 'q', history: [{ role: 'user', text: 'a' }] })).toEqual({ modelId: MODEL.id, question: 'q', history: [{ role: 'user', text: 'a' }] });
  });
});
