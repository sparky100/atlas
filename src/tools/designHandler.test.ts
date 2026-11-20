import { describe, expect, it } from 'vitest';
import type { AskModelClient, AskModelRequest } from './askLoop';
import { handleDesign, parseDesignBody } from './designHandler';
import type { DesignHandlerDeps } from './designHandler';
import { designerBrief, designerSystemPrompt } from './designPrompt';
import { estateContext, uid } from './fixtures/estateSnapshot';
import type { RunCostSharing } from './types';

const MODEL = { id: uid(5000), orgId: uid(6000), name: 'Estate' };
const ELEMENT = uid(70);
const body = { modelId: MODEL.id, elementId: ELEMENT, finding: 'Ledger Service has a poor fit rating.' };
const ON = { assistantEnabled: true, agentsEnabled: true, keySet: true };

function deps(over: Partial<DesignHandlerDeps> = {}): DesignHandlerDeps & { calls: string[]; requests: AskModelRequest[]; costModes: RunCostSharing[] } {
  const calls: string[] = [];
  const requests: AskModelRequest[] = [];
  const costModes: RunCostSharing[] = [];
  const client: AskModelClient = {
    complete: (request) => {
      requests.push(request);
      return Promise.resolve({ text: 'Draft for a person to edit.', stopReason: 'end_turn', inputTokens: 10, outputTokens: 5 });
    },
  };
  return {
    calls,
    requests,
    costModes,
    loadModel: () => Promise.resolve(MODEL),
    agentSettings: () => Promise.resolve(ON),
    callerRole: () => Promise.resolve('architect'),
    shareRunCost: () => Promise.resolve(false),
    mainCommit: () => Promise.resolve(uid(7000)),
    createContext: (_model, _commit, runCost) => {
      calls.push('context');
      costModes.push(runCost);
      return estateContext();
    },
    trialRunsLeft: () => Promise.resolve(0),
    newRunId: () => 'run-1',
    createClient: () => {
      calls.push('client');
      return client;
    },
    ...over,
  };
}

