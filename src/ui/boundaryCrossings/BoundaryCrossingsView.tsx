import { Loading } from '../components/Loading/Loading';
import { Link } from 'react-router';
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
  orgSlug: string;
  modelSlug: string;
}

/**
 * Prompt 7k item 3's "Boundary crossings" list: every `uses`/`flows_to`
 * edge crossing the IT/OT boundary, at main's current head — not just the
 * ones missing a verb or data classification (`ArchitectHome.tsx`'s own
 * Health finding is that narrower subset); this is the honest full count
 * the door's own "Boundary crossings" block links out to.
 */
export function BoundaryCrossingsView({ modelId, orgSlug, modelSlug }: BoundaryCrossingsViewProps) {
  const state = useBoundaryCrossings(modelId);

  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') return <Text as="p">{state.message}</Text>;
  if (state.crossings.length === 0) {
    return <EmptyState>No IT/OT boundary crossings — no system on one side is connected to a system on the other.</EmptyState>;
  }

  return (
    <ul className={styles.list}>
      {state.crossings.map((crossing) => (
        <CrossingRow key={crossing.relationshipId} crossing={crossing} orgSlug={orgSlug} modelSlug={modelSlug} />
      ))}
    </ul>
  );
}

/**
 * Bug fix: this list was the "next screen" you land on from the door's own
 * Assurance/Health finding rows, but every row here was plain text — no
 * way to actually reach the system whose data classification (or verb)
 * needs fixing without separately searching for it by name. Each endpoint
 * now links to its own element page, the same `/o/{org}/m/{model}/e/{id}`
 * href `RelationshipsSection.tsx`'s own endpoint links already use.
 */
function CrossingRow({ crossing, orgSlug, modelSlug }: { crossing: BoundaryCrossing; orgSlug: string; modelSlug: string }) {
  const missing = crossing.missingVerb || crossing.missingDataClassification;
  return (
    <li className={styles.row}>
      <div>
        <Text as="span" size="lg">
          <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${crossing.fromElementId}`}>{crossing.fromName}</Link> → <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${crossing.toElementId}`}>{crossing.toName}</Link>
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
