import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { explainCliFailure, exportEnvironments, parseArgs, parseCliJson, sanitiseApi, sanitiseContract, withRetry } from '../../docs/import/mulesoft/mulesoft-export.mjs';

const FIXTURE_DIR = new URL('./fixtures/mulesoft/', import.meta.url);
const readFixture = (name: string): string => readFileSync(new URL(name, FIXTURE_DIR), 'utf8');

/** A fake CLI answering from the sandbox fixtures: the API list, and each API's contracts by id. */
function fakeRun(overrides: Record<string, string | Error> = {}) {
  const calls: { args: string[]; env: string }[] = [];
  const run = (args: string[], environmentName: string): Promise<string> => {
    calls.push({ args, env: environmentName });
    const key = args.slice(0, 3).join(' ');
    if (key === 'api-mgr api list') return Promise.resolve(`(node:1) [DEP0040] DeprecationWarning: The \`punycode\` module is deprecated.\n${readFixture('apis.sandbox.json')}`);
    const id = args[3];
    const override = id === undefined ? undefined : overrides[id];
    if (override instanceof Error) return Promise.reject(override);
    if (override !== undefined) return Promise.resolve(override);
    return Promise.resolve(readFixture(`contracts-${String(id)}.json`));
  };
  return { run, calls };
}

describe('mulesoft-export script', () => {
  it('collects every API and its contracts, reduced to the allow-listed fields', async () => {
    const { run, calls } = fakeRun();
    const result = await exportEnvironments({ envs: ['Sandbox'], run, now: '2026-10-17T13:00:00.000Z' });

    expect(result.format).toBe('atlas-mulesoft-export');
    expect(result.version).toBe(1);
    expect(result.organizationId).toBe('00000000-0000-4000-8000-00000000a001');
    expect(result.warnings).toEqual([]);
    expect(result.environments).toHaveLength(1);
    const environment = result.environments[0];
    expect(environment?.name).toBe('Sandbox');
    expect(environment?.apis.map((api) => api.assetId)).toEqual(['test-2', 'test']);
    expect(Object.keys(environment?.contracts ?? {}).sort()).toEqual(['21241997', '21241998']);
    expect(environment?.contracts['21241997']?.map((contract) => (contract.application as { name: string }).name)).toEqual(['PM', 'Field Service']);
    expect(calls.every((call) => call.env === 'Sandbox')).toBe(true);
  });

  it('is deterministic for the same CLI output and clock', async () => {
    const first = await exportEnvironments({ envs: ['Sandbox'], run: fakeRun().run, now: 'T' });
    const second = await exportEnvironments({ envs: ['Sandbox'], run: fakeRun().run, now: 'T' });
    expect(second).toEqual(first);
  });

  it('never copies a field outside the allow-lists, so a secret-looking field cannot reach the file', () => {
    const api = sanitiseApi({ id: 1, assetId: 'x', clientSecret: 'shh', endpointUri: 'http://a.example.com', audit: { created: {} } });
    expect(api).toEqual({ id: 1, assetId: 'x', endpointUri: 'http://a.example.com' });

    const contract = sanitiseContract({ id: 2, status: 'APPROVED', apiId: 1, application: { id: 3, name: 'PM', clientProvider: {}, url: 'http://x', coreServicesId: 'c' }, tier: { secret: 1 }, terms: 'x' });
    expect(contract).toEqual({ id: 2, status: 'APPROVED', apiId: 1, application: { id: 3, name: 'PM' } });
  });

  it('records a failing contract call as a warning and carries on', async () => {
    const { run } = fakeRun({ '21241997': new Error('boom') });
    const result = await exportEnvironments({ envs: ['Sandbox'], run, now: 'T' });
    expect(result.environments[0]?.contracts['21241997']).toEqual([]);
    expect(result.environments[0]?.contracts['21241998']).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Contracts for API 21241997 in Sandbox could not be read, so its client applications are missing');
    expect(result.warnings[0]).toContain('boom');
  });

  it('records unreadable contract output as a warning too', async () => {
    const { run } = fakeRun({ '21241998': 'not json at all' });
    const result = await exportEnvironments({ envs: ['Sandbox'], run, now: 'T' });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('21241998');
  });

  it('fails outright when the API list itself is unreadable', async () => {
    await expect(exportEnvironments({ envs: ['Sandbox'], run: () => Promise.resolve('Error: not logged in'), now: 'T' })).rejects.toThrow('API list for Sandbox');
  });

  it('walks each requested environment in order', async () => {
    const { run, calls } = fakeRun();
    const result = await exportEnvironments({ envs: ['Sandbox', 'Production'], run, now: 'T' });
    expect(result.environments.map((environment) => environment.name)).toEqual(['Sandbox', 'Production']);
    expect(calls.filter((call) => call.args[2] === 'list' && call.args[1] === 'api').map((call) => call.env)).toEqual(['Sandbox', 'Production']);
  });
});

