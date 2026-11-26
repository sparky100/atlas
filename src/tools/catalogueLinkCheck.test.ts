import { describe, expect, it } from 'vitest';
import { checkLink, distinctUrls, isPrivateAddress, linkCheckRequestSchema, publicHttpsUrl, type LinkCheckDeps } from './catalogueLinkCheck';

interface Reply { status: number; location?: string }

function deps(replies: Record<string, Reply | 'throw'>, addresses: Record<string, string[] | 'throw'> = {}): LinkCheckDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    resolve: (host) => {
      const found = addresses[host] ?? ['93.184.216.34'];
      return found === 'throw' ? Promise.reject(new Error('no such host')) : Promise.resolve(found);
    },
    request: (url, method) => {
      calls.push(`${method} ${url}`);
      const reply = replies[`${method} ${url}`] ?? replies[url];
      if (reply === undefined || reply === 'throw') return Promise.reject(new Error('network'));
      return Promise.resolve({ status: reply.status, location: reply.location ?? null, discard: () => undefined });
    },
  };
}

describe('publicHttpsUrl', () => {
  it('accepts a plain https page', () => { expect(publicHttpsUrl('https://example.com/a?b=1').ok).toBe(true); });
  it.each([
    'http://example.com/', 'ftp://example.com/', 'https://user:pw@example.com/', 'https://example.com:8443/', 'https://localhost/', 'https://printer/', 'https://intranet.corp/',
    'https://127.0.0.1/', 'https://0x7f.1/', 'https://2130706433/', 'https://[::1]/', 'https://10.0.0.5/', 'https://metadata.google.internal/', 'not a url',
  ])('refuses %s', (raw) => { expect(publicHttpsUrl(raw).ok).toBe(false); });
});

describe('isPrivateAddress', () => {
  it.each(['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', 'garbage'])('%s is not public', (ip) => { expect(isPrivateAddress(ip)).toBe(true); });
  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946'])('%s is public', (ip) => { expect(isPrivateAddress(ip)).toBe(false); });
});

describe('checkLink', () => {
  it('reports a page that answers 200 as working', async () => {
    const d = deps({ 'https://example.com/a': { status: 200 } });
    expect(await checkLink('https://example.com/a', d)).toEqual({ url: 'https://example.com/a', result: 'works', httpStatus: 200, finalUrl: null, note: null });
  });
  it('reports 404 and 410 as gone', async () => {
    expect((await checkLink('https://example.com/a', deps({ 'https://example.com/a': { status: 404 } }))).result).toBe('gone');
    expect((await checkLink('https://example.com/a', deps({ 'https://example.com/a': { status: 410 } }))).result).toBe('gone');
  });
  it('treats a tidy-up redirect (www or trailing slash) as working, and a different page as moved', async () => {
    const tidy = deps({ 'https://example.com/a': { status: 301, location: 'https://www.example.com/a/' }, 'https://www.example.com/a/': { status: 200 } });
    expect((await checkLink('https://example.com/a', tidy)).result).toBe('works');
    const moved = deps({ 'https://example.com/a': { status: 301, location: 'https://other.example.org/new' }, 'https://other.example.org/new': { status: 200 } });
    expect(await checkLink('https://example.com/a', moved)).toMatchObject({ result: 'moved', finalUrl: 'https://other.example.org/new', httpStatus: 200 });
  });
  it('asks again with GET when HEAD is refused', async () => {
    const d = deps({ 'HEAD https://example.com/a': { status: 405 }, 'GET https://example.com/a': { status: 200 } });
    expect((await checkLink('https://example.com/a', d)).result).toBe('works');
    expect(d.calls).toEqual(['HEAD https://example.com/a', 'GET https://example.com/a']);
  });
  it('says could not check for other statuses, timeouts and unresolvable names, never gone', async () => {
    expect(await checkLink('https://example.com/a', deps({ 'https://example.com/a': { status: 503 } }))).toMatchObject({ result: 'could_not_check', httpStatus: 503 });
    expect((await checkLink('https://example.com/a', deps({ 'https://example.com/a': 'throw' }))).result).toBe('could_not_check');
    expect((await checkLink('https://nope.example.com/', deps({}, { 'nope.example.com': 'throw' }))).result).toBe('could_not_check');
  });
  it('never requests a host that resolves to a private address, or a redirect to one', async () => {
    const dns = deps({ 'https://example.com/a': { status: 200 } }, { 'example.com': ['10.0.0.8'] });
    expect((await checkLink('https://example.com/a', dns)).result).toBe('could_not_check');
    expect(dns.calls).toEqual([]);
    const toPrivate = deps({ 'https://example.com/a': { status: 302, location: 'https://192.168.0.1/admin' } });
    expect(await checkLink('https://example.com/a', toPrivate)).toMatchObject({ result: 'could_not_check' });
    expect(toPrivate.calls).toEqual(['HEAD https://example.com/a']);
    const toHttp = deps({ 'https://example.com/a': { status: 302, location: 'http://example.com/a' } });
    expect((await checkLink('https://example.com/a', toHttp)).result).toBe('could_not_check');
  });
  it('stops after three redirects', async () => {
    const replies: Record<string, Reply> = {};
    for (let i = 0; i < 6; i += 1) replies[`https://example.com/${String(i)}`] = { status: 302, location: `https://example.com/${String(i + 1)}` };
    const d = deps(replies);
    expect(await checkLink('https://example.com/0', d)).toMatchObject({ result: 'could_not_check', note: 'The link redirects too many times.' });
    expect(d.calls.length).toBe(4);
  });
});

describe('request and url lists', () => {
  it('allows 1 to 25 links and nothing else', () => {
    expect(linkCheckRequestSchema.safeParse({ urls: ['https://example.com'] }).success).toBe(true);
    expect(linkCheckRequestSchema.safeParse({ urls: [] }).success).toBe(false);
    expect(linkCheckRequestSchema.safeParse({ urls: Array.from({ length: 26 }, (_, i) => `https://e.com/${String(i)}`) }).success).toBe(false);
    expect(linkCheckRequestSchema.safeParse({ urls: ['https://example.com'], extra: 1 }).success).toBe(false);
  });
  it('requests each distinct link once', () => {
    expect(distinctUrls(['https://a.com', ' https://a.com ', '', 'https://b.com'])).toEqual(['https://a.com', 'https://b.com']);
  });
});
