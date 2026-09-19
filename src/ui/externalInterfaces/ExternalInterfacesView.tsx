import { Link } from 'react-router';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import type { UUID } from '../../contracts/delta';
import type { ExternalInterfaceCrossing, ExternalOrganisationAccess } from '../../db/healthFindings';
import { useExternalInterfaces } from './useExternalInterfaces';
import styles from './ExternalInterfacesView.module.css';

export interface ExternalInterfacesViewProps {
  modelId: UUID;
  orgSlug: string;
  modelSlug: string;
}

/**
 * S1 item 11a's "View all →" target for both Assurance rows this item
 * adds — see `useExternalInterfaces.ts`'s own doc comment for why they
 * share one page. Two independent sections, each with its own empty
 * state: a model can have external interfaces with nothing missing (or
 * none at all) while still having external organisations with access,
 * and vice versa.
 */
export function ExternalInterfacesView({ modelId, orgSlug, modelSlug }: ExternalInterfacesViewProps) {
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
              <CrossingRow key={crossing.relationshipId} crossing={crossing} orgSlug={orgSlug} modelSlug={modelSlug} />
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
              <AccessRow key={access.relationshipId} access={access} orgSlug={orgSlug} modelSlug={modelSlug} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Bug fix: this list, and `AccessRow` below, were the "next screen" you
 * land on from the door's own Assurance rows, but every row was plain
 * text — no way to reach the system/actor actually needing a fix without
 * separately searching for it by name. Each endpoint now links to its own
 * element page, the same `/o/{org}/m/{model}/e/{id}` href
 * `RelationshipsSection.tsx`'s own endpoint links already use.
 */
function CrossingRow({ crossing, orgSlug, modelSlug }: { crossing: ExternalInterfaceCrossing; orgSlug: string; modelSlug: string }) {
  return (
    <li className={styles.row}>
      <div>
        <Text as="span" size="lg">
          <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${crossing.fromElementId}`}>{crossing.fromName}</Link> → <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${crossing.toElementId}`}>{crossing.toName}</Link>
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

function AccessRow({ access, orgSlug, modelSlug }: { access: ExternalOrganisationAccess; orgSlug: string; modelSlug: string }) {
  return (
    <li className={styles.row}>
      <Text as="span" size="lg">
        <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${access.actorId}`}>{access.organisation}</Link> uses <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${access.systemId}`}>{access.systemName}</Link>
      </Text>
    </li>
  );
}
