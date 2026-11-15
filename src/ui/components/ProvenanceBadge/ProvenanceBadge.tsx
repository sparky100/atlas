import type { SourceKind } from '../../../contracts/sources';
import { isStale } from '../../../contracts/thresholds';
import { useStaleAfterMonths } from '../../orgs/staleThresholdContext';
import { formatAge } from '../../time';
import styles from './ProvenanceBadge.module.css';

export interface ProvenanceBadgeProps {
  sourceKind: SourceKind;
  /** The fact's `effective_date` if set, else the delta's commit time (§4.3). */
  date: Date;
  now?: Date;
}

/**
 * A quiet "Evidence" link; it opens the full source, date and history.
 * When the fact is older than the organisation's stale-after setting it
 * reads "Last checked Nmo ago" in the warning colour instead — the only
 * thing the badge ever flags. Confidence is deliberately not shown: a value
 * that is on the model has been reviewed by a person (an accepted import
 * included), so the importer's own doubt says nothing useful about it.
 */
export function ProvenanceBadge({ sourceKind, date, now = new Date() }: ProvenanceBadgeProps) {
  const staleAfterMonths = useStaleAfterMonths();
  const stale = isStale(date, now, staleAfterMonths);
  const ageLabel = formatAge(date, now);
  return (
    <span className={styles.badge} title={`${sourceKind}, ${ageLabel} old`}>
      {stale ? <span className={styles.staleAge}>Last checked {ageLabel} ago</span> : <span className={styles.age}>Evidence</span>}
    </span>
  );
}
