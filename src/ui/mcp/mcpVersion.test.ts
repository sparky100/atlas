import { describe, expect, it } from 'vitest';
import { fetchMcpDownload, parseMcpVersion } from './mcpVersion';

const reply = (body: () => Promise<unknown>, ok = true): typeof fetch => (() => Promise.resolve({ ok, json: body } as Response));

describe('parseMcpVersion', () => {
  it('reads the published file', () => {
    expect(parseMcpVersion({ version: '0.1.0', downloads: { extension: 'atlas.mcpb' } })).toEqual({ version: '0.1.0', extensionUrl: '/downloads/atlas.mcpb' });
  });
  it('rejects anything else, including a path trick', () => {
    expect(parseMcpVersion(null)).toBeNull();
    expect(parseMcpVersion({ version: '0.1.0' })).toBeNull();
    expect(parseMcpVersion({ version: '0.1.0', downloads: { extension: '../secret.mcpb' } })).toBeNull();
    expect(parseMcpVersion({ version: '0.1.0', downloads: { extension: 'atlas.zip' } })).toBeNull();
  });
});

describe('fetchMcpDownload', () => {
  it('returns nothing when the file is missing, unreadable or unreachable', async () => {
    expect(await fetchMcpDownload(reply(() => Promise.resolve({}), false))).toBeNull();
    expect(await fetchMcpDownload(reply(() => Promise.reject(new Error('<html> is not JSON'))))).toBeNull();
    expect(await fetchMcpDownload((() => Promise.reject(new Error('offline'))))).toBeNull();
  });
});