describe('mulesoft-export script — warnings about an incomplete export', () => {
  const listOf = (count: number): string => JSON.stringify(Array.from({ length: count }, (_, i) => ({ id: i + 1, assetId: `api-${String(i + 1)}` })));
  const runWith = (list: string) => (args: string[]): Promise<string> => Promise.resolve(args[1] === 'api' ? list : '[]');

  it('warns when an environment lists no APIs, rather than writing a quietly empty export', async () => {
    const result = await exportEnvironments({ envs: ['Production'], run: runWith('[]'), now: 'T' });
    expect(result.environments[0]?.apis).toEqual([]);
    expect(result.warnings).toEqual([expect.stringContaining('Production: the CLI listed no APIs')]);
  });

  it('warns when the list is exactly a likely page size', async () => {
    const result = await exportEnvironments({ envs: ['Production'], run: runWith(listOf(20)), now: 'T' });
    expect(result.warnings).toEqual([expect.stringContaining('exactly 20 APIs, which may be a page limit')]);
  });

  it('does not warn for an ordinary count', async () => {
    const result = await exportEnvironments({ envs: ['Production'], run: runWith(listOf(7)), now: 'T' });
    expect(result.warnings).toEqual([]);
  });
});

describe('withRetry', () => {
  const noWait = { sleep: () => Promise.resolve(), delayMs: 0 };

  it('retries a transient failure and returns the eventual result', async () => {
    let calls = 0;
    const result = await withRetry(() => (++calls < 3 ? Promise.reject(new Error('socket hang up')) : Promise.resolve('ok')), noWait);
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('gives up after the attempts and throws the last error', async () => {
    let calls = 0;
    await expect(withRetry(() => Promise.reject(new Error(`try ${String(++calls)}`)), { ...noWait, attempts: 3 })).rejects.toThrow('try 3');
    expect(calls).toBe(3);
  });

  it('does not retry a failure that retrying cannot fix', async () => {
    let calls = 0;
    await expect(withRetry(() => Promise.reject(Object.assign(new Error('401 Unauthorized'), { stderr: '' })), noWait)).rejects.toThrow('401');
    expect(calls).toBe(0);
    await withRetry(() => Promise.resolve(++calls), noWait);
    expect(calls).toBe(1);
  });
});

describe('explainCliFailure', () => {
  it('explains a missing CLI', () => {
    expect(explainCliFailure(Object.assign(new Error('spawn anypoint-cli-v4 ENOENT'), { code: 'ENOENT' }))).toContain('npm install -g anypoint-cli-v4');
  });

  it('explains a refused or missing login', () => {
    expect(explainCliFailure(new Error('Error: 401 Unauthorized'))).toContain('not logged in');
    expect(explainCliFailure(Object.assign(new Error('Command failed'), { stderr: 'Error: Invalid credentials: not logged in' }))).toContain('not logged in');
  });

  it('explains a missing permission and an unknown environment', () => {
    expect(explainCliFailure(new Error('403 Forbidden'))).toContain('API Manager access');
    expect(explainCliFailure(new Error('Environment Staging not found'))).toContain('environment name');
  });

  it('leaves anything else to be shown as it is', () => {
    expect(explainCliFailure(new Error('socket hang up'))).toBeNull();
  });
});

describe('parseCliJson', () => {
  it('skips warning lines before the JSON', () => {
    expect(parseCliJson('(node:1) warning\n[{"a":1}]', 'x')).toEqual([{ a: 1 }]);
  });

  it('refuses output with no JSON', () => {
    expect(() => parseCliJson('nothing here', 'x')).toThrow('printed no JSON');
  });
});

describe('parseArgs', () => {
  it('defaults to Production and mulesoft-export.json', () => {
    expect(parseArgs([])).toEqual({ envs: ['Production'], out: 'mulesoft-export.json' });
  });

  it('takes repeated --env and --out', () => {
    expect(parseArgs(['--env', 'Sandbox', '--env', 'Production', '--out', 'x.json'])).toEqual({ envs: ['Sandbox', 'Production'], out: 'x.json' });
  });

  it('rejects an unknown flag and a missing value', () => {
    expect(() => parseArgs(['--nope'])).toThrow('Unknown argument');
    expect(() => parseArgs(['--env'])).toThrow('--env needs');
    expect(() => parseArgs(['--env', '--out'])).toThrow('--env needs');
  });
});