describe('handleDesign', () => {
  it('runs the Designer for an architect when assistant, agents and a key are all on', async () => {
    const d = deps();
    const outcome = await handleDesign(d, body);
    expect(outcome.status).toBe('done');
    expect(d.requests[0]?.system).toContain('You are the Designer');
    expect(d.requests[0]?.system).not.toContain('You are Ask Atlas');
    expect(JSON.stringify(d.requests[0]?.messages)).toContain(ELEMENT);
  });

  it('refuses before anything is read or sent unless the switches are on and there is a key or trial left, one at a time', async () => {
    for (const settings of [{ ...ON, assistantEnabled: false }, { ...ON, agentsEnabled: false }, { ...ON, keySet: false }]) {
      const d = deps({ agentSettings: () => Promise.resolve(settings) });
      expect((await handleDesign(d, body)).status).toBe('not_enabled');
      expect(d.calls).toEqual([]);
    }
  });

  it('with no key of its own, runs on the free trial while runs are left, counted by a fresh run id', async () => {
    let runId: string | undefined;
    const d = deps({ agentSettings: () => Promise.resolve({ ...ON, keySet: false }), trialRunsLeft: () => Promise.resolve(2), createClient: (_org, id) => { runId = id; return { complete: () => Promise.resolve({ text: 'x', inputTokens: 0, outputTokens: 0 }) }; } });
    expect((await handleDesign(d, body)).status).toBe('done');
    expect(runId).toBe('run-1');
  });

  it('with no key and the trial used up, says so plainly and sends nothing', async () => {
    const d = deps({ agentSettings: () => Promise.resolve({ ...ON, keySet: false }), trialRunsLeft: () => Promise.resolve(0) });
    const outcome = await handleDesign(d, body);
    expect(outcome.status === 'not_enabled' && outcome.message).toContain('free trial');
    expect(d.calls).toEqual([]);
  });

  it('never asks about the trial when the organisation has its own key', async () => {
    const d = deps({ trialRunsLeft: () => Promise.reject(new Error('must not be asked')) });
    expect((await handleDesign(d, body)).status).toBe('done');
  });

  it('never falls back to another key: the client is only built after the gates, and only for the model\'s own organisation', async () => {
    let asked: string | undefined;
    const d = deps({ createClient: (orgId) => { asked = orgId; return { complete: () => Promise.resolve({ text: 'x', inputTokens: 0, outputTokens: 0 }) }; } });
    await handleDesign(d, { ...body, orgId: uid(1) });
    expect(asked).toBe(MODEL.orgId);
  });

  it('an owner, architect or contributor can run it; a viewer or an outsider cannot', async () => {
    for (const role of ['viewer', null]) {
      const d = deps({ callerRole: () => Promise.resolve(role) });
      expect((await handleDesign(d, body)).status).toBe('forbidden');
      expect(d.calls).toEqual([]);
    }
    for (const role of ['owner', 'architect', 'contributor']) {
      expect((await handleDesign(deps({ callerRole: () => Promise.resolve(role) }), body)).status).toBe('done');
    }
  });

  it('returns the options as a checked structure, and marks an unusable answer incomplete', async () => {
    const ok = JSON.stringify({ options: [{ title: 'Configure', summary: 'Use it as is.' }, { title: 'Replace', summary: 'Buy one.' }], gaps: [], stayNote: 'Slow.' });
    const good = await handleDesign(deps({ createClient: () => ({ complete: () => Promise.resolve({ text: ok, stopReason: 'end_turn', inputTokens: 1, outputTokens: 1 }) }) }), body);
    expect(good.status === 'done' && good.design.problems).toEqual([]);
    expect(good.status === 'done' && good.design.options).toHaveLength(2);
    const prose = await handleDesign(deps(), body);
    expect(prose.status === 'done' && prose.design.problems.length).toBeGreaterThan(0);
    expect(prose.status === 'done' && prose.design.options).toEqual([]);
  });

  it('withholds run cost from the agent unless the owner shares it', async () => {
    const withheld = deps();
    await handleDesign(withheld, body);
    expect(withheld.costModes).toEqual(['exclude']);
    const shared = deps({ shareRunCost: () => Promise.resolve(true) });
    await handleDesign(shared, body);
    expect(shared.costModes).toEqual(['share']);
    // And what the model is told matches: no cost bands when withheld.
    expect(withheld.requests[0]?.system).not.toMatch(/annualRunCost|£/);
  });

  it('treats a model the caller cannot read as not found, before asking about roles or switches', async () => {
    const d = deps({ loadModel: () => Promise.resolve(null), callerRole: () => Promise.reject(new Error('must not be asked')) });
    expect((await handleDesign(d, body)).status).toBe('not_found');
  });

  it('says so when the model has no committed content yet', async () => {
    expect((await handleDesign(deps({ mainCommit: () => Promise.resolve(null) }), body)).status).toBe('empty_model');
  });
});

describe('parseDesignBody', () => {
  it('rejects malformed input with a plain message', () => {
    for (const bad of [null, {}, { ...body, modelId: 'x' }, { ...body, elementId: 'x' }, { ...body, finding: '  ' }, { ...body, finding: 'x'.repeat(1001) }]) {
      expect(typeof parseDesignBody(bad)).toBe('string');
    }
  });
  it('accepts a finding for one element', () => {
    expect(parseDesignBody(body)).toEqual(body);
  });
});

describe('the Designer prompt', () => {
  it('leaves Stay as we are to Atlas, asks for one JSON object, and treats retirement as an option, never a conclusion', () => {
    const prompt = designerSystemPrompt('Estate', '2026-11-19');
    expect(prompt).toContain('Atlas always adds it');
    expect(prompt).toContain('one JSON object');
    expect(prompt).toMatch(/never present retirement as the conclusion/i);
    expect(prompt).toContain('draft for a person to edit');
  });
  it('asks Replace and Build to say whether the existing system would be retired, as something to investigate', () => {
    const prompt = designerSystemPrompt('Estate', '2026-11-19');
    expect(prompt).toMatch(/"Replace with a product" and "Build ourselves", say in the summary whether the existing system would be retired/);
    expect(prompt).toMatch(/something to investigate and never as the conclusion/);
  });
  it('puts the element id and the finding in the brief', () => {
    expect(designerBrief({ elementId: ELEMENT, finding: 'Poor fit' })).toContain(ELEMENT);
  });
});
