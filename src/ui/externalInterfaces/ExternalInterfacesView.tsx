import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import type { UUID } from '../../contracts/delta';
import type { ExternalInterfaceCrossing, ExternalOrganisationAccess } from '../../db/healthFindings';
import { useExternalInterfaces } from './useExternalInterfaces';
import styles from './ExternalInterfacesView.module.css';

export interface ExternalInterfacesViewProps {
  modelId: UUID;
}

/**
 * S1 item 11a's "View all →" target for both Assurance rows this item
 * adds — see `useExternalInterfaces.ts`'s own doc comment for why they
 * share one page. Two independent sections, each with its own empty
 * state: a model can have external interfaces with nothing missing (or
 * none at all) while still having external organisations with access,
 * and vice versa.
 */
export function ExternalInterfacesView({ modelId }: ExternalInterfacesViewProps) {
  const state = useExternalInterfaces(modelId);

  if (state.status === 'loading') return <Text tone="muted">Loading…</Text>;
  if (state.status === 'error') return <Text as="p">{state.message}</Text>;

  return (
    <div className={styles.section}>
      <div>
        <Text as="h2" size="lg">
          Missing a data classification
        </Text>
        {state.crossings.length === 0 ? (
          <EmptyState>No external interface is missing a data classification.</EmptyState>
        ) : (
          <ul className={styles.list}>
            {state.crossings.map((crossing) => (
              <CrossingRow key={crossing.relationshipId} crossing={crossing} />
            ))}
          </ul>
        )}
      </div>

      <div>
        <Text as="h2" size="lg">
          External organisations with access
        </Text>
        {state.organisationAccess.length === 0 ? (
          <EmptyState>No external actor currently uses a system in this model.</EmptyState>
        ) : (
          <ul className={styles.list}>
            {state.organisationAccess.map((access) => (
              <AccessRow key={access.relationshipId} access={access} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CrossingRow({ crossing }: { crossing: ExternalInterfaceCrossing }) {
  return (
    <li className={styles.row}>
      <div>
        <Text as="span" size="lg">
          {crossing.fromName} → {crossing.toName}
        </Text>
        <div className={styles.rowMeta}>
          <Chip tone="neutral">{crossing.relationshipType.replace('_', ' ')}</Chip>
          <Text as="span" tone="muted" size="sm">
            no data classification
          </Text>
        </div>
      </div>
    </li>
  );
}

function AccessRow({ access }: { access: ExternalOrganisationAccess }) {
  return (
    <li className={styles.row}>
      <Text as="span" size="lg">
        {access.organisation} uses {access.systemName}
      </Text>
    </li>
  );
}
