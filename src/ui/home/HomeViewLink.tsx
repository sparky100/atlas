import type { ReactNode } from 'react';
import styles from './HomeViewLink.module.css';

/**
 * UI-principles §3's cross-link between Home's two views (Overview ↔ My
 * work): switches the view in place rather than navigating — the view is a
 * remembered preference, not a URL — so it's a `<button>`, styled to read
 * as the in-page text links beside it.
 */
export function HomeViewLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={styles.link} onClick={onClick}>
      {children}
    </button>
  );
}
