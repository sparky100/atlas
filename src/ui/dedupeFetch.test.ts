import { describe, expect, it, vi } from 'vitest';
import { createDedupingFetch } from './dedupeFetch';

const REST = 'https://x.supabase.co/rest/v1/branches?model_id=eq.1&kind=eq.main';

function fakeFetch() {
  const resolvers: ((r: Response) => void)[] = [];
  const fn = vi.fn((): Promise<Response> => new Promise((resolve) => resolvers.push(resolve)));
  return { fn, resolveAll: (body = '[]') => { resolvers.splice(0).forEach((r) => { r(new Response(body)); }); } };
}

describe('createDedupingFetch', () => {
  it('shares one request between identical in-flight reads, each caller reading its own body', async () => {
    const { fn, resolveAll } = fakeFetch();
    const f = createDedupingFetch(fn);
    const a = f(REST, { headers: { authorization: 't' } });
    const b = f(REST, { headers: { authorization: 't' } });
    resolveAll('[1]');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(await (await a).text()).toBe('[1]');
    expect(await (await b).text()).toBe('[1]');
  });

  it('does not share reads with different headers or URLs', () => {
    const { fn } = fakeFetch();
    const f = createDedupingFetch(fn);
    void f(REST, { headers: { authorization: 'a' } });
    void f(REST, { headers: { authorization: 'b' } });
    void f(`${REST}&x=1`, { headers: { authorization: 'a' } });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('issues a fresh request once the first has settled', async () => {
    const { fn, resolveAll } = fakeFetch();
    const f = createDedupingFetch(fn);
    const a = f(REST);
    resolveAll();
    await a;
    void f(REST);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('a write forgets in-flight reads so a later read is not answered by an earlier one', () => {
    const { fn } = fakeFetch();
    const f = createDedupingFetch(fn);
    void f(REST);
    void f('https://x.supabase.co/rest/v1/rpc/thing', { method: 'POST', body: '{}' });
    void f(REST);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never shares a request that carries an AbortSignal, or non-REST URLs', () => {
    const { fn } = fakeFetch();
    const f = createDedupingFetch(fn);
    const signal = new AbortController().signal;
    void f(REST, { signal });
    void f(REST, { signal });
    void f('https://x.supabase.co/auth/v1/user');
    void f('https://x.supabase.co/auth/v1/user');
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
