import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../Button/Button';
import { Text } from '../Text/Text';
import { joinWithMore, type HealthFindingItem } from './healthFindingFormat';
import styles from './HealthFinding.module.css';

export type { HealthFindingItem } from './healthFindingFormat';

export interface HealthFindingProps {
  /** "N systems not linked to a capability" etc — count and one-line description already combined, pluralised by the caller. */
  summary: string;
  items: readonly HealthFindingItem[];
  /** Where "Review →" (or `browseLabel`) sends someone — the browse table, pre-filtered to this finding. Omitted entirely (not a disabled link) when there's nowhere useful to send someone — Sprint U4-1 B5's own relationship finding has no element to browse to. */
  browseHref?: string;
  browseLabel?: string;
}

const PAGE_SIZE = 20;

/**
 * One health finding, Sprint U4-1 B3's shape: a collapsed row (count, the
 * caller's one-line description, first three names, "and N more", a link
 * to the browse table pre-filtered to this finding) that expands to the
 * full list, paginated at 20 — every finding on the architect door gets
 * exactly this, not a bespoke layout per finding. `items.length === 0`
 * renders just `summary` — the "0 X" line ArchitectHome.tsx still shows
 * per finding even when everything is clean; the panel-wide "No findings"
 * single line (all findings zero at once) is that component's own job,
 * not this one's.
 */
export function HealthFinding({ summary, items, browseHref, browseLabel }: HealthFindingProps) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);

  if (items.length === 0) {
    return <Text as="p">{summary}</Text>;
  }

  const pageCount = Math.ceil(items.length / PAGE_SIZE);
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = items.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div>
      <Text as="p">{summary}</Text>
      {!expanded && (
        <Text as="p" tone="muted" size="sm">
          {joinWithMore(items)}
        </Text>
      )}
      <div className={styles.actions}>
        <Button
          variant="ghost"
          onClick={() => {
            setExpanded((e) => !e);
            setPage(0);
          }}
        >
          {expanded ? 'Show less' : 'Show all'}
        </Button>
        {browseHref !== undefined && (
          <Link to={browseHref}>
            <Text as="span" size="sm">
              {browseLabel ?? 'Review →'}
            </Text>
          </Link>
        )}
      </div>
      {expanded && (
        <>
          <ul className={styles.itemList}>
            {pageItems.map((item) => (
              <li key={item.id}>
                <Text as="span" size="sm">
                  {item.label}
                </Text>
              </li>
            ))}
          </ul>
          {pageCount > 1 && (
            <div className={styles.pagination}>
              <Button variant="ghost" disabled={currentPage === 0} onClick={() => { setPage((p) => p - 1); }}>
                ← Previous
              </Button>
              <Text as="span" tone="muted" size="sm">
                Page {currentPage + 1} of {pageCount}
              </Text>
              <Button variant="ghost" disabled={currentPage === pageCount - 1} onClick={() => { setPage((p) => p + 1); }}>
                Next →
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
