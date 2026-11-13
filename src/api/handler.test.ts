import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ApiError, ApiList } from '../contracts/api';
import { API_KEY_PATTERN } from '../contracts/api';
import { estateContext, uid } from '../tools/fixtures/estateSnapshot';
import { hashApiKey, parseBearerKey } from './apiKey';
import { handleApiRequest, type ApiAuthorization, type ApiHandlerDeps, type ApiResponse } from './handler';
import { decodeCursor, encodeCursor, pageOf, parseLimit } from './pagination';

const TOKEN = `atl_${'a'.repeat(64)}`;
const ORG = uid(800);
const OTHER_ORG = uid(801);
const MODEL = uid(901);

function deps(over: Partial<ApiHandlerDeps> & { auth?: ApiAuthorization | null } = {}): ApiHandlerDeps {
  return {
    authorize: () => Promise.resolve(over.auth === undefined ? { keyId: uid(700), orgId: ORG, allowed: true, retryAfterSeconds: 1 } : over.auth),
    listModels: (orgId) =>
      Promise.resolve(
        orgId === ORG
          ? [{ id: MODEL, orgId: ORG, name: 'Test estate', slug: 'test-estate', description: null }]
          : [{ id: uid(950), orgId: OTHER_ORG, name: 'Other', slug: 'other', description: null }],
      ),
    mainCommit: () => Promise.resolve(uid(903)),
    createContext: () => estateContext(),
    ...over,
  };
}

function get(d: ApiHandlerDeps, path: string, query = '', authorization: string | null = `Bearer ${TOKEN}`, method = 'GET'): Promise<ApiResponse> {
  return handleApiRequest(d, { method, path, query: new URLSearchParams(query), authorization });
}
const list = (r: ApiResponse) => r.body as ApiList<Record<string, unknown>>;
const errorOf = (r: ApiResponse) => (r.body as ApiError).error;

describe('authentication', () => {
  it('refuses a missing, malformed or unknown key with 401', async () => {
    expect((await get(deps(), '/v1/models', '', null)).status).toBe(401);
    expect((await get(deps(), '/v1/models', '', 'Bearer not-a-key')).status).toBe(401);
    const unknown = await get(deps({ auth: null }), '/v1/models');
    expect(unknown.status).toBe(401);
    expect(unknown.headers['WWW-Authenticate']).toBe('Bearer');
  });

  it('answers 429 with Retry-After once a key is over its limit', async () => {
    const r = await get(deps({ auth: { keyId: uid(700), orgId: ORG, allowed: false, retryAfterSeconds: 17 } }), '/v1/models');
    expect(r.status).toBe(429);
    expect(r.headers['Retry-After']).toBe('17');
  });

  it('authenticates before it looks anything up', async () => {
    let looked = false;
    const d = deps({ auth: null, listModels: () => { looked = true; return Promise.resolve([]); } });
    await get(d, '/v1/models/anything');
    expect(looked).toBe(false);
  });

  it('checks the SHA-256 of the key, never the key itself', async () => {
    let seen = '';
    await get(deps({ authorize: (h) => { seen = h; return Promise.resolve(null); } }), '/v1/models');
    expect(seen).toBe(await hashApiKey(TOKEN));
    expect(seen).toMatch(/^[0-9a-f]{64}$/);
    expect(seen).not.toContain(TOKEN);
  });

  it('is read-only: every other method is refused before the key is even checked', async () => {
    let checked = false;
    const d = deps({ authorize: () => { checked = true; return Promise.resolve(null); } });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await get(d, '/v1/models', '', `Bearer ${TOKEN}`, method);
      expect(r.status, method).toBe(405);
      expect(r.headers.Allow).toBe('GET, HEAD');
    }
    expect(checked).toBe(false);
  });
});

