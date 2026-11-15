import { useMemo, useState } from 'react';
import type { UUID } from '../../../contracts/delta';
import type { ElementsHeadRow } from '../../../contracts/rows';
import type { DeltaHistoryRow } from '../../../db/elements';
import { Button } from '../Button/Button';
import { formatAge } from '../../time';
import { Text } from '../Text/Text';
import { buildRelationshipParticipantsById, summariseHistoryEntry } from './historyTimelineSummary';
import styles from './HistoryTimeline.module.css';

/** Long enough to orient on recent activity, short enough that a busy element's own decades-old "created" delta doesn't push everything below the fold — "Show all" (below) is one click away regardless. */
const INITIAL_VISIBLE_COUNT = 6;

export interface HistoryTimelineProps {
  history: DeltaHistoryRow[];
  /** The element this history is shown on — which side of a relationship entry reads as "this element" vs. the other, named side (`historyTimelineSummary.ts`'s own `HistorySummaryContext`). */
  elementId: UUID;
  /** `useElementPage.ts`'s own `relationshipEndpoints` — every *live* element a relationship entry here might need to name. */
  relationshipEndpoints: ReadonlyMap<UUID, ElementsHeadRow>;
  /** `useElementPage.ts`'s own `retractedElementNames` — the same, for an endpoint that's itself since been retracted, so `relationshipEndpoints` above has nothing for it. An id in neither map (should not happen — see that function's own doc comment) falls back to the raw id, `historyTimelineSummary.ts`'s own last resort. */
  retractedElementNames: ReadonlyMap<UUID, string>;
  now?: Date;
}

/**
 * §4.6.2: "a timeline of every fact ever asserted about this element,
 * newest first... This is the audit trail, and it is on the page, not
 * behind an 'export audit log' button." Item's own follow-up: shown a
 * handful at a time (`INITIAL_VISIBLE_COUNT`) rather than every delta an
 * element has ever had at once — still the same one list, "Show all" away
 * from the full trail, not a second, separate page.
 *
 * A different element's own history is a different list, not more of this
 * one — `visibleCount` below needs to reset on navigating to a new
 * element, and `ElementPage.tsx` gives it that reset for free by keying
 * this component on `elementId` (remounting, not updating, whenever it
 * changes — React's own recommended reset-on-prop-change shape, cheaper
 * than an effect calling `setState`).
 */
export function HistoryTimeline({ history, elementId, relationshipEndpoints, retractedElementNames, now = new Date() }: HistoryTimelineProps) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const participants = useMemo(() => buildRelationshipParticipantsById(history), [history]);
  const elementNamesById = useMemo(
    () => new Map([...relationshipEndpoints].map(([id, element]) => [id, element.name] as const).concat([...retractedElementNames])),
    [relationshipEndpoints, retractedElementNames],
  );

  if (history.length === 0) {
    return null;
  }

  const visible = history.slice(0, visibleCount);
  const remaining = history.length - visible.length;

  return (
    <>
      <ul className={styles.list}>
        {visible.map((delta) => (
          <li key={delta.id} className={styles.entry}>
            <Text tone="muted" size="xs" as="span" mono>
              {formatAge(new Date(delta.created_at), now)} ago
            </Text>
            <Text as="span" size="sm">
              {summariseHistoryEntry(delta, { elementId, participants, elementNamesById })}
            </Text>
          </li>
        ))}
      </ul>
      {remaining > 0 && (
        <Button
          variant="ghost"
          onClick={() => {
            setVisibleCount(history.length);
          }}
        >
          Show {remaining} more
        </Button>
      )}
    </>
  );
}
