import { useSyncExternalStore } from 'react';
import { Text } from '../components/Text/Text';
import { dismissToast, getToastSnapshot, subscribeToasts } from './toastStore';
import styles from './ToastHost.module.css';

/**
 * Sprint 7i item 2's "save toasts say the edit went to the change" —
 * mounted once (`ThemedApp.tsx`, alongside `ErrorBanner`) so any
 * branch-scoped save hook can call `reportToast` without its page needing
 * to render anything itself. Renders nothing when the store is empty.
 *
 * `role="status"` (polite, non-interrupting — a save succeeding is good
 * news, not an alert) rather than `ErrorBanner`'s `role="alert"`; each
 * toast auto-dismisses on its own timer (`toastStore.ts`) but stays
 * manually dismissible too, for a reader who wants it gone sooner.
 */
export function ToastHost() {
  const messages = useSyncExternalStore(subscribeToasts, getToastSnapshot);
  if (messages.length === 0) return null;

  return (
    <div className={styles.host}>
      {messages.map((m) => (
        <div key={m.id} role="status" className={styles.toast}>
          <Text as="p" size="sm" className={styles.message}>
            {m.text}
          </Text>
          {m.action && (
            <button
              type="button"
              className={styles.dismiss}
              onClick={() => {
                m.action?.onClick();
                dismissToast(m.id);
              }}
            >
              {m.action.label}
            </button>
          )}
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => {
              dismissToast(m.id);
            }}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