describe('key parsing', () => {
  it('accepts exactly atl_ plus 64 hex characters', () => {
    expect(API_KEY_PATTERN.test(TOKEN)).toBe(true);
    expect(parseBearerKey(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(parseBearerKey(`bearer ${TOKEN}`)).toBe(TOKEN);
    expect(parseBearerKey(TOKEN)).toBeNull();
    expect(parseBearerKey(`Bearer ${TOKEN}x`)).toBeNull();
    expect(parseBearerKey('Bearer atl_short')).toBeNull();
  });
  it('hashes to a known SHA-256 value', async () => {
    expect(await hashApiKey('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('models', () => {
  it('lists only the key organisation models', async () => {
    const r = await get(deps(), '/v1/models');
    expect(r.status).toBe(200);
    expect(list(r).data.map((m) => m.slug)).toEqual(['test-estate']);
    const other = await get(deps({ auth: { keyId: uid(700), orgId: OTHER_ORG, allowed: true, retryAfterSeconds: 1 } }), '/v1/models');
    expect(list(other).data.map((m) => m.slug)).toEqual(['other']);
  });

  it('finds a model by id or slug, and another organisation model is not found', async () => {
    expect((await get(deps(), `/v1/models/${MODEL}`)).status).toBe(200);
    expect((await get(deps(), '/v1/models/test-estate')).status).toBe(200);
    const foreign = await get(deps(), `/v1/models/${uid(950)}/elements`);
    expect(foreign.status).toBe(404);
    expect(errorOf(foreign).code).toBe('not_found');
  });

  it('says so when a model has no data yet', async () => {
    const r = await get(deps({ mainCommit: () => Promise.resolve(null) }), '/v1/models/test-estate/elements');
    expect(r.status).toBe(404);
    expect(errorOf(r).code).toBe('empty_model');
  });
});

describe('elements', () => {
  it('lists every element, stamped with the commit it read', async () => {
    const r = await get(deps(), '/v1/models/test-estate/elements');
    const body = list(r);
    expect(body.page.total).toBe(9);
    expect(body.data).toHaveLength(9);
    expect(body.meta).toEqual({ api_version: 'v1', model: { id: MODEL, name: 'Test estate' }, commit_id: uid(903) });
    expect(body.data.find((e) => e.name === 'Billing Engine')).toMatchObject({ type: 'system', attributes: { criticality: 'critical' } });
  });

  it('filters by type and by name text', async () => {
    expect(list(await get(deps(), '/v1/models/test-estate/elements', 'type=system')).data).toHaveLength(4);
    expect(list(await get(deps(), '/v1/models/test-estate/elements', 'q=billing')).data.map((e) => e.name).sort()).toEqual(['Billing', 'Billing Engine']);
    expect((await get(deps(), '/v1/models/test-estate/elements', 'type=widget')).status).toBe(400);
  });

  it('returns one element with its aliases and the provenance of its facts', async () => {
    const r = await get(deps(), `/v1/models/test-estate/elements/${uid(10)}`);
    expect(r.status).toBe(200);
    const data = (r.body as { data: Record<string, unknown> }).data;
    expect(data.name).toBe('CRM Platform');
    expect(data.aliases).toEqual(['Customer Relationship Manager']);
    expect(Array.isArray(data.facts)).toBe(true);
    expect((await get(deps(), `/v1/models/test-estate/elements/${uid(77)}`)).status).toBe(404);
    expect((await get(deps(), '/v1/models/test-estate/elements/nope')).status).toBe(404);
  });
});

describe('capabilities, relationships, findings', () => {
  it('lists capabilities with the systems that support them', async () => {
    const body = list(await get(deps(), '/v1/models/test-estate/capabilities'));
    expect(body.data).toHaveLength(2);
    const onboarding = body.data.find((c) => c.name === 'Customer Onboarding');
    expect(onboarding?.supported_by).toEqual([uid(10), uid(12)]);
  });

  it('lists relationships and filters by type and by element', async () => {
    expect(list(await get(deps(), '/v1/models/test-estate/relationships')).page.total).toBe(7);
    expect(list(await get(deps(), '/v1/models/test-estate/relationships', 'type=owns')).data).toHaveLength(2);
    const ofElement = list(await get(deps(), '/v1/models/test-estate/relationships', `element=${uid(13)}`));
    expect(ofElement.data.map((r) => r.type)).toEqual(['uses', 'uses']);
    expect((await get(deps(), '/v1/models/test-estate/relationships', 'element=x')).status).toBe(400);
    expect((await get(deps(), '/v1/models/test-estate/relationships', 'type=loves')).status).toBe(400);
  });

  it('lists the findings with counts, and the elements one finding flags', async () => {
    const all = list(await get(deps(), '/v1/models/test-estate/findings'));
    expect(all.data.length).toBeGreaterThan(5);
    const unlinked = all.data.find((f) => f.key === 'unlinked-systems');
    expect(unlinked).toMatchObject({ label: 'Systems not linked to a capability' });
    expect(unlinked?.count as number).toBeGreaterThan(0);
    const detail = list(await get(deps(), '/v1/models/test-estate/findings/unlinked-systems'));
    expect(detail.page.total).toBe(unlinked?.count);
    expect(detail.data.map((e) => e.name)).toContain('Data Warehouse');
    expect((await get(deps(), '/v1/models/test-estate/findings/nonsense')).status).toBe(404);
  });

  it('answers an unknown path with 404', async () => {
    expect((await get(deps(), '/v2/models')).status).toBe(404);
    expect((await get(deps(), '/v1/widgets')).status).toBe(404);
    expect((await get(deps(), '/v1/models/test-estate/nope')).status).toBe(404);
    expect((await get(deps(), '/v1/models/test-estate/elements/a/b/c')).status).toBe(404);
  });
});

describe('paging', () => {
  it('walks every element exactly once, in id order, with an opaque cursor', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r = await get(deps(), '/v1/models/test-estate/elements', `limit=4${cursor === null ? '' : `&cursor=${cursor}`}`);
      const body = list(r);
      seen.push(...body.data.map((e) => e.id as string));
      cursor = body.page.next_cursor;
      pages++;
    } while (cursor !== null && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(9);
    expect(new Set(seen).size).toBe(9);
    expect(seen).toEqual([...seen].sort());
  });

  it('rejects a bad limit or a cursor it did not issue', async () => {
    for (const q of ['limit=0', 'limit=201', 'limit=abc', 'limit=-1', 'cursor=!!!', 'cursor=e30']) expect((await get(deps(), '/v1/models/test-estate/elements', q)).status, q).toBe(400);
  });

  it('round-trips a cursor and handles the edges', () => {
    expect(decodeCursor(encodeCursor('abc'))).toEqual({ ok: true, value: 'abc' });
    expect(decodeCursor(null)).toEqual({ ok: true, value: null });
    expect(parseLimit(null)).toBe(50);
    expect(parseLimit('200')).toBe(200);
    expect(pageOf([], (x: string) => x, null, 5)).toEqual({ items: [], page: { limit: 5, next_cursor: null, total: 0 } });
  });
});

describe('source', () => {
  it('has no write path: no insert, update, upsert, delete or rpc in src/api, and no Math.random', () => {
    for (const file of ['handler.ts', 'pagination.ts', 'apiKey.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/[\w)]\.(insert|update|upsert|delete|rpc)\(/);
      expect(source, file).not.toMatch(/Math\.random|\.in\(/);
    }
  });
});
