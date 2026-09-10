import { useSyncExternalStore } from 'react';
import { dismissError, getErrorSnapshot, subscribeErrors } from '../../errors/errorBannerStore';
import { Text } from '../Text/Text';
import styles from './ErrorBanner.module.css';

/**
 * Sprint U4-2a item 2's "4xx/5xx surface a visible error banner" —
 * mounted once (`ThemedApp.tsx`, above every route) so any hook anywhere
 * can call `reportError` (`../../errors/errorBannerStore.ts`) without that
 * page needing to render anything itself. Renders nothing when the store
 * is empty — the common case.
 *
 * Each row is `role="alert"` (announced by a screen reader the moment it
 * mounts, same as a live region) and dismissible — a 4xx/5xx is a real
 * failure the user may not be able to do anything about immediately, so
 * this never auto-dismisses on a timer the way a transient success toast
 * might.
 */
export function ErrorBanner() {
  const messages = useSyncExternalStore(subscribeErrors, getErrorSnapshot);
  if (messages.length === 0) return null;

  return (
    <div className={styles.host}>
      {messages.map((m) => (
        <div key={m.id} role="alert" className={styles.banner}>
          <Text as="p" size="sm" className={styles.message}>
            {m.text}
          </Text>
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => {
              dismissError(m.id);
            }}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
