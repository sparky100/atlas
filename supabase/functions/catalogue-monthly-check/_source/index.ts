/**
 * Catalogue step 5b-2: the monthly, unattended check. The database's monthly
 * job (pg_cron through pg_net) calls this function on days 1 to 3 of each month,
 * every 30 minutes. Each call checks one small batch of claims that have no
 * saved check newer than 25 days: first their source links (no AI), then the
 * claims against their pages (the platform's AI, same rules and quote check as
 * the on-demand claim check), and saves the results and one run record. It stops
 * at once when the switch is off or nothing is left.
 *
 * Who may call it: only the job. There is no Supabase JWT; the caller must send
 * the secret held in Vault (`atlas.catalogue_schedule_secret`, service role
 * only), compared without stopping at the first difference.
 *
 * What it writes: `catalogue_source_checks`, `catalogue_claim_checks` and
 * `catalogue_check_runs`, with the service role, and nothing else. It never
 * edits a claim or unpublishes a product. Results are saved as "Monthly check
 * (switched on by <name>)", the person who switched the monthly check on.
 *
 * **Hand-authored source, not what is deployed**: `pnpm
 * functions:bundle:catalogue-monthly-check` bundles this plus its `src/` imports
 * into the generated, git-ignored `supabase/functions/catalogue-monthly-check/index.ts`.
 */
import { checkClaim, CLAIM_CHECK_DAILY_TOKEN_LIMIT, CLAIM_CHECK_DEFAULT_MODEL, type ClaimCheckDeps, type ClaimCheckResult, type PageResponse } from '../../../../src/tools/catalogueClaimCheck.ts';
import { checkLink, type LinkCheckResult } from '../../../../src/tools/catalogueLinkCheck.ts';
import {
  addBatch, claimsWithGoneLink, linksToCheck, MONTHLY_RUN_OPEN_HOURS, MONTHLY_SECRET_HEADER, monthlyActorName, monthlyClaimKey, outstandingClaims,
  secretsMatch, skippedClaimResult, type MonthlyClaim, type RunCounters,
} from '../../../../src/tools/catalogueMonthlyCheck.ts';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const PAGE = 1000;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

async function resolveHost(host: string): Promise<string[]> {
  const [v4, v6] = await Promise.all([
    Deno.resolveDns(host, 'A').catch(() => [] as string[]),
    Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]),
  ]);
  return [...v4, ...v6];
}

const USER_AGENT = 'AtlasCatalogueMonthlyCheck/1.0 (checks that cited pages still exist and still say what a claim says)';

async function getPage(url: string, signal: AbortSignal): Promise<PageResponse> {
  // No cookies, no credentials, no referrer, no automatic redirects: each hop is checked by the caller.
  const response = await fetch(url, {
    method: 'GET', redirect: 'manual', signal, credentials: 'omit', referrerPolicy: 'no-referrer',
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain;q=0.9' },
  });
  return {
    status: response.status,
    location: response.headers.get('location'),
    contentType: response.headers.get('content-type') ?? '',
    readText: async (maxBytes) => {
      if (!response.body) return '';
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < maxBytes) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.byteLength;
      }
      void reader.cancel().catch(() => undefined);
      const merged = new Uint8Array(Math.min(total, maxBytes));
      let offset = 0;
      for (const chunk of chunks) {
        const room = merged.length - offset;
        if (room <= 0) break;
        merged.set(chunk.subarray(0, room), offset);
        offset += Math.min(chunk.byteLength, room);
      }
      return new TextDecoder('utf-8', { fatal: false }).decode(merged);
    },
    discard: () => { void response.body?.cancel().catch(() => undefined); },
  };
}

interface Db {
  get: <T>(path: string) => Promise<T[]>;
  rpc: (name: string) => Promise<unknown>;
  send: (method: 'POST' | 'PATCH', path: string, body: unknown, upsert?: boolean) => Promise<void>;
}

function database(supabaseUrl: string, serviceRoleKey: string): Db {
  const base = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
  return {
    get: async <T,>(path: string): Promise<T[]> => {
      const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: base });
      if (!res.ok) throw new Error(`read ${path.split('?')[0] ?? path} failed`);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error(`read ${path.split('?')[0] ?? path} gave no list`);
      return rows as T[];
    },
    rpc: async (name: string): Promise<unknown> => {
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, { method: 'POST', headers: { ...base, 'Content-Type': 'application/json', 'Content-Profile': 'atlas' }, body: '{}' });
      if (!res.ok) return null;
      return res.json() as Promise<unknown>;
    },
    send: async (method, path, body, upsert = false) => {
      const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
        method,
        headers: { ...base, 'Content-Type': 'application/json', Prefer: upsert ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`save ${path.split('?')[0] ?? path} failed`);
    },
  };
}

