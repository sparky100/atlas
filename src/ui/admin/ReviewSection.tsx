import type { ReactNode } from 'react';
import styles from './CatalogueAdmin.module.css';

/**
 * One block on Waiting for review or Find and check. Every block has the same
 * header (title, how many are waiting, one line saying what to do) and opens and
 * closes the same way. A block with nothing waiting is dimmed and says so, but
 * still opens, so a result message or a record such as merged products stays
 * reachable.
 */
export function ReviewSection({ id, title, hint, count, open, onToggle, emptyText, children }: {
  id: string;
  title: string;
  hint: string;
  /** How many are waiting; leave out for a tool, which has no count. */
  count?: number | null | undefined;
  open: boolean;
  onToggle: (open: boolean) => void;
  emptyText?: string | undefined;
  children: ReactNode;
}) {
  const empty = count === 0;
  return (
    <details className={empty ? [styles.section, styles.sectionEmpty].join(' ') : styles.section} open={open} onToggle={(event) => { onToggle(event.currentTarget.open); }} data-testid={`section-${id}`}>
      <summary>
        <span className={styles.sectionTitle}>{title}</span>
        {count !== undefined && count !== null && <span className={styles.sectionCount} data-testid={`section-${id}-count`}>{String(count)}</span>}
        <span className={styles.sectionHint}>{hint}</span>
      </summary>
      <div className={styles.sectionBody}>
        {empty && emptyText !== undefined && <p>{emptyText}</p>}
        {children}
      </div>
    </details>
  );
}
