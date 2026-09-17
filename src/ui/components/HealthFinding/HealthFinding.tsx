import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '../Button/Button';
import { Text } from '../Text/Text';
import { joinWithMore, type HealthFindingItem, type HealthFindingSeverity } from './healthFindingFormat';
import styles from './HealthFinding.module.css';

export type { HealthFindingItem, HealthFindingSeverity } from './healthFindingFormat';

export interface HealthFindingProps {
  /** "N systems not linked to a capability" etc — count and one-line description already combined, pluralised by the caller. */
  summary: string;
  items: readonly HealthFindingItem[];
  /** Sprint U4-1 findings follow-up: drives this plate's own tint — see `HealthFindingSeverity`'s own doc comment (`healthFindingFormat.ts`). Ignored when `items.length === 0` (that early return renders plain text, no tint of any kind, same as before this existed). */
  severity: HealthFindingSeverity;
  /** Where "Review →" (or `browseLabel`) sends someone — the browse table, pre-filtered to this finding. Omitted entirely (not a disabled link) when there's nowhere useful to send someone — Sprint U4-1 B5's own relationship finding has no element to browse to. */
  browseHref?: string;
  browseLabel?: string;
  /**
   * Prompt pack F3 PR6's own per-row action slot — the first thing a
   * finding has ever offered *per item* rather than per group (`browseHref`
   * above sends someone to the browse table as a whole; this renders
   * something after one specific item's own label, in the expanded list
   * only). Deliberately generic (a `ReactNode`, not a fixed "Start a
   * decision" button baked into this component) so this stays a shared
   * primitive every finding could eventually use a row action from, not a
   * decisions-specific component — `ArchitectHome.tsx` is the one caller
   * that actually passes one today, for its own `critical-support-end`
   * check. Omitted entirely (no wrapper, no empty slot) for any item the
   * caller returns `undefined` for, the same "omitted, never disabled"
   * convention every other optional action in this product follows.
   */
  itemAction?: (item: HealthFindingItem) => ReactNode;
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
export function HealthFinding({ summary, items, severity, browseHref, browseLabel, itemAction }: HealthFindingProps) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);

  if (items.length === 0) {
    return <Text as="p">{summary}</Text>;
  }

  const pageCount = Math.ceil(items.length / PAGE_SIZE);
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = items.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const severityClass = severity === 'high' ? styles.high : severity === 'medium' ? styles.medium : '';

  return (
    // Visual pass (director/architect doors): this only ever renders past
    // the `items.length === 0` return above, so it's always the "real,
    // non-zero" case — `.plate`'s own padding keeps it from running flush
    // against the plate/BlueprintFrame border the caller (ArchitectHome.tsx's
    // `checkPlate`) already draws around it. Sprint U4-1 findings follow-up:
    // the background tint itself now depends on `severity` rather than
    // being flat for every non-zero finding — `informational` gets no
    // colour class at all, reading the same as a clean finding but still
    // expandable, so it doesn't compete visually with a real gap.
    <div className={[styles.plate, severityClass].filter(Boolean).join(' ')}>
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
              <li key={item.id} className={itemAction ? styles.itemRow : undefined}>
                <Text as="span" size="sm">
                  {item.label}
                </Text>
                {itemAction?.(item)}
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
