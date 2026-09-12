/**
 * Sprint U4-2a item 2's last part: "4xx/5xx surface a visible error
 * banner." Every model-scoped hook already catches its own db errors —
 * `useLandscape`'s own `state.status === 'error'` inline message, for
 * one — but several of the hooks shared across every route (`useMainBranch`,
 * `useEditingBranch`) swallow a failed fetch into `null`/`loading: false`
 * with no error surfaced anywhere: a real 4xx/5xx (RLS denial, a dropped
 * connection, a bad filter reaching PostgREST — this sprint's own
 * `assertRealId` guard throws exactly this shape) currently just renders
 * as an empty page, no different from "there's nothing here yet."
 *
 * A plain module-level store, not a React context: the hooks that need to
 * report an error live outside any one page's component tree (shared
 * across all ~14 model-scoped routes) and most already run inside a
 * `.catch()` in a `useEffect`, not during render — reaching for a context
 * there means threading a `report` callback through every hook's own
 * parameter list for no benefit over a plain import. `ErrorBannerHost`
 * (mounted once, in `ThemedApp.tsx`, above every route) is this store's
 * one subscriber; `useSyncExternalStore` is what makes that safe under
 * concurrent rendering.
 */
export interface ErrorBannerMessage {
  id: string;
  text: string;
}

let messages: ErrorBannerMessage[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Reports a message for the global banner. De-duplicates identical text
 * already showing — a route whose page re-renders and re-fires the same
 * failed fetch (React StrictMode's dev-only double-invoke among them,
 * this sprint's own recurring finding) shows one banner, not a stack of
 * the same sentence.
 *
 * S1 item 9: "Error banners show one plain sentence; detail to console."
 * `text` is the only thing that ever reaches the banner — every call site
 * writes its own plain lead-in sentence rather than interpolating a raw
 * caught error's `.message` into it (a PostgREST error or this sprint's
 * own `assertRealId` guard can both throw long, technical, multi-clause
 * strings that have no business in a user-facing banner). `detail`, when
 * given, goes to `console.error` and nowhere else — one place enforces
 * this rather than relying on every caller to remember its own
 * `console.error` before reporting.
 */
export function reportError(text: string, detail?: unknown): string {
  if (detail !== undefined) console.error(text, detail);
  const existing = messages.find((m) => m.text === text);
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  messages = [...messages, { id, text }];
  notify();
  return id;
}

export function dismissError(id: string): void {
  const next = messages.filter((m) => m.id !== id);
  if (next.length === messages.length) return;
  messages = next;
  notify();
}

export function subscribeErrors(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getErrorSnapshot(): ErrorBannerMessage[] {
  return messages;
}

/** Test-only reset — the store is module-level, so it otherwise leaks state between test files/cases. */
export function resetErrorBannerStoreForTests(): void {
  messages = [];
  notify();
}
