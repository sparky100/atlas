/**
 * Catalogue step 5a: check that a claim's source link still works. The pure
 * rules live here so they are tested without a network; the edge function
 * `catalogue-link-check` supplies the real `fetch` and DNS lookup.
 *
 * The function requests addresses taken from the database, so it may only
 * touch public web pages: https on the standard port, no credentials in the
 * address, no address that names a local or private network, checked again
 * after every redirect, no page body read, no cookies or user details sent.
 */
import { z } from 'zod';

export const LINK_CHECK_MAX_URLS = 25;
export const LINK_CHECK_MAX_REDIRECTS = 3;
export const LINK_CHECK_TIMEOUT_MS = 8_000;

export const linkCheckRequestSchema = z.object({
  urls: z.array(z.string().min(1).max(2000)).min(1).max(LINK_CHECK_MAX_URLS),
}).strict();

export const LINK_CHECK_RESULTS = ['works', 'moved', 'gone', 'could_not_check'] as const;
export type LinkCheckResultKind = (typeof LINK_CHECK_RESULTS)[number];

export interface LinkCheckResult {
  url: string;
  result: LinkCheckResultKind;
  httpStatus: number | null;
  finalUrl: string | null;
  note: string | null;
}

type UrlVerdict = { ok: true; url: URL } | { ok: false; reason: string };

/** An address is only requested if it is a plain public https page. */
export function publicHttpsUrl(raw: string): UrlVerdict {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: 'Not a valid web address.' }; }
  if (url.protocol !== 'https:') return { ok: false, reason: 'Only https links are checked.' };
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'The address contains a user name or password.' };
  if (url.port !== '' && url.port !== '443') return { ok: false, reason: 'The address uses a non-standard port.' };
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '' || !host.includes('.')) return { ok: false, reason: 'The address is not a public website.' };
  // An IP written out, in any notation (the URL parser has already turned 0x7f.1 and 2130706433 into dotted form), is never fetched.
  if (/^\d+(\.\d+){3}$/.test(host) || host.startsWith('[') || host.includes(':')) return { ok: false, reason: 'The address is an IP number, not a website name.' };
  if (/(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|test|invalid)$/.test(host)) return { ok: false, reason: 'The address names a local network.' };
  return { ok: true, url };
}

/** Whether a resolved IP address belongs to a private, loopback, link-local or otherwise non-public range. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.trim().toLowerCase();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
  }
  if (ip.includes(':')) {
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
    if (mapped?.[1] !== undefined) return isPrivateAddress(mapped[1]);
    return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || ip.startsWith('ff') || ip.startsWith('::ffff:');
  }
  // Not an address we understand: treat as unsafe.
  return true;
}

/** Host, path and query compared without scheme case, a leading "www." or a trailing slash, so a tidy-up redirect is not called "moved". */
function sameDestination(a: URL, b: URL): boolean {
  const norm = (url: URL) => `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  return norm(a) === norm(b);
}

export interface LinkCheckDeps {
  /** `fetch` with redirects handled by the caller (`redirect: 'manual'`). */
  request: (url: string, method: 'HEAD' | 'GET', signal: AbortSignal) => Promise<{ status: number; location: string | null; discard: () => void }>;
  /** IP addresses for a host name; throws when it does not resolve. */
  resolve: (host: string) => Promise<string[]>;
  timeoutMs?: number;
}

const note = (text: string) => text.slice(0, 200);

export async function checkLink(raw: string, deps: LinkCheckDeps): Promise<LinkCheckResult> {
  const cannot = (text: string, httpStatus: number | null = null, finalUrl: string | null = null): LinkCheckResult =>
    ({ url: raw, result: 'could_not_check', httpStatus, finalUrl, note: note(text) });
  const first = publicHttpsUrl(raw);
  if (!first.ok) return cannot(first.reason);

  let current = first.url;
  for (let hop = 0; hop <= LINK_CHECK_MAX_REDIRECTS; hop += 1) {
    const verdict = hop === 0 ? first : publicHttpsUrl(current.toString());
    if (!verdict.ok) return cannot(hop === 0 ? verdict.reason : 'The link redirects to an address that is not a public web page.', null, current.toString());
    try {
      const addresses = await deps.resolve(verdict.url.hostname);
      if (addresses.length === 0 || addresses.some(isPrivateAddress)) return cannot('The site name does not point to a public address.');
    } catch {
      return cannot('The site name could not be found.');
    }

    let response: Awaited<ReturnType<LinkCheckDeps['request']>>;
    try {
      const attempt = async (method: 'HEAD' | 'GET') => {
        const controller = new AbortController();
        const timer = setTimeout(() => { controller.abort(); }, deps.timeoutMs ?? LINK_CHECK_TIMEOUT_MS);
        try { return await deps.request(verdict.url.toString(), method, controller.signal); } finally { clearTimeout(timer); }
      };
      response = await attempt('HEAD');
      // Some sites refuse HEAD; ask again with GET (the body is never read).
      if (response.status === 405 || response.status === 501 || response.status === 403 || response.status === 400) {
        response.discard();
        response = await attempt('GET');
      }
    } catch {
      return cannot('The site did not answer in time or refused the request.', null, hop === 0 ? null : current.toString());
    }
    response.discard();

    if (response.status >= 300 && response.status < 400 && response.location !== null) {
      try { current = new URL(response.location, verdict.url); } catch { return cannot('The link redirects to an invalid address.', response.status); }
      continue;
    }
    const finalUrl = current.toString();
    if (response.status >= 200 && response.status < 300) {
      if (hop === 0 || sameDestination(first.url, current)) return { url: raw, result: 'works', httpStatus: response.status, finalUrl: null, note: null };
      return { url: raw, result: 'moved', httpStatus: response.status, finalUrl, note: note('The link now leads to a different page.') };
    }
    if (response.status === 404 || response.status === 410) return { url: raw, result: 'gone', httpStatus: response.status, finalUrl: hop === 0 ? null : finalUrl, note: null };
    return cannot(`The site answered with status ${String(response.status)}.`, response.status, hop === 0 ? null : finalUrl);
  }
  return cannot('The link redirects too many times.');
}

/** Distinct, valid-looking links only, in first-seen order, so one page is requested once however many claims cite it. */
export function distinctUrls(urls: readonly string[]): string[] {
  return [...new Set(urls.map((url) => url.trim()).filter((url) => url !== ''))];
}
