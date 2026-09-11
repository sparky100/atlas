import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import type { UUID } from '../../contracts/delta';
import type { BoundaryCrossing } from '../../db/healthFindings';
import { DOMAIN_TONE } from '../elements/systemDomain';
import { useBoundaryCrossings } from './useBoundaryCrossings';
import styles from './BoundaryCrossingsView.module.css';

export interface BoundaryCrossingsViewProps {
  modelId: UUID;
}

/**
 * Prompt 7k item 3's "Boundary crossings" list: every `uses`/`flows_to`
 * edge crossing the IT/OT boundary, at main's current head — not just the
 * ones missing a verb or data classification (`ArchitectHome.tsx`'s own
 * Health finding is that narrower subset); this is the honest full count
 * the door's own "Boundary crossings" block links out to.
 */
export function BoundaryCrossingsView({ modelId }: BoundaryCrossingsViewProps) {
  const state = useBoundaryCrossings(modelId);

  if (state.status === 'loading') return <Text tone="muted">Loading…</Text>;
  if (state.status === 'error') return <Text as="p">{state.message}</Text>;
  if (state.crossings.length === 0) {
    return <EmptyState>No IT/OT boundary crossings — no `uses`/`flows_to` edge connects a system on one side to a system on the other.</EmptyState>;
  }

  return (
    <ul className={styles.list}>
      {state.crossings.map((crossing) => (
        <CrossingRow key={crossing.relationshipId} crossing={crossing} />
      ))}
    </ul>
  );
}

function CrossingRow({ crossing }: { crossing: BoundaryCrossing }) {
  const missing = crossing.missingVerb || crossing.missingDataClassification;
  return (
    <li className={styles.row}>
      <div>
        <Text as="span" size="lg">
          {crossing.fromName} → {crossing.toName}
        </Text>
        <div className={styles.rowMeta}>
          <Chip tone={DOMAIN_TONE[crossing.fromDomain]}>{crossing.fromDomain}</Chip>
          <Text as="span" tone="muted" size="sm">
            →
          </Text>
          <Chip tone={DOMAIN_TONE[crossing.toDomain]}>{crossing.toDomain}</Chip>
          <Chip tone="neutral">{crossing.relationshipType.replace('_', ' ')}</Chip>
          {crossing.missingVerb && (
            <Text as="span" tone="muted" size="sm">
              no verb-phrase label
            </Text>
          )}
          {crossing.missingDataClassification && (
            <Text as="span" tone="muted" size="sm">
              no data classification
            </Text>
          )}
          {!missing && (
            <Text as="span" tone="faint" size="xs">
              Classified
            </Text>
          )}
        </div>
      </div>
    </li>
  );
}
