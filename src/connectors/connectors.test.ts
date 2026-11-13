import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMulesoftExport, convertMulesoftExport } from '../capture/adapters/mulesoft';
import { parseMulesoftConfig, type ConnectorRow } from '../contracts/connectors';
import { handleConnectorFetch, parseConnectorFetchBody, type ConnectorHandlerDeps } from './handler';
import type { Http, HttpResponse } from './http';
import { fetchMulesoftExport, sanitiseApi, sanitiseContract, type AnypointDeps } from './mulesoft/anypoint';

const ORG = '00000000-0000-4000-8000-000000000001';
const CONFIG = { region: 'us', organizationId: 'org-1234-abcd', clientId: 'client-id-12345', environments: ['Production'] };
const SECRET = 'super-secret-value-9876';

// Canned responses built from the documented Anypoint shapes. They were NOT recorded from a live tenant.
const ENVIRONMENTS = { data: [{ id: 'env-prod', name: 'Production' }, { id: 'env-sbx', name: 'Sandbox' }] };
const APIS_PAGE = { total: 2, assets: [{ assetId: 'customer-api', apis: [{ id: 101, assetVersion: '1.0.0', instanceLabel: null, endpointUri: 'https://crm.example.com/v1', endpointType: 'http', deprecated: false, activeContractsCount: 1, clientSecret: 'must-not-copy' }] }, { assetId: 'billing_api', apis: [{ id: 102, assetVersion: '2.1.0', endpoint: { uri: 'https://billing.example.com', type: 'http' }, deprecated: true }] }] };
const CONTRACTS: Record<string, unknown> = {
  '101': { contracts: [{ id: 1, status: 'APPROVED', application: { id: 7, name: 'Web Portal', secret: 'nope' }, clientSecret: 'nope' }] },
  '102': { contracts: [] },
};

function json(status: number, body: unknown): HttpResponse {
  return { status, text: () => Promise.resolve(JSON.stringify(body)) };
}

function fakeHttp(over: { token?: HttpResponse; contracts?: (apiId: string) => HttpResponse } = {}): { http: Http; calls: { url: string; method: string; authorization?: string }[] } {
  const calls: { url: string; method: string; authorization?: string }[] = [];
  const http: Http = (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', ...(init?.headers?.Authorization ? { authorization: init.headers.Authorization } : {}) });
    if (url.endsWith('/accounts/api/v2/oauth2/token')) return Promise.resolve(over.token ?? json(200, { access_token: 'tok-123', token_type: 'bearer' }));
    if (url.includes('/accounts/api/organizations/') && url.endsWith('/environments')) return Promise.resolve(json(200, ENVIRONMENTS));
    const contractMatch = /\/apis\/(\d+)\/contracts/.exec(url);
    if (contractMatch?.[1]) return Promise.resolve(over.contracts ? over.contracts(contractMatch[1]) : json(200, CONTRACTS[contractMatch[1]] ?? { contracts: [] }));
    if (url.includes('/apimanager/api/v1/') && url.includes('/apis?')) return Promise.resolve(json(200, APIS_PAGE));
    return Promise.resolve(json(404, {}));
  };
  return { http, calls };
}

function deps(http: Http, over: Partial<AnypointDeps> = {}): AnypointDeps {
  let t = Date.parse('2026-11-13T09:00:00Z');
  return { http, now: () => new Date((t += 10)), sleep: () => Promise.resolve(), ...over };
}

describe('parseMulesoftConfig', () => {
  it('accepts a complete setting and tidies the environment list', () => {
    const r = parseMulesoftConfig({ ...CONFIG, environments: [' Production ', 'Sandbox', 'Production', ''] });
    expect(r).toEqual({ ok: true, config: { ...CONFIG, environments: ['Production', 'Sandbox'] } });
  });
  it('explains each problem in plain English', () => {
    expect(parseMulesoftConfig(null)).toMatchObject({ ok: false });
    expect(parseMulesoftConfig({ ...CONFIG, region: 'mars' })).toMatchObject({ ok: false, error: expect.stringMatching(/region/i) });
    expect(parseMulesoftConfig({ ...CONFIG, organizationId: 'x' })).toMatchObject({ ok: false, error: expect.stringMatching(/organisation ID/i) });
    expect(parseMulesoftConfig({ ...CONFIG, clientId: '' })).toMatchObject({ ok: false, error: expect.stringMatching(/client ID/i) });
    expect(parseMulesoftConfig({ ...CONFIG, environments: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/environment/i) });
    expect(parseMulesoftConfig({ ...CONFIG, environments: Array.from({ length: 11 }, (_, i) => `e${String(i)}`) })).toMatchObject({ ok: false });
  });
  it('never carries a secret field through', () => {
    const r = parseMulesoftConfig({ ...CONFIG, clientSecret: SECRET });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });
});

