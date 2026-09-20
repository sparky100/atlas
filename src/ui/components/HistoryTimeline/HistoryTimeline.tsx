import { useMemo } from 'react';
import type { UUID } from '../../../contracts/delta';
import type { ElementsHeadRow } from '../../../contracts/rows';
import type { DeltaHistoryRow } from '../../../db/elements';
import { formatAge } from '../../time';
import { EmptyState } from '../EmptyState/EmptyState';
import { Text } from '../Text/Text';
import { buildRelationshipParticipantsById, summariseHistoryEntry } from './historyTimelineSummary';
import styles from './HistoryTimeline.module.css';

export interface HistoryTimelineProps {
  history: DeltaHistoryRow[];
  /** The element this history is shown on — which side of a relationship entry reads as "this element" vs. the other, named side (`historyTimelineSummary.ts`'s own `HistorySummaryContext`). */
  elementId: UUID;
  /** `useElementPage.ts`'s own `relationshipEndpoints` — every element a relationship entry here might need to name, live or since retracted. An id missing here (that element has itself since been retracted) falls back to the raw id. */
  relationshipEndpoints: ReadonlyMap<UUID, ElementsHeadRow>;
  now?: Date;
}

/** §4.6.2: "a timeline of every fact ever asserted about this element, newest first... This is the audit trail, and it is on the page, not behind an 'export audit log' button." */
export function HistoryTimeline({ history, elementId, relationshipEndpoints, now = new Date() }: HistoryTimelineProps) {
  const participants = useMemo(() => buildRelationshipParticipantsById(history), [history]);
  const elementNamesById = useMemo(() => new Map([...relationshipEndpoints].map(([id, element]) => [id, element.name])), [relationshipEndpoints]);

  if (history.length === 0) {
    return <EmptyState>No history recorded yet.</EmptyState>;
  }

  return (
    <ul className={styles.list}>
      {history.map((delta) => (
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
  );
}
