import { describe, expect, it } from 'vitest';
import type { WebResearchCandidate } from '../contracts/webResearch';
import {
  candidatesFromSearch,
  handleResearch,
  parseResearchBody,
  RESEARCH_QUERY_MAX_CHARS,
} from './researchHandler';
import type { ResearchHandlerDeps } from './researchHandler';

const DECISION = '11111111-1111-4111-8111-111111111111';
const OPTION = '22222222-2222-4222-8222-222222222222';
const BRANCH = '44444444-4444-4444-8444-444444444444';
const ORG = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-22T09:00:00.000Z');
const QUERY = 'Oracle customer service utility billing';

const CANDIDATE: WebResearchCandidate = {
  url: 'https://www.oracle.com/utilities/customer-service/',
  title: 'Customer Service for Utilities | Oracle',
  publisher: 'oracle.com',
  excerpt: 'Oracle provides customer service for utilities.',
  retrievedAt: NOW.toISOString(),
};

function deps(over: Partial<ResearchHandlerDeps> = {}): ResearchHandlerDeps & { searches: [string, string][]; records: Parameters<ResearchHandlerDeps['record']>[0][] } {
  const searches: [string, string][] = [];
  const records: Parameters<ResearchHandlerDeps['record']>[0][] = [];
  return {
    searches,
    records,
    loadDecision: () => Promise.resolve({ orgId: ORG, status: 'proposed', optionOnDecision: true, branchId: null }),
    callerRole: () => Promise.resolve('contributor'),
    orgSettings: () => Promise.resolve({ webSearchEnabled: true, assistantEnabled: true, agentsEnabled: true, keySet: true }),
    search: (orgId, query) => {
      searches.push([orgId, query]);
      return Promise.resolve({ candidates: [CANDIDATE], requests: 1 });
    },
    record: (input) => {
      records.push(input);
      return Promise.resolve();
    },
    now: () => NOW,
    ...over,
  };
}

const body = { decisionId: DECISION, optionId: OPTION, query: QUERY };

describe('parseResearchBody', () => {
  it('keeps the query text and trims only the edges', () => {
    expect(parseResearchBody({ ...body, query: `  ${QUERY}  ` })).toEqual({ decisionId: DECISION, optionId: OPTION, query: QUERY });
  });

  it('refuses a missing body, bad ids and an empty or overlong query', () => {
    expect(parseResearchBody(null)).toContain('body');
    expect(parseResearchBody({ ...body, decisionId: 'nope' })).toContain('decisionId');
    expect(parseResearchBody({ ...body, optionId: 'nope' })).toContain('optionId');
    expect(parseResearchBody({ ...body, query: '  ' })).toContain('at least');
    expect(parseResearchBody({ ...body, query: 'x'.repeat(RESEARCH_QUERY_MAX_CHARS + 1) })).toContain('at most');
  });

  it('refuses control characters, so the query stays one line of approved text', () => {
    expect(parseResearchBody({ ...body, query: 'one\ntwo' })).toContain('single line');
    expect(parseResearchBody({ ...body, query: 'one\ttwo' })).toContain('single line');
  });
});

