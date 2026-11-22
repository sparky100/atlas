/**
 * D4 guarded Researcher: everything the `research-agent` edge function decides,
 * with its collaborators injected so it is tested without Deno (the same split
 * `designHandler.ts` uses). Order is the safety property:
 *
 *   1. the decision is readable by the caller;
 *   2. the caller is an owner, architect or contributor;
 *   3. the organisation has switched web research on, has agents on and has its
 *      own AI key (the platform trial never pays for a public search);
 *   4. the decision is still proposed and the option is linked to it;
 *   5. only then is the person's exact query sent, through the proxy, to the
 *      provider. Nothing from the estate model is added.
 *
 * The run writes one append-only egress row and returns candidates. It never
 * writes the decision, saves a page, or reads estate tools. Saving is a
 * separate, person-driven step in the UI.
 */
import type { UUID } from '../contracts/delta';
import type { LlmProxyWebSearch } from '../contracts/llmProxy';
import type { WebResearchCandidate } from '../contracts/webResearch';

export interface ResearchDecision {
  orgId: UUID;
  status: string;
  /** True when the branch is a `branch`-typed link on this decision. */
  branchLinked: boolean;
}

export interface ResearchOrgSettings {
  webSearchEnabled: boolean;
  assistantEnabled: boolean;
  agentsEnabled: boolean;
  /** Web search is never run on the platform trial, only on the organisation's own key. */
  keySet: boolean;
}

export interface ResearchSearchResult {
  candidates: WebResearchCandidate[];
  /** Billed provider-side searches actually made, from the proxy. */
  requests: number;
}

export interface ResearchRecordInput {
  orgId: UUID;
  decisionId: UUID;
  branchId: UUID;
  query: string;
  status: 'ok' | 'error';
  resultCount: number;
  urls: string[];
  error?: string;
}

export interface ResearchHandlerDeps {
  /** Read with the caller's own session: a decision they cannot read is `null`. */
  loadDecision: (decisionId: UUID, branchId: UUID) => Promise<ResearchDecision | null>;
  /** The caller's role in the organisation, or `null`. */
  callerRole: (orgId: UUID) => Promise<string | null>;
  /** The organisation's switches and key flag, read with the caller's session. */
  orgSettings: (orgId: UUID) => Promise<ResearchOrgSettings>;
  /** Search exactly the approved query. No estate context is available here by design. */
  search: (orgId: UUID, query: string) => Promise<ResearchSearchResult>;
  /** Append the egress row. Throwing is a failure: a search without a record must not be used. */
  record: (input: ResearchRecordInput) => Promise<void>;
  now: () => Date;
}

export type ResearchOutcome =
  | { status: 'invalid'; message: string }
  | { status: 'not_found'; message: string }
  | { status: 'forbidden'; message: string }
  | { status: 'not_enabled'; message: string }
  | { status: 'error'; message: string }
  | { status: 'done'; query: string; candidates: WebResearchCandidate[]; searchedAt: string; requests: number };

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keep a query short enough to read and approve, and to stay within the egress check. */
export const RESEARCH_QUERY_MIN_CHARS = 3;
export const RESEARCH_QUERY_MAX_CHARS = 300;
/** At most five candidates, so the person can actually check each one. */
export const RESEARCH_CANDIDATES_MAX = 5;
const TITLE_MAX = 200;
const EXCERPT_MAX = 1000;
const PUBLISHER_MAX = 200;

export interface ParsedResearch {
  decisionId: UUID;
  branchId: UUID;
  query: string;
}

/**
 * A query is a single line of the person's own words. Control characters are
 * refused rather than normalised, because the exact text the person approved
 * is the text that is sent.
 */
export function parseResearchBody(body: unknown): ParsedResearch | string {
  if (typeof body !== 'object' || body === null) return 'A request body is required.';
  const r = body as Record<string, unknown>;
  if (typeof r.decisionId !== 'string' || !UUID_SHAPE.test(r.decisionId)) return 'decisionId must be a decision id.';
  if (typeof r.branchId !== 'string' || !UUID_SHAPE.test(r.branchId)) return 'branchId must be a branch id.';
  if (typeof r.query !== 'string') return 'query is required.';
  const query = r.query.trim();
  if (query.length < RESEARCH_QUERY_MIN_CHARS) return `query must be at least ${String(RESEARCH_QUERY_MIN_CHARS)} characters.`;
  if (query.length > RESEARCH_QUERY_MAX_CHARS) return `query must be at most ${String(RESEARCH_QUERY_MAX_CHARS)} characters.`;
  for (const character of query) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return 'query must be a single line of text.';
  }
  return { decisionId: r.decisionId, branchId: r.branchId, query };
}

