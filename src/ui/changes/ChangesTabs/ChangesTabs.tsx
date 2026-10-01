import { Link } from 'react-router';
import type { UUID } from '../../../contracts/delta';
import { useReviewQueueCount } from '../../reviews/useReviewQueueCount';
import styles from './ChangesTabs.module.css';

export interface ChangesTabsProps {
  orgSlug: string;
  modelSlug: string;
  modelId: UUID;
  current: 'all' | 'review';
}

/**
 * F9 step 2 (UI-principles §2.0, §5): the Changes page's two tabs — every
 * change, and the review queue. The queue stopped being its own nav item,
 * so this is how it's reached: Changes in the nav, then "Review queue".
 * Each tab is a plain link to its own URL (`/changes`, `/review`), not a
 * client-side panel switch, so both stay bookmarkable and Back works
 * (§2.3). The current tab carries `aria-current="page"`, the same active
 * marker the nav uses.
 *
 * "All", not "All changes": the page's own `h1` already says "Changes",
 * and a tab whose name contains "Changes" would be indistinguishable by
 * name from the nav item of the same word.
 *
 * The queue's count reads the same cache entry as the nav badge
 * (`useReviewQueueCount`), so the two never disagree.
 */
export function ChangesTabs({ orgSlug, modelSlug, modelId, current }: ChangesTabsProps) {
  const reviewCount = useReviewQueueCount(modelId);
  const base = `/o/${orgSlug}/m/${modelSlug}`;
  return (
    <nav aria-label="Changes views" className={styles.tabs}>
      <Link to={`${base}/changes`} className={[styles.tab, current === 'all' ? styles.active : ''].filter(Boolean).join(' ')} aria-current={current === 'all' ? 'page' : undefined}>
        All
      </Link>
      <Link to={`${base}/review`} className={[styles.tab, current === 'review' ? styles.active : ''].filter(Boolean).join(' ')} aria-current={current === 'review' ? 'page' : undefined}>
        Review queue
        {reviewCount !== null && reviewCount > 0 && (
          <>
            <span className={styles.count} aria-hidden="true">
              {reviewCount}
            </span>
            <span className={styles.srOnly}>({reviewCount} waiting)</span>
          </>
        )}
      </Link>
    </nav>
  );
}