describe('handleResearch', () => {
  it('searches the exact query and records the egress before returning candidates', async () => {
    const d = deps();
    const outcome = await handleResearch(d, body);
    expect(outcome).toMatchObject({ status: 'done', query: QUERY, candidates: [CANDIDATE], searchedAt: NOW.toISOString(), requests: 1 });
    expect(d.searches).toEqual([[ORG, QUERY]]);
    expect(d.records).toEqual([
      { orgId: ORG, decisionId: DECISION, optionId: OPTION, branchId: null, query: QUERY, status: 'ok', resultCount: 1, urls: [CANDIDATE.url] },
    ]);
  });

  it('does not read the decision or call search when the body is invalid', async () => {
    const d = deps({ loadDecision: () => { throw new Error('should not read'); } });
    expect((await handleResearch(d, { ...body, query: '' })).status).toBe('invalid');
    expect(d.searches).toEqual([]);
  });

  it('refuses a decision the caller cannot read, or a viewer', async () => {
    expect((await handleResearch(deps({ loadDecision: () => Promise.resolve(null) }), body)).status).toBe('not_found');
    expect((await handleResearch(deps({ callerRole: () => Promise.resolve('viewer') }), body)).status).toBe('forbidden');
    expect((await handleResearch(deps({ callerRole: () => Promise.resolve(null) }), body)).status).toBe('forbidden');
  });

  it('refuses each organisation setting separately, before any search', async () => {
    for (const settings of [
      { webSearchEnabled: false, assistantEnabled: true, agentsEnabled: true, keySet: true },
      { webSearchEnabled: true, assistantEnabled: false, agentsEnabled: true, keySet: true },
      { webSearchEnabled: true, assistantEnabled: true, agentsEnabled: false, keySet: true },
      { webSearchEnabled: true, assistantEnabled: true, agentsEnabled: true, keySet: false },
    ]) {
      const d = deps({ orgSettings: () => Promise.resolve(settings) });
      expect((await handleResearch(d, body)).status).toBe('not_enabled');
      expect(d.searches).toEqual([]);
      expect(d.records).toEqual([]);
    }
  });

  it('refuses an accepted decision or an option that is not linked', async () => {
    expect((await handleResearch(deps({ loadDecision: () => Promise.resolve({ orgId: ORG, status: 'accepted', optionOnDecision: true, branchId: null }) }), body)).status).toBe('forbidden');
    expect((await handleResearch(deps({ loadDecision: () => Promise.resolve({ orgId: ORG, status: 'proposed', optionOnDecision: false, branchId: null }) }), body)).status).toBe('forbidden');
  });

  it('records the option, and its change only when it already has one', async () => {
    const records: unknown[] = [];
    await handleResearch(deps({
      loadDecision: () => Promise.resolve({ orgId: ORG, status: 'proposed', optionOnDecision: true, branchId: BRANCH }),
      record: (input) => { records.push(input); return Promise.resolve(); },
    }), body);
    expect(records).toEqual([expect.objectContaining({ optionId: OPTION, branchId: BRANCH })]);
  });

  it('records a failed search and returns the provider message', async () => {
    const d = deps({ search: () => Promise.reject(new Error('The organisation key was rejected.')) });
    const outcome = await handleResearch(d, body);
    expect(outcome).toMatchObject({ status: 'error', message: 'The organisation key was rejected.' });
    expect(d.records[0]).toMatchObject({ status: 'error', resultCount: 0, urls: [], error: 'The organisation key was rejected.' });
  });

  it('does not return candidates when the egress record cannot be written', async () => {
    const d = deps({ record: () => Promise.reject(new Error('denied')) });
    const outcome = await handleResearch(d, body);
    expect(outcome.status).toBe('error');
    expect(outcome).not.toHaveProperty('candidates');
  });
});

describe('candidatesFromSearch', () => {
  it('uses the provider title and the cited sentence, never model prose', () => {
    const out = candidatesFromSearch({
      results: [{ url: CANDIDATE.url, title: CANDIDATE.title, pageAge: '2 days' }],
      citations: [{ url: CANDIDATE.url, title: 'A different title', citedText: CANDIDATE.excerpt }],
    }, NOW.toISOString());
    expect(out).toEqual([CANDIDATE]);
  });

  it('keeps a citation-only page, falls back to the host for a title, and rejects non-public URLs', () => {
    const out = candidatesFromSearch({
      results: [
        { url: 'https://example.com/page', title: '', pageAge: null },
        { url: 'http://insecure.example.com/', title: 'Insecure', pageAge: null },
        { url: 'https://127.0.0.1/private', title: 'Private', pageAge: null },
      ],
      citations: [{ url: 'https://cited.example.org/report', title: null, citedText: 'A cited sentence.' }],
    }, NOW.toISOString());
    expect(out.map((c) => c.url)).toEqual(['https://example.com/page', 'https://cited.example.org/report']);
    expect(out[0]).toMatchObject({ title: 'example.com', publisher: 'example.com', excerpt: null });
    expect(out[1]).toMatchObject({ title: 'cited.example.org', excerpt: 'A cited sentence.' });
  });

  it('deduplicates by URL and caps the list at five', () => {
    const results = Array.from({ length: 7 }, (_, i) => ({ url: `https://example.com/${String(i)}`, title: `Page ${String(i)}`, pageAge: null }));
    const out = candidatesFromSearch({ results: [...results, ...results.slice(0, 1)], citations: [] }, NOW.toISOString());
    expect(out).toHaveLength(5);
    expect(new Set(out.map((c) => c.url)).size).toBe(5);
  });
});
