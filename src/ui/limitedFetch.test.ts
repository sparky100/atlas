import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLimitedFetch, createReadActivity } from './limitedFetch';

const REST = (n: number) => `https://x.supabase.co/rest/v1/t?n=${String(n)}`;

function fakeFetch() {
  const calls: { resolve: (r: Response) => void; reject: (e: unknown) => void }[] = [];
  const fn = vi.fn(
    (..._args: unknown[]) =>
      new Promise<Response>((resolve, reject) => {
        calls.push({ resolve, reject });
      }),
  );
  return { fn: fn as unknown as typeof fetch, mock: fn, calls };
}

describe('createLimitedFetch', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs at most `limit` REST reads at once and starts queued ones in order as slots free up', async () => {
    const { fn, mock, calls } = fakeFetch();
    const f = createLimitedFetch(fn, 2, createReadActivity());
    const results = [1, 2, 3, 4].map((n) => f(REST(n)));
    expect(mock).toHaveBeenCalledTimes(2);

    calls[0]?.resolve(new Response('a'));
    await results[0];
    await Promise.resolve();
    expect(mock).toHaveBeenCalledTimes(3);
    expect(String(mock.mock.calls[2]?.[0])).toContain('n=3');

    calls[1]?.resolve(new Response('b'));
    await results[1];
    await Promise.resolve();
    expect(mock).toHaveBeenCalledTimes(4);
    expect(String(mock.mock.calls[3]?.[0])).toContain('n=4');
  });

  it('frees the slot when a read fails', async () => {
    const { fn, mock, calls } = fakeFetch();
    const f = createLimitedFetch(fn, 1, createReadActivity());
    const first = f(REST(1));
    void f(REST(2));
    expect(mock).toHaveBeenCalledTimes(1);
    calls[0]?.reject(new Error('network'));
    await expect(first).rejects.toThrow('network');
    await Promise.resolve();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('lets writes, RPCs and non-REST calls straight through, even at the cap', () => {
    const { fn, mock } = fakeFetch();
    const f = createLimitedFetch(fn, 1, createReadActivity());
    void f(REST(1));
    void f('https://x.supabase.co/rest/v1/rpc/thread_counts', { method: 'POST' });
    void f(REST(2), { method: 'POST' });
    void f('https://x.supabase.co/auth/v1/user');
    expect(mock).toHaveBeenCalledTimes(4);
  });

  it('drops a read aborted while queued, without it ever holding a slot', async () => {
    const { fn, mock, calls } = fakeFetch();
    const activity = createReadActivity();
    const f = createLimitedFetch(fn, 1, activity);
    const first = f(REST(1));
    const controller = new AbortController();
    const queued = f(REST(2), { signal: controller.signal });
    const third = f(REST(3));
    expect(activity.pending()).toBe(3);

    controller.abort();
    await expect(queued).rejects.toThrow();
    expect(activity.pending()).toBe(2);

    calls[0]?.resolve(new Response('a'));
    await first;
    await Promise.resolve();
    expect(mock).toHaveBeenCalledTimes(2);
    expect(String(mock.mock.calls[1]?.[0])).toContain('n=3');
    calls[1]?.resolve(new Response('c'));
    await third;
  });

  it('rejects at once for a read whose signal is already aborted while the cap is full', async () => {
    const { fn } = fakeFetch();
    const activity = createReadActivity();
    const f = createLimitedFetch(fn, 1, activity);
    void f(REST(1));
    const controller = new AbortController();
    controller.abort();
    await expect(f(REST(2), { signal: controller.signal })).rejects.toThrow();
    expect(activity.pending()).toBe(1);
  });
});

describe('createReadActivity.whenQuiet', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after the quiet period when nothing is pending', async () => {
    vi.useFakeTimers();
    const activity = createReadActivity();
    const done = vi.fn();
    void activity.whenQuiet(60, 4000).then(done);
    await vi.advanceTimersByTimeAsync(59);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toHaveBeenCalled();
  });

  it('waits for pending reads to finish, then for the quiet period', async () => {
    vi.useFakeTimers();
    const activity = createReadActivity();
    activity.begin();
    const done = vi.fn();
    void activity.whenQuiet(60, 4000).then(done);
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).not.toHaveBeenCalled();
    activity.end();
    await vi.advanceTimersByTimeAsync(61);
    expect(done).toHaveBeenCalled();
  });

  it('gives up waiting after the ceiling so a page that never goes quiet still shows its panels', async () => {
    vi.useFakeTimers();
    const activity = createReadActivity();
    activity.begin();
    const done = vi.fn();
    void activity.whenQuiet(60, 4000).then(done);
    await vi.advanceTimersByTimeAsync(4001);
    expect(done).toHaveBeenCalled();
  });
});