function isPublicHttpsUrl(value: string): boolean {
  if (value.length < 10 || value.length > 2000 || !value.startsWith('https://')) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.includes('.') && !url.hostname.endsWith('.localhost') && !/^[0-9.]+$/.test(url.hostname);
  } catch {
    return false;
  }
}

function hostOf(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').slice(0, PUBLISHER_MAX);
  } catch {
    return '';
  }
}

function clean(value: string | null | undefined, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Maps the provider's own pages and citations to candidates. The title always
 * comes from the provider (search result, then citation), never from the
 * model's prose; the excerpt is only the sentence the provider cited. A page
 * with no excerpt can still be opened and checked by the person.
 */
export function candidatesFromSearch(search: Pick<LlmProxyWebSearch, 'results' | 'citations'>, retrievedAt: string): WebResearchCandidate[] {
  const citations = new Map<string, LlmProxyWebSearchCitation>();
  for (const citation of search.citations) {
    if (isPublicHttpsUrl(citation.url) && !citations.has(citation.url)) citations.set(citation.url, citation);
  }
  const out: WebResearchCandidate[] = [];
  const seen = new Set<string>();
  const add = (url: string, providerTitle: string | null, excerpt: string | null): void => {
    if (out.length >= RESEARCH_CANDIDATES_MAX || seen.has(url) || !isPublicHttpsUrl(url)) return;
    seen.add(url);
    const title = clean(providerTitle, TITLE_MAX) || hostOf(url);
    const publisher = hostOf(url);
    out.push({
      url,
      title: title === '' ? url : title,
      publisher,
      excerpt: clean(excerpt, EXCERPT_MAX) || null,
      retrievedAt,
    });
  };

  for (const result of search.results) {
    const citation = citations.get(result.url);
    add(result.url, result.title, citation?.citedText ?? null);
  }
  // A page the model cited is still a provider-returned page even when the
  // provider's result list omitted it. Keep it, with the provider's citation.
  for (const citation of citations.values()) {
    add(citation.url, citation.title, citation.citedText);
  }
  return out;
}

type LlmProxyWebSearchCitation = LlmProxyWebSearch['citations'][number];

export async function handleResearch(deps: ResearchHandlerDeps, body: unknown): Promise<ResearchOutcome> {
  const parsed = parseResearchBody(body);
  if (typeof parsed === 'string') return { status: 'invalid', message: parsed };

  const decision = await deps.loadDecision(parsed.decisionId, parsed.branchId);
  if (!decision) return { status: 'not_found', message: 'That decision could not be found.' };

  const role = await deps.callerRole(decision.orgId);
  if (role !== 'owner' && role !== 'architect' && role !== 'contributor') {
    return { status: 'forbidden', message: 'Only an owner, architect or contributor can research a decision.' };
  }

  const settings = await deps.orgSettings(decision.orgId);
  if (!settings.webSearchEnabled) {
    return { status: 'not_enabled', message: 'Web research is switched off for this organisation. An owner can switch it on in organisation settings.' };
  }
  if (!settings.assistantEnabled || !settings.agentsEnabled) {
    return { status: 'not_enabled', message: 'Agents are not switched on for this organisation. An owner can switch them on in organisation settings.' };
  }
  if (!settings.keySet) {
    return { status: 'not_enabled', message: "Web research needs the organisation's own AI key. An owner can add it in organisation settings." };
  }

  if (decision.status !== 'proposed') {
    return { status: 'forbidden', message: 'Web research is only available while the decision is proposed.' };
  }
  if (!decision.branchLinked) {
    return { status: 'forbidden', message: 'That option is not linked to this decision.' };
  }

  try {
    const result = await deps.search(decision.orgId, parsed.query);
    try {
      await deps.record({
        orgId: decision.orgId,
        decisionId: parsed.decisionId,
        branchId: parsed.branchId,
        query: parsed.query,
        status: 'ok',
        resultCount: result.candidates.length,
        urls: result.candidates.map((candidate) => candidate.url),
      });
    } catch {
      return { status: 'error', message: 'The search ran but its record could not be saved, so it was not used. Try again.' };
    }
    return {
      status: 'done',
      query: parsed.query,
      candidates: result.candidates,
      searchedAt: deps.now().toISOString(),
      requests: result.requests,
    };
  } catch (e) {
    const message = e instanceof Error && e.message !== '' ? e.message : 'The web search failed.';
    // Best effort on an error: a failed search still belongs in the egress record when it can be written.
    try {
      await deps.record({
        orgId: decision.orgId,
        decisionId: parsed.decisionId,
        branchId: parsed.branchId,
        query: parsed.query,
        status: 'error',
        resultCount: 0,
        urls: [],
        error: message.slice(0, 500),
      });
    } catch {
      // The original search error is the one the person needs to see.
    }
    return { status: 'error', message };
  }
}
