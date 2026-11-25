import { describe, expect, it } from 'vitest';
import type { AskEvent, AskModelClient, AskModelRequest } from './askLoop';
import { handleDesign, parseDesignBody } from './designHandler';
import type { DesignHandlerDeps, DesignTiming } from './designHandler';
import { designerBrief, designerSystemPrompt } from './designPrompt';
import { estateContext, estateSnapshot, element, uid } from './fixtures/estateSnapshot';
import type { RunCostSharing, ToolContext } from './types';

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

  it('reports stage and loop timings without changing the outcome', async () => {
    const timings: DesignTiming[] = [];
    const outcome = await handleDesign(deps({ onTiming: (t) => timings.push(t) }), body);
    expect(outcome.status).toBe('done');
    expect(timings.map((t) => t.phase)).toEqual(expect.arrayContaining(['load_model', 'role', 'settings', 'share_run_cost', 'main_commit', 'context', 'run_round']));
    for (const t of timings) expect(t.ms).toBeGreaterThanOrEqual(0);
  });

  it('streams lookup progress to the caller without changing the draft', async () => {
    const answer = JSON.stringify({ options: [{ title: 'Replace', summary: 'Buy.' }], gaps: [], stayNote: '' });
    let round = 0;
    const events: AskEvent[] = [];
    const d = deps({ createClient: () => ({ complete: () => {
      round += 1;
      return Promise.resolve(round === 1
        ? { text: '', stopReason: 'tool_use', toolCalls: [{ id: 't1', name: 'search_elements', input: { query: 'Complaints' } }], inputTokens: 1, outputTokens: 1 }
        : { text: answer, stopReason: 'end_turn', inputTokens: 1, outputTokens: 1 });
    } }) });
    const outcome = await handleDesign(d, body, (event) => events.push(event));
    expect(outcome.status).toBe('done');
    expect(events).toEqual([{ type: 'tool_call', name: 'search_elements' }, { type: 'tool_done', name: 'search_elements', ok: true }]);
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

  it('gives the Designer a larger per-round output budget', async () => {
    let seen: number | undefined;
    const d = deps({ createClient: () => ({ complete: (request) => {
      seen = request.maxTokens;
      return Promise.resolve({ text: '{}', stopReason: 'end_turn', inputTokens: 1, outputTokens: 1 });
    } }) });
    await handleDesign(d, body);
    expect(seen).toBe(4000);
  });

  it('says the run was cut short even when the answer could not be parsed', async () => {
    const d = deps({ createClient: () => ({ complete: () => Promise.resolve({ text: 'not json', stopReason: 'max_tokens', inputTokens: 1, outputTokens: 1 }) }) });
    const outcome = await handleDesign(d, body);
    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') return;
    expect(outcome.design.problems.join(' ')).toContain('did not return options');
    expect(outcome.design.problems.join(' ')).toContain('cut short');
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

  it('sends nothing when the brief or outcome names an amount of money and cost is not shared', async () => {
    const withMoney = { ...body, finding: 'Quotes are slow.\nOutcome we want: save £40,000 a year by March 2027' };
    const withheld = deps();
    const refused = await handleDesign(withheld, withMoney);
    expect(refused).toMatchObject({ status: 'invalid' });
    expect(withheld.calls).not.toContain('client');
    const shared = deps({ shareRunCost: () => Promise.resolve(true) });
    expect((await handleDesign(shared, withMoney)).status).toBe('done');
  });

  it('treats a model the caller cannot read as not found, before asking about roles or switches', async () => {
    const d = deps({ loadModel: () => Promise.resolve(null), callerRole: () => Promise.reject(new Error('must not be asked')) });
    expect((await handleDesign(d, body)).status).toBe('not_found');
  });

  it('says so when the model has no committed content yet', async () => {
    expect((await handleDesign(deps({ mainCommit: () => Promise.resolve(null) }), body)).status).toBe('empty_model');
  });

  it('keeps a catalogue reference only when the Designer actually read that product, and says when one was left out', async () => {
    const ctx: ToolContext = {
      ...estateContext({ snapshot: estateSnapshot({ elements: [element(70, 'capability', 'Complaints', { templateRef: uid(700) })] }) }),
      catalogueForCapability: () => Promise.resolve({
        sector: 'electricity_network', capabilityCode: '5.4', capabilityName: 'Complaints', catalogueVersion: 2,
        entries: [{ id: 'e1', code: 'crm-x', product: 'CRM X', vendor: 'Vendor Ltd', summary: 'A CRM.', howItSupports: 'Records complaints.', claims: [{ statement: 'Records complaints.', kind: 'functional', sourceUrl: 'https://vendor.example/crm', sourceDate: '2026-01-01', reviewedBy: 'Simmodlr', reviewedAt: '2026-01-02' }] }],
      }),
    };
    const answer = JSON.stringify({ options: [{ title: 'Replace', summary: 'Buy a CRM.', catalogueRefs: [{ sector: 'electricity_network', version: 2, entryCode: 'crm-x' }] }, { title: 'Build', summary: 'Build it.', catalogueRefs: [{ sector: 'electricity_network', version: 2, entryCode: 'not-returned' }] }], gaps: [], stayNote: '' });
    let round = 0;
    const d = deps({
      createContext: () => ctx,
      createClient: () => ({ complete: () => {
        round += 1;
        return Promise.resolve(round === 1
          ? { text: '', stopReason: 'tool_use', toolCalls: [{ id: 't1', name: 'find_catalogue_products', input: { capability_element_id: uid(70) } }], inputTokens: 1, outputTokens: 1 }
          : { text: answer, stopReason: 'end_turn', inputTokens: 1, outputTokens: 1 });
      } }),
    });
    const outcome = await handleDesign(d, body);
    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') return;
    expect(outcome.design.options[0]?.catalogueRefs).toEqual([{ sector: 'electricity_network', version: 2, entryCode: 'crm-x' }]);
    expect(outcome.design.options[0]?.catalogueProducts).toEqual([{
      ref: { sector: 'electricity_network', version: 2, entryCode: 'crm-x' },
      product: 'CRM X',
      vendor: 'Vendor Ltd',
      summary: 'A CRM.',
      capabilityName: 'Complaints',
      howItSupports: 'Records complaints.',
      claims: [{ statement: 'Records complaints.', kind: 'functional', sourceUrl: 'https://vendor.example/crm', sourceDate: '2026-01-01' }],
    }]);
    expect(outcome.design.options[1]?.catalogueRefs).toEqual([]);
    expect(outcome.design.options[1]?.catalogueProducts).toEqual([]);
    expect(outcome.design.problems.join(' ')).toContain('did not read');
  });

  it('does not offer web search from the Designer', async () => {
    const offered: boolean[] = [];
    const d = deps({ createClient: () => ({ complete: (request) => {
      offered.push(request.webSearch !== undefined);
      return Promise.resolve({ text: '{}', stopReason: 'end_turn', inputTokens: 1, outputTokens: 1 });
    } }) });
    await handleDesign(d, body);
    expect(offered).toEqual([false]);
  });

  it('keeps a web page only when the search returned it, and reports the billed searches', async () => {
    const kept = { url: 'https://kept.example/a', title: 'Kept' };
    const answer = JSON.stringify({ options: [{ title: 'Replace', summary: 'Buy.', webRefs: [kept, { url: 'https://dropped.example/b', title: 'Dropped' }] }, { title: 'Build', summary: 'Build it.' }], gaps: [], stayNote: '' });
    const d = deps({
      createClient: () => ({ complete: () => Promise.resolve({
        text: answer, stopReason: 'end_turn', inputTokens: 1, outputTokens: 1,
        webSearch: { requests: 1, results: [{ url: kept.url, title: kept.title, pageAge: null }], citations: [{ url: kept.url, title: kept.title, citedText: 'Says so.' }] },
      }) }),
    });
    const outcome = await handleDesign(d, body);
    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') return;
    expect(outcome.design.options[0]?.webRefs).toEqual([kept]);
    expect(outcome.design.problems.join(' ')).toContain('did not return');
    expect(outcome.result.webSearch.requests).toBe(1);
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
    expect(prompt).toMatch(/"Buy a product" and "Build ourselves", say in the summary whether the existing system would be retired/);
    expect(prompt).toMatch(/something to investigate and never as the conclusion/);
  });
  it('keeps the catalogue source detail out of the option text', () => {
    const prompt = designerSystemPrompt('Estate', '2026-11-19');
    expect(prompt).toContain('The catalogue evidence is only the vendor\'s own positioning,');
    expect(prompt).toContain('without its date or reviewer');
  });
  it('caps catalogue lookups and does not instruct a web search', () => {
    const prompt = designerSystemPrompt('Estate', '2026-11-19');
    expect(prompt).toContain('Call find_catalogue_products at most twice in a run');
    expect(prompt).not.toContain('you may search the web');
    expect(prompt).not.toContain('webRefs');
  });
  it('asks for independent lookups in one round, so a run does not wait through extra rounds', () => {
    expect(designerSystemPrompt('Estate', '2026-11-19')).toContain('ask for every independent lookup you need in the same round');
  });
  it('puts the element id and the finding in the brief', () => {
    expect(designerBrief({ elementId: ELEMENT, finding: 'Poor fit' })).toContain(ELEMENT);
  });
  it('says web search is not available in the Designer brief', () => {
    expect(designerBrief({ elementId: ELEMENT, finding: 'Poor fit' })).toContain('Web search is not available for this run');
  });
});
