import { Link } from 'react-router';
import { Text } from '../Text/Text';
import { joinWithMore, type HealthFindingItem, type HealthFindingSeverity } from './healthFindingFormat';
import styles from './FindingCard.module.css';

/** Where a card's one action sends someone — either a browse-table link (housekeeping findings, or a multi-item decision-shaped finding's own filtered list) or a direct "Start a decision" link (a single-item decision-shaped finding) — `ArchitectHome.tsx`'s `resolveCardAction` decides which. */
export interface FindingCardAction {
  href: string;
  label: string;
  /** F10 step 7: a second link beside the first — a single-item decision-shaped finding's "Start a project →" next to its "Start a decision →". */
  also?: { href: string; label: string };
}

export interface FindingCardProps {
  count: number;
  summary: string;
  items: readonly HealthFindingItem[];
  severity: HealthFindingSeverity;
  action: FindingCardAction | null;
}

/**
 * Architect-door layout prompt's compact finding card (item 2): "bold
 * count + title on one line, names line truncated with 'and N more',
 * action link inline at the end of the names line; severity tint as
 * already built." Replaces `HealthFinding`'s old collapsed-row/expand-to-
 * paginated-list shape for the door's own grid — Sprint U4-1 B3's
 * per-item expand/pagination has no room in a 2-line card, so per-item
 * "Start a decision" access moved to the browse table instead (the
 * per-item-actions prompt's own answer: a multi-item decision-shaped
 * finding's one card action opens the filtered list, where every row
 * carries its own pre-filled "Start a decision",
 * `ElementBrowseTable.tsx`'s `decisionRowAction`).
 *
 * `summary` always begins with `String(count)` verbatim — every
 * `HealthCheck.summary` in `ArchitectHome.tsx` is built that way — so the
 * bold count and the title are split out of the one string rather than
 * carried as two separately-formatted fields.
 */
export function FindingCard({ count, summary, items, severity, action }: FindingCardProps) {
  const countText = String(count);
  const title = summary.startsWith(countText) ? summary.slice(countText.length).replace(/^\s+/, '') : summary;
  const severityClass = severity === 'high' ? styles.high : severity === 'medium' ? styles.medium : '';
  const actionLink = action && (
    <>
      <Link to={action.href}>
        <Text as="span" size="sm">
          {action.label}
        </Text>
      </Link>
      {action.also && (
        <>
          {' · '}
          <Link to={action.also.href}>
            <Text as="span" size="sm">
              {action.also.label}
            </Text>
          </Link>
        </>
      )}
    </>
  );

  return (
    <div className={[styles.card, severityClass].filter(Boolean).join(' ')}>
      <Text as="p" className={styles.titleLine}>
        <Text as="span" className={styles.count}>
          {countText}
        </Text>{' '}
        {title}
      </Text>
      {items.length > 0 && (
        <Text as="p" tone="muted" size="sm" className={styles.namesLine}>
          {joinWithMore(items)}
          {action && (
            <>
              {' · '}
              {actionLink}
            </>
          )}
        </Text>
      )}
      {items.length === 0 && actionLink}
    </div>
  );
}
