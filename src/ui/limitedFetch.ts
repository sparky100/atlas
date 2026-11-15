/**
 * Caps how many REST reads the browser has in flight at once (performance:
 * "cold start" on the Landscape and element pages). After a quiet spell the
 * database's connection pool has closed its idle connections, so a page that
 * fires ~20 reads in the same instant makes it open about ten brand-new
 * connections together. Each one has to warm up before it can answer, and on a
 * small server that makes every request — even a one-row profile read — wait
 * 10 s or more, then finish together. Supabase logs of a Landscape cold load:
 * ~18 simultaneous reads, each 10.5–11.7 s; the same reads on a warm reload,
 * 40 ms–1 s. A cap means only a handful of connections are opened cold; the
 * rest reuse them as they warm.
 *
 * Only `GET`/`HEAD` against `/rest/v1/` count toward the cap — writes, RPCs,
 * auth, storage and functions pass straight through, so nothing a user is
 * waiting on to save ever queues behind reads. Queued reads start in the
 * order they were asked for. A read that carries an `AbortSignal` and is
 * aborted while queued is dropped without ever holding a slot.
 *
 * `restReadActivity` also lets non-critical panels wait until the page's own
 * reads have finished (`whenQuiet`), so they never join the burst.
 */

/** About half the pool of ~11 connections the database opens: enough to keep a warm page quick, few enough that a cold start only warms a handful. */
export const MAX_CONCURRENT_READS = 6;

export interface ReadActivity {
  /** A read was asked for (it may still be queued). */
  begin: () => void;
  /** A read finished, successfully or not, or was dropped from the queue. */
  end: () => void;
  /** Reads asked for and not yet finished, queued ones included. */
  pending: () => number;
  /**
   * Resolves once no read has been pending for `quietMs` in a row, or after
   * `maxWaitMs` regardless — a page whose reads never go quiet must still
   * show its panels.
   */
  whenQuiet: (quietMs?: number, maxWaitMs?: number) => Promise<void>;
}

export function createReadActivity(): ReadActivity {
  let pending = 0;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  return {
    begin: () => {
      pending += 1;
      notify();
    },
    end: () => {
      pending -= 1;
      notify();
    },
    pending: () => pending,
    whenQuiet: (quietMs = 60, maxWaitMs = 4000) =>
      new Promise<void>((resolve) => {
        let quietTimer: ReturnType<typeof setTimeout> | undefined;
        const maxTimer = setTimeout(() => {
          done();
        }, maxWaitMs);
        function done(): void {
          clearTimeout(quietTimer);
          clearTimeout(maxTimer);
          listeners.delete(check);
          resolve();
        }
        function check(): void {
          clearTimeout(quietTimer);
          if (pending === 0) quietTimer = setTimeout(done, quietMs);
        }
        listeners.add(check);
        check();
      }),
  };
}

/** The browser Supabase client's own activity — `src/ui/supabaseClient.ts` wires its fetch to this. */
export const restReadActivity: ReadActivity = createReadActivity();

export function createLimitedFetch(baseFetch: typeof fetch, limit: number = MAX_CONCURRENT_READS, activity: ReadActivity = restReadActivity): typeof fetch {
  let running = 0;
  const queue: (() => void)[] = [];

  const release = (): void => {
    running -= 1;
    const next = queue.shift();
    if (next) next();
  };

  return (input, init) => {
    const inputIsRequest = typeof Request !== 'undefined' && input instanceof Request;
    const method = (init?.method ?? (inputIsRequest ? input.method : 'GET')).toUpperCase();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const isRestRead = (method === 'GET' || method === 'HEAD') && url.includes('/rest/v1/');
    if (!isRestRead) return baseFetch(input, init);

    const signal = init?.signal ?? (inputIsRequest ? input.signal : undefined);
    activity.begin();

    const run = (): Promise<Response> => baseFetch(input, init).finally(() => {
      release();
      activity.end();
    });

    if (running < limit) {
      running += 1;
      return run();
    }

    return new Promise<Response>((resolve, reject) => {
      const start = (): void => {
        signal?.removeEventListener('abort', onAbort);
        running += 1;
        run().then(resolve, reject);
      };
      const onAbort = (): void => {
        const index = queue.indexOf(start);
        if (index >= 0) queue.splice(index, 1);
        activity.end();
        reject(signal?.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError'));
      };
      if (signal?.aborted) {
        activity.end();
        reject(signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError'));
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      queue.push(start);
    });
  };
}
