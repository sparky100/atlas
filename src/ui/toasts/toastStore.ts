/**
 * Sprint 7i item 2's "save toasts say the edit went to the change" — a
 * sibling of `src/ui/errors/errorBannerStore.ts`, deliberately not an
 * extension of it: that store is explicitly manual-dismiss and
 * failure-only, a de-duplicated list of *unacknowledged* failures — mixing
 * in a transient, auto-dismissing success notice would fight its own
 * stated design. Same plain module-level store + `useSyncExternalStore`
 * shape (the hooks that report a toast live outside any one page's
 * component tree, same reasoning `errorBannerStore.ts`'s own module
 * comment gives), but each toast schedules its own dismissal.
 */
export interface ToastMessage {
  id: string;
  text: string;
}

const TOAST_DURATION_MS = 4000;

let messages: ToastMessage[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Reports a toast; auto-dismisses after ~4s. Unlike `reportError`, no de-duplication — a second identical save is a second real event worth its own toast. */
export function reportToast(text: string): string {
  const id = crypto.randomUUID();
  messages = [...messages, { id, text }];
  notify();
  const timer = setTimeout(() => {
    dismissToast(id);
  }, TOAST_DURATION_MS);
  timers.set(id, timer);
  return id;
}

export function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const next = messages.filter((m) => m.id !== id);
  if (next.length === messages.length) return;
  messages = next;
  notify();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToastSnapshot(): ToastMessage[] {
  return messages;
}

/** Test-only reset — the store is module-level, so it otherwise leaks state (and pending timers) between test files/cases. */
export function resetToastStoreForTests(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  messages = [];
  notify();
}
