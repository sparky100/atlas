import type { BranchRow } from '../../../db/types';
import { Chip } from '../Chip/Chip';
import { EmptyState } from '../EmptyState/EmptyState';
import { Text } from '../Text/Text';
import styles from './ChangesTouchingSection.module.css';

export interface ChangesTouchingSectionProps {
  inFlightBranches: BranchRow[];
}

/**
 * §4.6.1: in-flight changes touching this element. Sprint U1 has no
 * editing on change branches yet (ADR-015: only main is committed to from
 * the UI) — this section's query is real (src/db/elements.ts's
 * listInFlightBranchesTouchingSubject), so it will start showing rows the
 * moment that changes, with no rework here.
 */
export function ChangesTouchingSection({ inFlightBranches }: ChangesTouchingSectionProps) {
  if (inFlightBranches.length === 0) {
    return <EmptyState>No in-flight changes touch this element.</EmptyState>;
  }

  return (
    <ul className={styles.list}>
      {inFlightBranches.map((branch) => (
        <li key={branch.id} className={styles.row}>
          <Text as="span">{branch.title ?? branch.name}</Text>
          <Chip tone="info">{branch.status}</Chip>
        </li>
      ))}
    </ul>
  );
}
