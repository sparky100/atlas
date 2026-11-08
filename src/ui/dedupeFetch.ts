/**
 * Request coalescing for the browser's Supabase client (performance:
 * "Speed up capability and landscape maps"). A page load fires the same
 * read from several hooks at once — a HAR of a landscape reload showed
 * `branches?kind=eq.main` four times, `user_preferences` three to five
 * times, `aliases` four times, each pair of count HEADs twice — and every
 * duplicate adds to the burst of simultaneous requests that made even
 * trivial reads wait 0.6–2s on a cold load.
 *
 * Only an *identical read that is still in flight* is shared: same method,
 * URL and headers (so the same auth token), GET/HEAD against `/rest/v1/`
 * only. Nothing is cached once a request settles, so a later read always
 * goes to the network. Any write (non-GET/HEAD, e.g. an insert or an RPC)
 * also forgets every in-flight read, so a read issued after a write starts
 * can never be answered by a read that began before it.
 *
 * A request that carries an `AbortSignal` is never shared (one caller
 * aborting would fail the others). Each caller gets its own clone of the
 * shared response, so bodies are read independently.
 */
export function createDedupingFetch(baseFetch: typeof fetch): typeof fetch {
  const inFlight = new Map<string, Promise<Response>>();

  return (input, init) => {
    // Method/URL/headers are read without building a `Request`: constructing
    // one from a `Request` input would consume that input's body.
    const inputIsRequest = typeof Request !== 'undefined' && input instanceof Request;
    const method = (init?.method ?? (inputIsRequest ? input.method : 'GET')).toUpperCase();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const isRestRead = (method === 'GET' || method === 'HEAD') && url.includes('/rest/v1/');

    if (!isRestRead) {
      if (method !== 'GET' && method !== 'HEAD') inFlight.clear();
      return baseFetch(input, init);
    }
    if (init?.signal || (inputIsRequest && input.signal.aborted)) return baseFetch(input, init);

    const headers = [...new Headers(init?.headers ?? (inputIsRequest ? input.headers : undefined)).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const key = `${method} ${url} ${JSON.stringify(headers)}`;

    const existing = inFlight.get(key);
    if (existing) return existing.then((response) => response.clone());

    const pending = baseFetch(input, init);
    inFlight.set(key, pending);
    const forget = (): void => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    };
    pending.then(forget, forget);
    return pending.then((response) => response.clone());
  };
}