describe('fetchMulesoftExport', () => {
  it('produces a file the existing export parser and converter accept, and converts to the same shape as the script would', async () => {
    const { http } = fakeHttp();
    const doc = await fetchMulesoftExport(deps(http), CONFIG as never, SECRET);
    const parsed = parseMulesoftExport(JSON.stringify(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { importJson, report } = convertMulesoftExport(parsed.file);
    expect(report.counts).toMatchObject({ interfaces: 2, consumers: 1, relationships: 1 });
    expect(importJson.systems.map((s) => s.name)).toEqual(expect.arrayContaining(['MuleSoft Anypoint', 'Customer Api', 'Billing Api', 'Web Portal']));
    expect(doc.environments[0]?.apis.find((a) => a.id === 102)).toMatchObject({ endpointUri: 'https://billing.example.com', endpointType: 'http', deprecated: true });
  });

  it('only copies allow-listed fields: no secret-looking field reaches the file', async () => {
    const { http } = fakeHttp();
    const doc = await fetchMulesoftExport(deps(http), CONFIG as never, SECRET);
    const text = JSON.stringify(doc);
    expect(text).not.toContain('must-not-copy');
    expect(text).not.toContain('nope');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('tok-123');
    expect(sanitiseApi({ id: 1, clientSecret: 'x', assetId: 'a' })).toEqual({ id: 1, assetId: 'a' });
    expect(sanitiseContract({ id: 1, status: 'APPROVED', application: { id: 2, name: 'n', secret: 'x' }, token: 'y' })).toEqual({ id: 1, status: 'APPROVED', application: { id: 2, name: 'n' } });
  });

  it('is read-only: one POST (the token) and every other call a GET with the bearer token', async () => {
    const { http, calls } = fakeHttp();
    await fetchMulesoftExport(deps(http), CONFIG as never, SECRET);
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe('https://anypoint.mulesoft.com/accounts/api/v2/oauth2/token');
    for (const c of calls.filter((x) => x.method === 'GET')) expect(c.authorization).toBe('Bearer tok-123');
  });

  it('uses the regional host', async () => {
    const { http, calls } = fakeHttp();
    await fetchMulesoftExport(deps(http), { ...CONFIG, region: 'eu' } as never, SECRET);
    expect(calls.every((c) => c.url.startsWith('https://eu1.anypoint.mulesoft.com/'))).toBe(true);
  });

  it('turns a refused sign-in into a plain message', async () => {
    const { http } = fakeHttp({ token: json(401, { error: 'invalid_client' }) });
    await expect(fetchMulesoftExport(deps(http), CONFIG as never, SECRET)).rejects.toMatchObject({ code: 'sign_in_failed', message: expect.stringMatching(/client ID and secret/) });
  });

  it('records an unreadable contract list as a warning and carries on', async () => {
    const { http } = fakeHttp({ contracts: (id) => (id === '101' ? json(403, {}) : json(200, { contracts: [] })) });
    const doc = await fetchMulesoftExport(deps(http), CONFIG as never, SECRET);
    expect(doc.warnings.join(' ')).toMatch(/Contracts for API 101/);
    expect(doc.environments[0]?.apis).toHaveLength(2);
  });

  it('warns about an environment Anypoint does not have, and fails when none exist', async () => {
    const { http } = fakeHttp();
    const some = await fetchMulesoftExport(deps(http), { ...CONFIG, environments: ['Production', 'Nope'] } as never, SECRET);
    expect(some.warnings.join(' ')).toMatch(/Nope.*no environment with that name/);
    await expect(fetchMulesoftExport(deps(http), { ...CONFIG, environments: ['Nope'] } as never, SECRET)).rejects.toMatchObject({ code: 'no_access' });
  });

  it('retries a busy server, then gives up with a plain message', async () => {
    let n = 0;
    const base = fakeHttp().http;
    const http: Http = (url, init) => (url.includes('/environments') && ++n <= 2 ? Promise.resolve(json(503, {})) : base(url, init));
    await expect(fetchMulesoftExport(deps(http), CONFIG as never, SECRET)).resolves.toBeDefined();
    const always: Http = (url, init) => (url.includes('/environments') ? Promise.resolve(json(503, {})) : base(url, init));
    await expect(fetchMulesoftExport(deps(always), CONFIG as never, SECRET)).rejects.toMatchObject({ code: 'provider' });
  });

  it('stops reading contracts when the time budget runs out and says the export is incomplete', async () => {
    const { http } = fakeHttp();
    const doc = await fetchMulesoftExport(deps(http, { budgetMs: -1 }), CONFIG as never, SECRET);
    expect(doc.warnings.join(' ')).toMatch(/ran out of time/);
  });
});

function connectorRow(over: Partial<ConnectorRow> = {}): ConnectorRow {
  return { id: '00000000-0000-4000-8000-0000000000c1', org_id: ORG, kind: 'mulesoft', config: CONFIG, created_by: ORG, created_at: '', updated_at: '', last_fetch_at: null, last_fetch_status: null, last_fetch_message: null, ...over };
}

function handlerDeps(over: Partial<ConnectorHandlerDeps> & { recorded?: { status: string; message: string }[]; secretReads?: string[] } = {}): ConnectorHandlerDeps {
  const { http } = fakeHttp();
  return {
    loadConnector: () => Promise.resolve(connectorRow()),
    readSecret: (id) => {
      over.secretReads?.push(id);
      return Promise.resolve(SECRET);
    },
    recordOutcome: (_id, status, message) => {
      over.recorded?.push({ status, message });
      return Promise.resolve();
    },
    runtime: { http, now: () => new Date('2026-11-13T09:00:00Z'), sleep: () => Promise.resolve() },
    ...over,
  };
}

describe('handleConnectorFetch', () => {
  it('rejects a bad body before reading anything', async () => {
    const secretReads: string[] = [];
    for (const body of [null, {}, { orgId: 'x', kind: 'mulesoft', mode: 'fetch' }, { orgId: ORG, kind: 'nope', mode: 'fetch' }, { orgId: ORG, kind: 'mulesoft', mode: 'write' }]) {
      expect(await handleConnectorFetch(handlerDeps({ secretReads }), body)).toMatchObject({ status: 'error', code: 'invalid' });
    }
    expect(secretReads).toEqual([]);
    expect(parseConnectorFetchBody({ orgId: ORG, kind: 'mulesoft', mode: 'test' })).toEqual({ orgId: ORG, kind: 'mulesoft', mode: 'test' });
  });

  it('never touches the secret when the caller cannot read the connector', async () => {
    const secretReads: string[] = [];
    const r = await handleConnectorFetch(handlerDeps({ loadConnector: () => Promise.resolve(null), secretReads }), { orgId: ORG, kind: 'mulesoft', mode: 'fetch' });
    expect(r).toMatchObject({ status: 'error', code: 'not_found' });
    expect(secretReads).toEqual([]);
  });

  it('fetch returns the file and records the outcome; the secret is never in the answer', async () => {
    const recorded: { status: string; message: string }[] = [];
    const r = await handleConnectorFetch(handlerDeps({ recorded }), { orgId: ORG, kind: 'mulesoft', mode: 'fetch' });
    expect(r).toMatchObject({ status: 'ok', mode: 'fetch', fileName: 'mulesoft-export.json' });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(recorded).toEqual([{ status: 'ok', message: 'Fetched.' }]);
  });

  it('test only signs in and checks the environments', async () => {
    const r = await handleConnectorFetch(handlerDeps(), { orgId: ORG, kind: 'mulesoft', mode: 'test' });
    expect(r).toMatchObject({ status: 'ok', mode: 'test', message: expect.stringContaining('found Production') });
  });

  it('reports a failure plainly, records it, and keeps the secret out of the message', async () => {
    const recorded: { status: string; message: string }[] = [];
    const bad = fakeHttp({ token: json(401, {}) }).http;
    const r = await handleConnectorFetch(handlerDeps({ recorded, runtime: { http: bad, now: () => new Date(), sleep: () => Promise.resolve() } }), { orgId: ORG, kind: 'mulesoft', mode: 'fetch' });
    expect(r).toMatchObject({ status: 'error', code: 'sign_in_failed' });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(recorded[0]?.status).toBe('error');
  });

  it('asks for the secret again when it is missing, and rejects unusable stored settings', async () => {
    expect(await handleConnectorFetch(handlerDeps({ readSecret: () => Promise.resolve(null) }), { orgId: ORG, kind: 'mulesoft', mode: 'fetch' })).toMatchObject({ status: 'error', message: expect.stringMatching(/Enter it again/) });
    expect(await handleConnectorFetch(handlerDeps({ loadConnector: () => Promise.resolve(connectorRow({ config: {} })) }), { orgId: ORG, kind: 'mulesoft', mode: 'fetch' })).toMatchObject({ status: 'error', code: 'invalid' });
  });
});

describe('source', () => {
  it('has no write path to Atlas data and no randomness in src/connectors', () => {
    const files = ['handler.ts', 'http.ts', 'registry.ts', 'mulesoft/anypoint.ts'];
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/[\w)]\.(insert|update|upsert|delete|rpc)\(/);
      expect(source, file).not.toMatch(/Math\.random|\.in\(|console\.log/);
      expect(source, file).not.toMatch(/from '\.\.\/ui\//);
    }
    expect(readdirSync(new URL('.', import.meta.url)).includes('connectors.test.ts')).toBe(true);
  });
});