/** Every row of a table, read in pages. */
async function allRows<T>(db: Db, path: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await db.get<T>(`${path}&limit=${String(PAGE)}&offset=${String(offset)}`);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

interface RunRow { id: string; links_checked: number; claims_checked: number; flagged: number; input_tokens: number; output_tokens: number; note: string | null }

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ status: 'error', message: 'Method not allowed.' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ status: 'error', message: 'This function is not configured.' }, 500);
  const db = database(supabaseUrl, serviceRoleKey);

  try {
    const secret = await db.rpc('catalogue_schedule_secret');
    if (!secretsMatch(req.headers.get(MONTHLY_SECRET_HEADER), typeof secret === 'string' ? secret : null)) {
      return jsonResponse({ status: 'error', message: 'Not allowed.' }, 401);
    }

    const [schedule] = await db.get<{ enabled: boolean; switched_by: string | null; switched_by_name: string | null }>('catalogue_check_schedule?select=enabled,switched_by,switched_by_name');
    if (!schedule?.enabled || schedule.switched_by === null) return jsonResponse({ status: 'skipped', reason: 'off' }, 200);
    const actor = { checked_by: schedule.switched_by, checked_by_name: monthlyActorName(schedule.switched_by_name) };

    const now = new Date();
    const [claimRows, products, claimChecks, linkChecks] = await Promise.all([
      allRows<{ product_id: string; statement: string; source_url: string }>(db, 'catalogue_product_claims?select=product_id,statement,source_url&order=id'),
      allRows<{ id: string; product: string; vendor: string }>(db, 'catalogue_products?select=id,product,vendor&order=id'),
      allRows<{ product_id: string; source_url: string; statement: string; checked_at: string }>(db, 'catalogue_claim_checks?select=product_id,source_url,statement,checked_at&order=product_id'),
      allRows<{ url: string; checked_at: string }>(db, 'catalogue_source_checks?select=url,checked_at&order=url'),
    ]);
    const productById = new Map(products.map((product) => [product.id, product]));
    const claims: MonthlyClaim[] = claimRows.flatMap((row) => {
      const product = productById.get(row.product_id);
      return product === undefined ? [] : [{ productId: row.product_id, product: product.product, vendor: product.vendor, sourceUrl: row.source_url.trim(), statement: row.statement }];
    });
    const { batch, remaining } = outstandingClaims(claims, claimChecks.map((c) => ({ productId: c.product_id, sourceUrl: c.source_url, statement: c.statement, checkedAt: c.checked_at })), now);

    // A run left open for too long did not finish; mark it, so one pass is one open run.
    const openSince = new Date(now.getTime() - MONTHLY_RUN_OPEN_HOURS * 3_600_000).toISOString();
    const openRuns = await db.get<RunRow & { started_at: string }>('catalogue_check_runs?select=id,started_at,links_checked,claims_checked,flagged,input_tokens,output_tokens,note&kind=eq.monthly&status=eq.running&order=started_at.desc');
    for (const stale of openRuns.filter((run) => run.started_at < openSince)) {
      await db.send('PATCH', `catalogue_check_runs?id=eq.${stale.id}`, { status: 'stopped', note: 'Did not finish; the next call carried on.' });
    }
    const open = openRuns.find((run) => run.started_at >= openSince);

    if (batch.length === 0) {
      if (open) await db.send('PATCH', `catalogue_check_runs?id=eq.${open.id}`, { status: 'finished' });
      return jsonResponse({ status: 'done', remaining: 0 }, 200);
    }

    // The platform's AI key and today's limit decide whether claims can be read at all; asked before a run is recorded, so a blocked day leaves one record, not one per call.
    const apiKey = await db.rpc('platform_llm_api_key');
    const key = typeof apiKey === 'string' ? apiKey : '';
    const midnight = new Date(now);
    midnight.setUTCHours(0, 0, 0, 0);
    const todays = await db.get<{ input_tokens: number; output_tokens: number }>(`catalogue_claim_checks?select=input_tokens,output_tokens&checked_at=gte.${encodeURIComponent(midnight.toISOString())}&limit=20000`);
    const used = todays.reduce((sum, row) => sum + row.input_tokens + row.output_tokens, 0);
    const blocked = key === '' ? 'failed' : used >= CLAIM_CHECK_DAILY_TOKEN_LIMIT ? 'limit_reached' : null;
    if (blocked !== null) {
      const dayAgo = new Date(now.getTime() - 24 * 3_600_000).toISOString();
      const already = await db.get<{ id: string }>(`catalogue_check_runs?select=id&kind=eq.monthly&status=in.(failed,limit_reached)&started_at=gte.${encodeURIComponent(dayAgo)}&limit=1`);
      if (already.length > 0) return jsonResponse({ status: 'blocked', reason: blocked }, 200);
    }

    let runId = open?.id;
    let counters: RunCounters = open
      ? { linksChecked: open.links_checked, claimsChecked: open.claims_checked, flagged: open.flagged, inputTokens: open.input_tokens, outputTokens: open.output_tokens }
      : { linksChecked: 0, claimsChecked: 0, flagged: 0, inputTokens: 0, outputTokens: 0 };
    if (runId === undefined) {
      await db.send('POST', 'catalogue_check_runs', { kind: 'monthly', scope: 'both', status: 'running', started_by: schedule.switched_by, started_by_name: actor.checked_by_name });
      const [created] = await db.get<RunRow>(`catalogue_check_runs?select=id,links_checked,claims_checked,flagged,input_tokens,output_tokens,note&kind=eq.monthly&status=eq.running&order=started_at.desc&limit=1`);
      runId = created?.id;
    }
    const finishRun = async (status: 'running' | 'finished' | 'limit_reached' | 'failed', note: string | null): Promise<void> => {
      if (runId === undefined) return;
      await db.send('PATCH', `catalogue_check_runs?id=eq.${runId}`, {
        status, note, links_checked: counters.linksChecked, claims_checked: counters.claimsChecked, flagged: counters.flagged,
        input_tokens: counters.inputTokens, output_tokens: counters.outputTokens,
      });
    };

    try {
      // 1. Links, no AI.
      const urls = linksToCheck(batch, linkChecks.map((l) => ({ url: l.url, checkedAt: l.checked_at })), now);
      const linkDeps = {
        resolve: resolveHost,
        request: async (url: string, method: 'HEAD' | 'GET', signal: AbortSignal) => {
          const response = await fetch(url, { method, redirect: 'manual', signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'user-agent': USER_AGENT, accept: '*/*' } });
          return { status: response.status, location: response.headers.get('location'), discard: () => { void response.body?.cancel().catch(() => undefined); } };
        },
      };
      const links: LinkCheckResult[] = await mapLimit(urls, 5, (url) => checkLink(url, linkDeps));
      if (links.length > 0) {
        await db.send('POST', 'catalogue_source_checks?on_conflict=url', links.map((link) => ({ url: link.url, result: link.result, http_status: link.httpStatus, final_url: link.finalUrl, note: link.note, ...actor })), true);
      }
      const gone = claimsWithGoneLink(batch, links);

      // 2. Claims, with the platform's AI, unless it is not set up or today's limit is used.
      if (blocked !== null) {
        counters = addBatch(counters, links, []);
        await finishRun(blocked, blocked === 'failed' ? 'No platform AI key is set; links were still checked.' : 'The daily AI limit was reached; the next day carries on.');
        return jsonResponse({ status: blocked === 'failed' ? 'no_key' : 'daily_limit' }, 200);
      }
      const model = Deno.env.get('CATALOGUE_CHECK_MODEL') || CLAIM_CHECK_DEFAULT_MODEL;
      const deps: ClaimCheckDeps = {
        model, resolve: resolveHost, getPage,
        askModel: async (system, user) => {
          const res = await fetch(ANTHROPIC_API_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
            body: JSON.stringify({ model, max_tokens: 300, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
          });
          if (!res.ok) throw new Error(`provider ${String(res.status)}`);
          const data = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
          const text = (data.content ?? []).filter((block) => block.type === 'text').map((block) => block.text ?? '').join('');
          return { text, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
        },
      };
      const results: ClaimCheckResult[] = await mapLimit(batch, 5, (claim) => (gone.has(monthlyClaimKey(claim)) ? Promise.resolve(skippedClaimResult(claim)) : checkClaim(claim, deps)));
      await db.send('POST', 'catalogue_claim_checks?on_conflict=product_id,source_url,statement', results.map((result) => ({
        product_id: result.productId, source_url: result.sourceUrl, statement: result.statement, verdict: result.verdict, quote: result.quote, note: result.note,
        model: result.model, input_tokens: result.inputTokens, output_tokens: result.outputTokens, ...actor,
      })), true);
      counters = addBatch(counters, links, results);
      await finishRun(remaining === 0 ? 'finished' : 'running', null);
      return jsonResponse({ status: 'ok', checked: results.length, remaining }, 200);
    } catch {
      await finishRun('failed', 'A call failed part-way; the next call tries again.').catch(() => undefined);
      return jsonResponse({ status: 'error', message: 'The monthly check failed.' }, 500);
    }
  } catch {
    return jsonResponse({ status: 'error', message: 'The monthly check failed.' }, 500);
  }
});
