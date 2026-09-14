import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../../../contracts/rows';
import type { RelationshipType, UUID } from '../../../contracts/delta';
import type { BranchRow } from '../../../db/types';
import { useElementRemoveFromModel } from '../../elements/useElementRemoveFromModel';
import { Button } from '../Button/Button';
import { Text } from '../Text/Text';
import styles from './RemoveFromModelAction.module.css';

const OUTBOUND_VERB: Record<RelationshipType, string> = {
  supports: 'supports',
  owns: 'owns',
  uses: 'uses',
  flows_to: 'flows to',
};
const INBOUND_VERB: Record<RelationshipType, string> = {
  supports: 'supported by',
  owns: 'owned by',
  uses: 'used by',
  flows_to: 'receives from',
};

export interface RemoveFromModelActionProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  relationships: readonly RelationshipsHeadRow[];
  relationshipFacts: ReadonlyMap<UUID, Map<string, FactsRow>>;
  relationshipEndpoints: ReadonlyMap<UUID, ElementsHeadRow>;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onRemoved: () => void;
  onCancel: () => void;
}

/**
 * Prompt 7k item 5's "Remove from model…" confirmation — real, listed
 * content (CLAUDE.md rule 7: no stand-in confirmation UI), not a bare
 * `window.confirm()` string the way the old `CapabilityRetractAction.tsx`
 * (this component's own predecessor) got away with when retract could
 * only ever touch a leaf with zero relationships. Lists the element itself
 * plus every relationship `useElementRemoveFromModel` is about to retract
 * alongside it, by name and direction, before the commit happens.
 */
export function RemoveFromModelAction({
  modelId,
  orgId,
  userId,
  element,
  facts,
  relationships,
  relationshipFacts,
  relationshipEndpoints,
  branch,
  expectedHeadCommitId,
  onRemoved,
  onCancel,
}: RemoveFromModelActionProps) {
  const { status, error, remove } = useElementRemoveFromModel({
    modelId,
    orgId,
    userId,
    element,
    facts,
    relationships,
    relationshipFacts,
    branch,
    expectedHeadCommitId,
    onRemoved,
  });

  return (
    <div className={styles.panel}>
      <Text as="p" size="sm">
        Remove &ldquo;{element.name}&rdquo; from the model? This retracts it — it can be restored later, but it and everything below disappear from every view until then.
      </Text>
      <Text as="p" tone="muted" size="sm">
        This will retract:
      </Text>
      <ul className={styles.goesList}>
        <li>
          <Text as="span" size="sm">
            {element.name} (the element itself)
          </Text>
        </li>
        {relationships.map((rel) => {
          const outbound = rel.from_element_id === element.element_id;
          const otherId = outbound ? rel.to_element_id : rel.from_element_id;
          const otherName = relationshipEndpoints.get(otherId)?.name ?? otherId;
          const verb = outbound ? OUTBOUND_VERB[rel.relationship_type] : INBOUND_VERB[rel.relationship_type];
          return (
            <li key={rel.relationship_id}>
              <Text as="span" size="sm">
                {element.name} {verb} {otherName}
              </Text>
            </li>
          );
        })}
      </ul>
      <div className={styles.actions}>
        <Button variant="destructive" onClick={() => void remove()} disabled={status === 'removing'}>
          {status === 'removing' ? 'Removing…' : 'Remove from model'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={status === 'removing'}>
          Cancel
        </Button>
      </div>
      {error !== null && (
        <Text as="p" tone="default">
          {error}
        </Text>
      )}
    </div>
  );
}
