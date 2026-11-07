import { describe, expect, it } from 'vitest';
import { checkForUpdate, isNewer } from './updateCheck';

const reply = (body: unknown, ok = true): typeof fetch => (() => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response));

describe('isNewer', () => {
  it('compares numerically, not as text', () => {
    expect(isNewer('0.10.0', '0.9.0')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1', '0.1.1')).toBe(false);
  });
});

describe('checkForUpdate', () => {
  const base = { versionUrl: 'https://atlas.example/downloads/mcp-version.json', current: '0.1.0' };
  it('says so when a newer version is published', async () => {
    expect(await checkForUpdate({ ...base, fetchFn: reply({ version: '0.2.0' }) })).toMatch(/0\.2\.0/);
  });
  it('is quiet when up to date, unreadable, failing or unreachable', async () => {
    expect(await checkForUpdate({ ...base, fetchFn: reply({ version: '0.1.0' }) })).toBeNull();
    expect(await checkForUpdate({ ...base, fetchFn: reply('<html>') })).toBeNull();
    expect(await checkForUpdate({ ...base, fetchFn: reply({}, false) })).toBeNull();
    expect(await checkForUpdate({ ...base, fetchFn: (() => Promise.reject(new Error('offline'))) })).toBeNull();
  });
});
