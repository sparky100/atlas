import type { DeltaHistoryRow } from '../../../db/elements';
import { formatAge } from '../../time';
import { EmptyState } from '../EmptyState/EmptyState';
import { Text } from '../Text/Text';
import styles from './HistoryTimeline.module.css';

function summarise(delta: DeltaHistoryRow): string {
  switch (delta.kind) {
    case 'element_create':
      return `created — ${delta.name ?? ''}`;
    case 'element_update':
    case 'element_update_custom':
    case 'relationship_update':
    case 'relationship_update_custom':
      return `${delta.attribute}: ${JSON.stringify(delta.value)}`;
    case 'element_retract':
    case 'relationship_retract':
      return 'retracted';
    case 'element_restore':
    case 'relationship_restore':
      return 'restored';
    case 'relationship_create':
      return `created (${delta.relationship_type ?? ''})`;
  }
}

export interface HistoryTimelineProps {
  history: DeltaHistoryRow[];
  now?: Date;
}

/** §4.6.2: "a timeline of every fact ever asserted about this element, newest first... This is the audit trail, and it is on the page, not behind an 'export audit log' button." */
export function HistoryTimeline({ history, now = new Date() }: HistoryTimelineProps) {
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
            {summarise(delta)}
          </Text>
        </li>
      ))}
    </ul>
  );
}
