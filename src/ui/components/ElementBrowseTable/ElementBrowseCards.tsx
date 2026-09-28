import { Link } from 'react-router';
import type { ReactNode } from 'react';
import type { UUID } from '../../../contracts/delta';
import type { BrowseRow } from '../../../db/elementBrowse';
import type { AttributeDefinitionRow } from '../../../db/types';
import type { ThreadCount } from '../../comments/useThreadCounts';
import { attributesRecord, formatCustomAttributeValue } from '../../elements/attributesRecord';
import { criticalityToneFor } from '../../elements/criticalityTone';
import { lifecycleToneFor } from '../../elements/lifecycleTone';
import { moduleDisplayName } from '../../elements/moduleDisplayName';
import { Chip } from '../Chip/Chip';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../Text/Text';
import { InlineSupportsPicker, type ElementBrowseLinkSupportsConfig } from './ElementBrowseTable';
import styles from './ElementBrowseCards.module.css';

export interface ElementBrowseCardsProps {
  rows: readonly BrowseRow[];
  elementHref: (elementId: UUID) => string;
  unresolvedCounts?: ReadonlyMap<UUID, ThreadCount> | undefined;
  /** The one custom-attribute column the toolbar's picker currently has selected — same "no column at all until one's picked" gate the table's own `<td>` uses. */
  selectedCustomDefinition?: AttributeDefinitionRow | undefined;
  linkSupportsInline?: ElementBrowseLinkSupportsConfig | undefined;
  decisionRowAction?: ((row: BrowseRow) => ReactNode | null) | undefined;
  /** Only read when `linkSupportsInline` is present — the inline picker's own search scope, same as the table's identical call site. */
  commitId: UUID;
}

/**
 * The mobile (<768px) Elements browse list — a user-reported follow-up to
 * the sticky-header table fixes (#315/#316): a dense multi-column table
 * with a pinned header and a pinned first column at once is fundamentally
 * fragile on a narrow viewport (three separate sticky-header bugs found in
 * this exact table already), and even working perfectly it still loses the
 * left-hand Name column off-screen the moment you scroll right to see Type/
 * Owner/etc. Below the breakpoint, this renders instead of the table
 * entirely — same "swap the whole renderer, don't try to make one render
 * work at every width" shape `LandscapeMobileList.tsx`/`ContextMobileList.tsx`/
 * `ValueStreamsMobileList.tsx` already established for the identical class
 * of problem (a dense desktop layout with nothing narrow to shrink into).
 *
 * One card per row, no accordion — unlike those three, this table has
 * nothing to group by (it's already a flat list), so there's no "collapsed
 * group header" layer to add. No horizontal scroll and no sticky header to
 * maintain: every value is inline, labelled by position/tone rather than by
 * a column header, so there's nothing to lose off either scroll axis.
 */
export function ElementBrowseCards({ rows, elementHref, unresolvedCounts, selectedCustomDefinition, linkSupportsInline, decisionRowAction, commitId }: ElementBrowseCardsProps) {
  return (
    <ul className={styles.list}>
      {rows.map((row) => (
        <ElementBrowseCard
          key={row.element.element_id}
          row={row}
          elementHref={elementHref}
          unresolvedCount={unresolvedCounts?.get(row.element.element_id)?.open ?? 0}
          selectedCustomDefinition={selectedCustomDefinition}
          linkSupportsInline={linkSupportsInline}
          decisionRowAction={decisionRowAction}
          commitId={commitId}
        />
      ))}
    </ul>
  );
}

function ElementBrowseCard({
  row,
  elementHref,
  unresolvedCount,
  selectedCustomDefinition,
  linkSupportsInline,
  decisionRowAction,
  commitId,
}: {
  row: BrowseRow;
  elementHref: (elementId: UUID) => string;
  unresolvedCount: number;
  selectedCustomDefinition: AttributeDefinitionRow | undefined;
  linkSupportsInline: ElementBrowseLinkSupportsConfig | undefined;
  decisionRowAction: ((row: BrowseRow) => ReactNode | null) | undefined;
  commitId: UUID;
}) {
  const lifecycleTone = row.lifecycleStatus ? lifecycleToneFor(row.lifecycleStatus) : undefined;
  const criticalityTone = row.criticality ? criticalityToneFor(row.criticality) : undefined;
  // "type · owner", owner omitted rather than shown as a dash — a table
  // column earns a dash to keep its grid aligned, a card line doesn't need
  // to show absence at all.
  const metaParts = [row.element.element_type, row.owner?.name].filter((part): part is string => part !== undefined);
  const customValue = selectedCustomDefinition ? formatCustomAttributeValue(attributesRecord(row.element.attributes)[selectedCustomDefinition.key]) : '';
  const decisionAction = decisionRowAction?.(row);

  return (
    <li className={styles.card}>
      <Link to={elementHref(row.element.element_id)} className={styles.cardMain}>
        <ElementTypeGlyph type={row.element.element_type} />
        <Text as="span" className={styles.cardName}>
          {moduleDisplayName(row.element, row.parent)}
        </Text>
        {row.lifecycleStatus && <Chip tone={lifecycleTone ?? 'neutral'}>{row.lifecycleStatus}</Chip>}
        {row.criticality && <Chip tone={criticalityTone ?? 'neutral'}>{row.criticality}</Chip>}
      </Link>
      <div className={styles.cardSecondary}>
        <Text as="span" size="sm" tone="muted">
          {metaParts.join(' · ')}
        </Text>
        {unresolvedCount > 0 && (
          <Text as="span" size="sm" className={styles.unresolvedBadge}>
            💬 {unresolvedCount}
          </Text>
        )}
      </div>
      {selectedCustomDefinition && customValue !== '' && (
        <Text as="span" size="sm" tone="muted">
          {selectedCustomDefinition.label}: {customValue}
        </Text>
      )}
      {linkSupportsInline && row.element.element_type === 'system' && (
        <div className={styles.cardActions}>
          <InlineSupportsPicker system={{ elementId: row.element.element_id, name: row.element.name }} config={linkSupportsInline} searchCommitId={commitId} />
        </div>
      )}
      {decisionAction && <div className={styles.cardActions}>{decisionAction}</div>}
    </li>
  );
}
